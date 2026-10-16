import { timingSafeEqual } from "node:crypto";
import "dotenv/config";

export function validateApiKey(request: Request): Response | null {
  const expected = process.env["AXEX_BOT_API_KEY"];
  const provided = request.headers.get("x-api-key");
  const expectedBytes = expected ? Buffer.from(expected, "utf8") : null;
  const providedBytes = provided ? Buffer.from(provided, "utf8") : null;
  const valid = Boolean(
    expectedBytes &&
    providedBytes &&
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes),
  );
  console.log("[api-auth] Key check:", valid ? "PASS" : "FAIL");

  if (valid) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
