import "dotenv/config";

export function validateApiKey(request: Request): Response | null {
  const expected = process.env["AXEX_BOT_API_KEY"];
  const provided = request.headers.get("x-api-key");
  const valid = Boolean(expected && provided && provided === expected);
  console.log("[api-auth] Key check:", valid ? "PASS" : "FAIL");

  if (valid) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
