type IntelligenceEvent = {
  userId: string;
  guildId: string;
  eventType: string;
  clickMs?: number | null;
  metadata?: Record<string, unknown>;
};

type IntelligenceProfile = {
  username?: string | null;
  avatar?: string | null;
  createdTimestamp?: number | null;
};

export type IntelligenceResult = {
  userId?: string;
  riskScore?: number;
  riskLevel?: string;
  recommendation?: string;
  confidence?: string;
  reasons?: string[];
  breakdown?: Record<string, unknown>;
};

function intelligenceConfig(): { url: string; key: string } | null {
  const url = process.env["INTELLIGENCE_URL"]?.trim().replace(/\/$/, "");
  const key = process.env["INTELLIGENCE_API_KEY"]?.trim();
  return url && key ? { url, key } : null;
}

async function intelligenceFetch(path: string, init: RequestInit): Promise<Response | null> {
  const config = intelligenceConfig();
  if (!config) {
    console.warn("[intelligence] INTELLIGENCE_URL/API_KEY is not configured");
    return null;
  }

  try {
    return await fetch(`${config.url}${path}`, {
      ...init,
      headers: {
        "X-API-Key": config.key,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    console.error(
      "[intelligence] Request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

export async function analyzePortalUser(
  userId: string,
  guildId: string,
  profile: IntelligenceProfile = {},
): Promise<IntelligenceResult | null> {
  const query = new URLSearchParams({ guildId });
  if (profile.username) query.set("username", profile.username);
  if (profile.avatar) query.set("avatar", profile.avatar);
  if (profile.createdTimestamp) query.set("createdTimestamp", String(profile.createdTimestamp));

  const response = await intelligenceFetch(
    `/analyze/${encodeURIComponent(userId)}?${query.toString()}`,
    { method: "GET" },
  );
  if (!response) return null;
  console.log("[intelligence] Portal analysis response:", response.status);
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as IntelligenceResult | null;
}

export async function notifyBotIntelligence(
  userId: string,
  guildId: string,
  result: IntelligenceResult,
  source: string,
): Promise<void> {
  const configuredUrl = process.env["BOT_WEBHOOK_URL"]?.trim();
  const apiKey = process.env["AXEX_BOT_API_KEY"]?.trim();
  if (!configuredUrl || !apiKey) return;

  try {
    const url = new URL(configuredUrl);
    url.pathname = "/webhook/intelligence-event";
    url.search = "";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ userId, guildId, source, result }),
      signal: AbortSignal.timeout(4000),
    });
    console.log("[intelligence] Bot log response:", response.status);
  } catch (error) {
    console.error(
      "[intelligence] Bot log request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function recordPortalEvent(event: IntelligenceEvent): Promise<void> {
  const response = await intelligenceFetch("/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (response)
    console.log("[intelligence] Portal event response:", response.status, event.eventType);
}
