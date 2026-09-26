export function hasBotApiAccess(request: Request): boolean {
  const expected = process.env["AXEX_BOT_API_KEY"];
  return !expected || request.headers.get("x-axex-bot-key") === expected;
}
