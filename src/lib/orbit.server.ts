type OrbitResponse = {
  session?: unknown;
  success?: unknown;
};

function orbitConfig(): { origin: string; secret: string } {
  const configuredUrl =
    process.env["ORBIT_API_URL"]?.trim() || process.env["ORBIT_BASE_URL"]?.trim();
  const secret =
    process.env["ORBIT_SIGNING_SECRET"]?.trim() || process.env["ORBIT_SITE_SECRET"]?.trim();
  if (!configuredUrl || !secret) throw new Error("Orbit is not configured");
  const url = new URL(configuredUrl);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (process.env["NODE_ENV"] === "production" && url.protocol !== "https:")
  ) {
    throw new Error("ORBIT_BASE_URL must be an origin-only HTTPS URL in production");
  }

  return { origin: url.origin, secret };
}

export function orbitEnabled(): boolean {
  return process.env["ORBIT_ENABLED"]?.trim().toLowerCase() === "true";
}

async function postOrbit(path: string, body: Record<string, string>): Promise<OrbitResponse> {
  const { origin, secret } = orbitConfig();
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Orbit request failed with HTTP ${response.status}`);
  const result = (await response.json().catch(() => null)) as OrbitResponse | null;
  if (!result) throw new Error("Orbit returned an invalid response");
  return result;
}

export function orbitPublicOrigin(): string {
  return orbitConfig().origin;
}

export async function createOrbitSession(userId: string, guildId: string): Promise<string> {
  const result = await postOrbit("/v1/session", { userId, guildId, difficulty: "high" });
  if (typeof result.session !== "string" || !result.session) {
    throw new Error("Orbit did not return a session");
  }
  return result.session;
}

export async function verifyOrbitProof(
  token: string,
  userId: string,
  guildId: string,
): Promise<boolean> {
  const result = await postOrbit("/v1/siteverify", { token, userId, guildId });
  return result.success === true;
}
