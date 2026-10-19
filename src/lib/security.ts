import { z } from "zod";

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https://cdn.discordapp.com https://*.discordapp.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://challenges.cloudflare.com https://discord.com",
    "frame-src https://challenges.cloudflare.com",
  ].join("; ");
}

export function applySecurityHeaders(
  request: Request,
  response: Response,
  nonce: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (new URL(request.url).pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function validateRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  isProduction = env["NODE_ENV"] === "production",
): void {
  const trustedProxyMode = env["TRUSTED_PROXY_MODE"] ?? "none";
  if (!["vercel", "cloudflare", "none"].includes(trustedProxyMode)) {
    throw new Error("TRUSTED_PROXY_MODE must be vercel, cloudflare, or none");
  }
  const rateLimitBackend = env["RATE_LIMIT_BACKEND"] ?? "neon";
  if (!["neon", "memory"].includes(rateLimitBackend)) {
    throw new Error("RATE_LIMIT_BACKEND must be neon or memory");
  }
  if (isProduction && rateLimitBackend !== "neon") {
    throw new Error("RATE_LIMIT_BACKEND=memory is not permitted in production");
  }
  if (!isProduction) return;

  const productionEnvironment = z
    .object({
      DATABASE_URL: z.string().min(1),
      SESSION_SECRET: z.string().trim().min(32),
      DISCORD_CLIENT_ID: z.string().min(1),
      DISCORD_CLIENT_SECRET: z.string().min(1),
      DISCORD_REDIRECT_URI: z.string().url(),
      TURNSTILE_SITE_KEY: z.string().min(1),
      TURNSTILE_SECRET_KEY: z.string().min(1),
      BOT_WEBHOOK_URL: z.string().url(),
      BOT_TO_PORTAL_KEY: z.string().min(32).optional(),
      PORTAL_TO_BOT_KEY: z.string().min(32).optional(),
      AXEX_BOT_API_KEY: z.string().min(32).optional(),
      CRON_SECRET: z.string().min(32),
      TRUSTED_PROXY_MODE: z.enum(["vercel", "cloudflare"]),
      RATE_LIMIT_BACKEND: z.literal("neon"),
      INTELLIGENCE_URL: z.string().url(),
      INTELLIGENCE_API_KEY: z.string().min(1),
    })
    .superRefine((values, context) => {
      if (!(values.BOT_TO_PORTAL_KEY && values.PORTAL_TO_BOT_KEY) && !values.AXEX_BOT_API_KEY) {
        context.addIssue({
          code: "custom",
          path: ["BOT_TO_PORTAL_KEY"],
          message: "both directional keys or the legacy one-release key are required",
        });
      }
    });
  const result = productionEnvironment.safeParse({
    DATABASE_URL: env["DATABASE_URL"],
    SESSION_SECRET: env["SESSION_SECRET"],
    DISCORD_CLIENT_ID: env["DISCORD_CLIENT_ID"],
    DISCORD_CLIENT_SECRET: env["DISCORD_CLIENT_SECRET"],
    DISCORD_REDIRECT_URI: env["DISCORD_REDIRECT_URI"],
    TURNSTILE_SITE_KEY: env["TURNSTILE_SITE_KEY"],
    TURNSTILE_SECRET_KEY: env["TURNSTILE_SECRET_KEY"],
    BOT_WEBHOOK_URL: env["BOT_WEBHOOK_URL"],
    BOT_TO_PORTAL_KEY: env["BOT_TO_PORTAL_KEY"],
    PORTAL_TO_BOT_KEY: env["PORTAL_TO_BOT_KEY"],
    AXEX_BOT_API_KEY: env["AXEX_BOT_API_KEY"],
    CRON_SECRET: env["CRON_SECRET"],
    TRUSTED_PROXY_MODE: trustedProxyMode,
    RATE_LIMIT_BACKEND: rateLimitBackend,
    INTELLIGENCE_URL: env["INTELLIGENCE_URL"],
    INTELLIGENCE_API_KEY: env["INTELLIGENCE_API_KEY"],
  });
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid production environment: ${details}`);
  }
}
