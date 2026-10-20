import { timingSafeEqual } from "node:crypto";
import "dotenv/config";

let warnedLegacyKey = false;

export function validateApiKey(request: Request): Response | null {
  const provided = request.headers.get("x-api-key");
  const candidates = [
    { value: process.env["BOT_TO_PORTAL_KEY"], legacy: false },
    { value: process.env["AXEX_BOT_API_KEY"], legacy: true },
  ].filter((candidate): candidate is { value: string; legacy: boolean } =>
    Boolean(candidate.value),
  );
  const providedBytes = provided ? Buffer.from(provided, "utf8") : null;
  let valid = false;
  let usedLegacyKey = false;
  for (const candidate of candidates) {
    const expectedBytes = Buffer.from(candidate.value, "utf8");
    const matches = Boolean(
      providedBytes &&
      expectedBytes.length === providedBytes.length &&
      timingSafeEqual(expectedBytes, providedBytes),
    );
    valid ||= matches;
    usedLegacyKey ||= matches && candidate.legacy;
  }
  if (usedLegacyKey && !warnedLegacyKey) {
    console.warn("[api-auth] AXEX_BOT_API_KEY is deprecated; configure BOT_TO_PORTAL_KEY");
    warnedLegacyKey = true;
  }
  if (valid) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function validateCronSecret(request: Request): Response | null {
  const expected = process.env["CRON_SECRET"];
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const expectedBytes = expected ? Buffer.from(expected, "utf8") : null;
  const providedBytes = provided ? Buffer.from(provided, "utf8") : null;
  const valid = Boolean(
    expectedBytes &&
    providedBytes &&
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes),
  );
  if (valid) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
