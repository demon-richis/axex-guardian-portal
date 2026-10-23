import { randomBytes } from "node:crypto";
import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { applySecurityHeaders, validateRuntimeEnvironment } from "./lib/security";

if (import.meta.env.SSR) {
  validateRuntimeEnvironment();

  if (process.env["BOT_WEBHOOK_URL"]) {
    console.log("[portal] Bot verification callback configured");
  } else {
    console.warn("[portal] BOT_WEBHOOK_URL is not configured");
  }

  if (process.env["BOT_WEBHOOK_URL"]) {
    try {
      const webhookUrl = new URL(process.env["BOT_WEBHOOK_URL"]);
      if (process.env["NODE_ENV"] === "production" && webhookUrl.protocol !== "https:") {
        console.error(
          "[portal] SECURITY WARNING: BOT_WEBHOOK_URL uses plaintext HTTP. Put the bot receiver behind a TLS reverse proxy or HTTPS tunnel before production use.",
        );
      }
    } catch {
      // Runtime environment validation reports malformed URLs before requests are served.
    }
  }

  for (const name of [
    "DATABASE_URL",
    "BOT_TO_PORTAL_KEY",
    "PORTAL_TO_BOT_KEY",
    "AXEX_BOT_API_KEY",
    "BOT_WEBHOOK_URL",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_REDIRECT_URI",
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "PROXYCHECK_API_KEY",
    "INTELLIGENCE_URL",
    "INTELLIGENCE_API_KEY",
    "CRON_SECRET",
    "TRUSTED_PROXY_MODE",
  ]) {
    const legacyApiKeyConfigured =
      name === "BOT_TO_PORTAL_KEY" || name === "PORTAL_TO_BOT_KEY"
        ? Boolean(process.env["AXEX_BOT_API_KEY"])
        : false;
    if (!process.env[name] && !legacyApiKeyConfigured)
      console.warn(`[portal] ${name} is not configured; related functionality may be unavailable`);
  }
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const securityHeadersMiddleware = createMiddleware().server(async ({ request, next }) => {
  const nonce = randomBytes(16).toString("base64");
  const result = await next({ context: { cspNonce: nonce } });
  return applySecurityHeaders(request, result.response, nonce);
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, errorMiddleware, csrfMiddleware],
}));
