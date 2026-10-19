import { isIP } from "node:net";

export type TrustedProxyMode = "vercel" | "cloudflare" | "none";

function normalizeIp(value: string | null): string {
  const candidate = value?.split(",")[0]?.trim() ?? "";
  return isIP(candidate) ? candidate : "";
}

export function clientIp(
  request: Request,
  mode: string | undefined = process.env["TRUSTED_PROXY_MODE"],
): string {
  const trustedMode = mode ?? "none";
  if (trustedMode === "vercel") {
    return (
      normalizeIp(request.headers.get("x-vercel-forwarded-for")) ||
      normalizeIp(request.headers.get("x-real-ip"))
    );
  }
  if (trustedMode === "cloudflare") return normalizeIp(request.headers.get("cf-connecting-ip"));
  if (trustedMode === "none") return "";
  throw new Error("TRUSTED_PROXY_MODE must be vercel, cloudflare, or none");
}
