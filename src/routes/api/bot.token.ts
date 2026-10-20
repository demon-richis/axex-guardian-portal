import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { isReferenceIdCollision } from "../../lib/reference-id.server.ts";
import type { auditLogs, verificationState, verifyTokens } from "../../lib/db/schema.ts";
import type { getDb } from "../../lib/db/client.server.ts";

type BotTokenDependencies = {
  validateApiKey: (request: Request) => Response | null;
  getDb: typeof getDb;
  auditLogs: typeof auditLogs;
  verifyTokens: typeof verifyTokens;
  verificationState: typeof verificationState;
};

const Body = z.object({
  token: z.string().min(1).max(200),
  userId: z.string().min(1).max(40),
  guildId: z.string().min(1).max(40),
  guildName: z.string().max(200).optional(),
  guildMemberCount: z.number().int().nonnegative().optional(),
  expiresAt: z.string().datetime({ offset: true }),
});

function safeFailureDetails(stage: string, error: unknown) {
  let current: unknown = error;
  let sqlState: string | undefined;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      sqlState = candidate.code;
      break;
    }
    current = candidate.cause;
  }
  return {
    stage,
    errorName: error instanceof Error ? error.name : "unknown",
    ...(sqlState ? { sqlState } : {}),
  };
}

function failedResponse(stage: string, error: unknown) {
  console.error("[bot/token] Request failed:", safeFailureDetails(stage, error));
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export async function handleBotTokenRequest(request: Request, dependencies: BotTokenDependencies) {
  console.log("[bot/token] Request received");
  let stage = "authentication";
  try {
    const authError = dependencies.validateApiKey(request);
    if (authError) return authError;

    stage = "body_validation";
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.error("[bot/token] Invalid request body");
      return Response.json({ error: "Missing or invalid required fields" }, { status: 400 });
    }

    stage = "database_initialization";
    const db = dependencies.getDb();
    const now = new Date();

    const { token, userId, guildId, guildName, guildMemberCount, expiresAt } = parsed.data;
    stage = "verification_state_lookup";
    const state = (
      await db
        .select()
        .from(dependencies.verificationState)
        .where(
          and(
            eq(dependencies.verificationState.userId, userId),
            eq(dependencies.verificationState.guildId, guildId),
          ),
        )
        .limit(1)
    )[0];
    if (state?.lockedAt || (state?.attempts ?? 0) >= 3) {
      return Response.json(
        { error: "Verification is locked", locked: true, attempts: state?.attempts ?? 0 },
        { status: 423 },
      );
    }
    if (state?.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()) {
      return Response.json(
        {
          error: "Verification is on cooldown",
          cooldownUntil: state.cooldownUntil.toISOString(),
          attempts: state.attempts,
        },
        { status: 429 },
      );
    }
    stage = "active_token_lookup";
    const active = await db
      .select({
        token: dependencies.verifyTokens.token,
        referenceId: dependencies.verifyTokens.referenceId,
      })
      .from(dependencies.verifyTokens)
      .where(
        and(
          eq(dependencies.verifyTokens.userId, userId),
          eq(dependencies.verifyTokens.guildId, guildId),
          gt(dependencies.verifyTokens.expiresAt, now),
          inArray(dependencies.verifyTokens.status, ["pending", "bot_update_pending"]),
        ),
      )
      .limit(1);
    if (active[0]) {
      return Response.json({
        success: true,
        reused: true,
        token: active[0].token,
        referenceId: active[0].referenceId,
      });
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const crypto = await import("node:crypto");
      const referenceId = `AX-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
      try {
        stage = "token_insert";
        const inserted = await db
          .insert(dependencies.verifyTokens)
          .values({
            token,
            userId,
            guildId,
            guildName: guildName || "Unknown",
            guildMemberCount: guildMemberCount || 0,
            expiresAt: new Date(expiresAt),
            used: false,
            status: "pending",
            referenceId,
          })
          .onConflictDoNothing({ target: dependencies.verifyTokens.token })
          .returning({
            token: dependencies.verifyTokens.token,
            referenceId: dependencies.verifyTokens.referenceId,
          });
        if (inserted[0]) {
          await db
            .insert(dependencies.verificationState)
            .values({ guildId, userId, lastReferenceId: inserted[0].referenceId, updatedAt: now })
            .onConflictDoUpdate({
              target: [
                dependencies.verificationState.guildId,
                dependencies.verificationState.userId,
              ],
              set: { lastReferenceId: inserted[0].referenceId, updatedAt: now },
            });
          console.log("[bot/token] Saved successfully");
          return Response.json({
            success: true,
            token,
            referenceId: inserted[0].referenceId,
          });
        }

        stage = "token_conflict_lookup";
        const existingToken = (
          await db
            .select({
              referenceId: dependencies.verifyTokens.referenceId,
              userId: dependencies.verifyTokens.userId,
              guildId: dependencies.verifyTokens.guildId,
              expiresAt: dependencies.verifyTokens.expiresAt,
              status: dependencies.verifyTokens.status,
            })
            .from(dependencies.verifyTokens)
            .where(eq(dependencies.verifyTokens.token, token))
            .limit(1)
        )[0];
        if (
          existingToken?.userId === userId &&
          existingToken.guildId === guildId &&
          existingToken.expiresAt.getTime() > now.getTime() &&
          ["pending", "bot_update_pending"].includes(existingToken.status)
        ) {
          return Response.json({
            success: true,
            reused: true,
            token,
            referenceId: existingToken.referenceId,
          });
        }
        return Response.json(
          { error: "Token conflicts with an existing verification" },
          { status: 409 },
        );
      } catch (error) {
        if (isReferenceIdCollision(error)) continue;
        return failedResponse(stage, error);
      }
    }
    console.error("[bot/token] Could not allocate a unique verification reference");
    return Response.json({ error: "Could not allocate verification reference" }, { status: 503 });
  } catch (error) {
    return failedResponse(stage, error);
  }
}

export const Route = createFileRoute("/api/bot/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const [{ validateApiKey }, { verifyTokens, verificationState, auditLogs }, { getDb }] =
            await Promise.all([
              import("@/lib/api-auth.server"),
              import("@/lib/db/schema"),
              import("@/lib/db/client.server"),
            ]);
          return handleBotTokenRequest(request, {
            validateApiKey,
            auditLogs,
            verifyTokens,
            verificationState,
            getDb,
          });
        } catch (error) {
          return failedResponse("dependency_loading", error);
        }
      },
    },
  },
});
