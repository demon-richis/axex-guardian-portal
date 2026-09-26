export type WebhookEvent =
  | "VERIFIED"
  | "VPN_BLOCKED"
  | "BOT_DETECTED"
  | "WRONG_ANSWER"
  | "TIMEOUT"
  | "SUSPICIOUS"
  | "AUTO_BANNED";

export type WebhookData = {
  user: string;
  id: string;
  accountAgeDays: number | null;
  clickMs: number | null;
  ip: string | null;
  vpnType: string | null;
  verdict: string;
  guildName?: string;
  reason?: string | null;
};

const COLORS: Record<WebhookEvent, number> = {
  VERIFIED: 0x84cc16,
  VPN_BLOCKED: 0xdc2626,
  BOT_DETECTED: 0xdc2626,
  WRONG_ANSWER: 0xef4444,
  TIMEOUT: 0xfbbf24,
  SUSPICIOUS: 0xf97316,
  AUTO_BANNED: 0x7f1d1d,
};

export function buildWebhookPayload(event: WebhookEvent, data: WebhookData): object {
  const lines = [
    `> **${event.replaceAll("_", " ")}**`,
    data.reason ? `> ${data.reason}` : "> Axex verification event",
  ];
  return {
    embeds: [
      {
        description: lines.join("\n"),
        color: COLORS[event],
        fields: [
          { name: "User", value: data.user || "Unknown", inline: true },
          { name: "ID", value: data.id || "Unknown", inline: true },
          { name: "Account Age", value: formatValue(data.accountAgeDays, "days"), inline: true },
          { name: "Click Speed", value: formatValue(data.clickMs, "ms"), inline: true },
          { name: "IP", value: data.ip || "Unknown", inline: true },
          { name: "VPN Type", value: data.vpnType || "None", inline: true },
          { name: "Verdict", value: data.verdict, inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatValue(value: number | null, suffix: string): string {
  return value === null ? "Unknown" : `${value} ${suffix}`;
}

export async function postWebhook(
  webhookUrl: string,
  event: WebhookEvent,
  data: WebhookData,
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWebhookPayload(event, data)),
    });
    if (!response.ok) console.error("Guild webhook failed", response.status, await response.text());
  } catch (error) {
    console.error("Guild webhook request failed", error);
  }
}
