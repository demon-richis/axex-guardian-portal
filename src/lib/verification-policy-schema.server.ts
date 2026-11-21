import { sql } from "drizzle-orm";

export function isVerificationPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["VERIFICATION_POLICY_ENABLED"] === "true";
}

type DbLike = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

export async function warnIfVerificationPolicySchemaMissing(
  getDb: () => DbLike,
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Console, "warn"> = console,
): Promise<boolean> {
  if (!isVerificationPolicyEnabled(env)) return true;

  try {
    const result = (await getDb().execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'verify_tokens' AND column_name = 'policy')
          OR (table_name = 'verification_state' AND column_name = 'policy'))
    `)) as { rows?: Array<{ table_name?: string; column_name?: string }> };
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missing = ["verify_tokens.policy", "verification_state.policy"].filter(
      (column) => !found.has(column),
    );
    if (missing.length > 0) {
      logger.warn(
        `[portal] VERIFICATION_POLICY_ENABLED=true but migration 0009 is incomplete; missing ${missing.join(", ")}. Policy persistence is unavailable.`,
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.warn(
      `[portal] Could not verify migration 0009 at startup; policy persistence may be unavailable (${error instanceof Error ? error.name : "unknown"}).`,
    );
    return false;
  }
}
