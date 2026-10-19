function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
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
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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
  const sessionSecret = env["SESSION_SECRET"]?.trim();
  if (isProduction && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters in production");
  }
  if (
    isProduction &&
    (!env["TURNSTILE_SITE_KEY"]?.trim() || !env["TURNSTILE_SECRET_KEY"]?.trim())
  ) {
    throw new Error("TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required in production");
  }
}
