import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const OAUTH_STATE_COOKIE = "axex_oauth_state";
const SESSION_COOKIE = "axex_session";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 15 * 60;

type OAuthStatePayload = { nonce: string; token: string; exp: number };
type SessionPayload = { token: string; discordId: string; exp: number };

type CookieOptions = {
  maxAge: number;
  sameSite: "Lax";
};

function sessionSecret(): string {
  const secret = process.env["SESSION_SECRET"]?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is not configured with sufficient entropy");
  }
  return secret;
}

function encode(payload: OAuthStatePayload | SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function serialize(name: string, value: string, options: CookieOptions): string {
  return `${name}=${value}; Max-Age=${options.maxAge}; Path=/; HttpOnly; Secure; SameSite=${options.sameSite}`;
}

function verifySignedValue(value: string): string | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  const expected = sign(payload);
  const providedBytes = Buffer.from(provided, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (providedBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(providedBytes, expectedBytes)) return null;
  return payload;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function createOAuthState(
  token: string,
  now = Date.now(),
): { nonce: string; cookie: string } {
  const nonce = randomBytes(32).toString("base64url");
  const payload = encode({
    nonce,
    token,
    exp: Math.floor(now / 1000) + OAUTH_STATE_MAX_AGE_SECONDS,
  });
  return {
    nonce,
    cookie: serialize(OAUTH_STATE_COOKIE, `${payload}.${sign(payload)}`, {
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
      sameSite: "Lax",
    }),
  };
}

export function consumeOAuthState(
  request: Request,
  nonce: string,
  now = Date.now(),
): { token: string; clearCookie: string } | null {
  const raw = readCookie(request, OAUTH_STATE_COOKIE);
  if (!raw) return null;
  const encoded = verifySignedValue(raw);
  const payload = encoded ? decode<OAuthStatePayload>(encoded) : null;
  if (
    !payload ||
    !payload.token ||
    !payload.nonce ||
    payload.nonce !== nonce ||
    payload.exp < Math.floor(now / 1000)
  ) {
    return null;
  }
  return {
    token: payload.token,
    clearCookie: serialize(OAUTH_STATE_COOKIE, "", { maxAge: 0, sameSite: "Lax" }),
  };
}

export function createSessionCookie(token: string, discordId: string, now = Date.now()): string {
  const payload = encode({
    token,
    discordId,
    exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS,
  });
  return serialize(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    maxAge: SESSION_MAX_AGE_SECONDS,
    sameSite: "Lax",
  });
}

export function verifySession(
  request: Request,
  token: string,
  discordId?: string,
  now = Date.now(),
): boolean {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return false;
  const encoded = verifySignedValue(raw);
  const payload = encoded ? decode<SessionPayload>(encoded) : null;
  return Boolean(
    payload &&
    payload.token === token &&
    payload.discordId &&
    (!discordId || payload.discordId === discordId) &&
    payload.exp >= Math.floor(now / 1000),
  );
}

export function unauthorizedSessionResponse(): Response {
  return Response.json({ success: false, error: "session_required" }, { status: 401 });
}

export const sessionCookieNames = { oauthState: OAUTH_STATE_COOKIE, session: SESSION_COOKIE };
