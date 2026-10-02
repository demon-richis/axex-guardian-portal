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
): Promise<void> {
  const query = new URLSearchParams({ guildId });
  if (profile.username) query.set("username", profile.username);
  if (profile.avatar) query.set("avatar", profile.avatar);
  if (profile.createdTimestamp) query.set("createdTimestamp", String(profile.createdTimestamp));

  const response = await intelligenceFetch(
    `/analyze/${encodeURIComponent(userId)}?${query.toString()}`,
    { method: "GET" },
  );
  if (response) console.log("[intelligence] Portal analysis response:", response.status);
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
