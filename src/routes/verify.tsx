import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

export const Route = createFileRoute("/verify")({
  validateSearch: z.object({
    token: z.string().optional(),
    auth: z.coerce.string().optional(),
    error: z.string().optional(),
    demo: z.coerce.string().optional(),
  }),
  head: () => ({
    meta: [
      { title: "Axex Verification — Secure Server Access" },
      {
        name: "description",
        content: "Verify your Discord account with Axex to gain access to the server.",
      },
      { property: "og:title", content: "Axex Verification" },
      { property: "og:description", content: "Secure Discord server verification by Axex." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VerifyPage,
});

const QUESTIONS = [
  {
    q: "Which of these is NOT a number?",
    options: ["Seven", "Four", "Blue", "Nine"],
    answer: "Blue",
  },
  {
    q: "Which of these is a fruit?",
    options: ["Chair", "Apple", "Window", "Cloud"],
    answer: "Apple",
  },
  {
    q: "What comes after Monday?",
    options: ["Sunday", "Friday", "Tuesday", "January"],
    answer: "Tuesday",
  },
  {
    q: "Which of these is NOT a color?",
    options: ["Red", "Eleven", "Blue", "Green"],
    answer: "Eleven",
  },
  { q: "How many sides does a triangle have?", options: ["4", "5", "3", "6"], answer: "3" },
  {
    q: "Which of these is an animal?",
    options: ["Table", "River", "Eagle", "Thunder"],
    answer: "Eagle",
  },
  {
    q: "Which season comes after Winter?",
    options: ["Autumn", "Summer", "Spring", "Storm"],
    answer: "Spring",
  },
  {
    q: "Which of these is NOT a planet?",
    options: ["Mars", "Venus", "Cloud", "Saturn"],
    answer: "Cloud",
  },
  { q: "What is 5 + 3?", options: ["7", "9", "6", "8"], answer: "8" },
  {
    q: "Which of these is a vehicle?",
    options: ["Mountain", "Train", "Ocean", "Forest"],
    answer: "Train",
  },
];

type TokenInfo = {
  guildName: string;
  guildMemberCount: number;
  discordUser: { id: string; username: string; avatar: string | null; createdAt: string } | null;
  expiresAt?: string;
  status?: string;
  referenceId?: string | null;
  attempts?: number;
  cooldownUntil?: string | null;
  failureReason?: string | null;
  botAcknowledged?: boolean;
  botError?: string | null;
};
type ErrorKind =
  "invalid" | "used" | "timeout" | "lockout" | "auth" | "network" | "bot" | "generic";
type Phase = "loading" | "auth" | "vpn" | "captcha" | "cooldown" | "pending" | "done" | "error";

const ERRORS: Record<ErrorKind, [string, string]> = {
  invalid: ["Invalid Link", "This verification link is invalid or has expired."],
  used: ["Already Verified", "This link has already been used."],
  timeout: ["Time Expired", "You did not complete verification in time. Contact server staff."],
  lockout: ["Verification Locked", "Too many failed attempts — contact server staff"],
  auth: [
    "Discord authorization cancelled",
    "No result was submitted. You can try authorizing again.",
  ],
  network: [
    "Security check unavailable",
    "We could not complete the network check. Try again in a moment; verification will not continue until it succeeds.",
  ],
  bot: [
    "Discord update is taking longer than usual",
    "Your verification was accepted, but Discord has not confirmed the role update yet. Contact a moderator with your reference code if the role does not appear shortly.",
  ],
  generic: ["Something went wrong", "Please try again or contact server staff."],
};

function track(token: string, event: Parameters<typeof telemetryEvent>[1]): void {
  if (!token || typeof navigator === "undefined") return;
  void telemetryEvent(token, event);
}

async function telemetryEvent(token: string, event: string): Promise<void> {
  try {
    await fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        event,
        device: window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop",
      }),
      keepalive: true,
    });
  } catch {
    // Telemetry must never interrupt verification.
  }
}

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3 },
};

function readAttemptCount(key: string): number {
  try {
    const stored = Number(window.localStorage.getItem(key) ?? 0);
    return Number.isFinite(stored) ? stored : 0;
  } catch (error) {
    console.error("[verify] Could not read local attempt count:", error);
    return 0;
  }
}

function writeAttemptCount(key: string, attempts: number): void {
  try {
    window.localStorage.setItem(key, String(attempts));
  } catch (error) {
    console.error("[verify] Could not save local attempt count:", error);
  }
}

function formatCountdown(seconds: number | null): string {
  if (seconds === null) return "calculating…";
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function VerifyPage() {
  const { token = "", auth, error, demo } = Route.useSearch();
  const demoMode = demo === "1";
  const effectiveToken = demoMode ? "demo-local" : token;
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);
  const [loadingStage, setLoadingStage] = useState(0);
  const [question] = useState(() => QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]!);

  const attemptKey = `axex:verify-attempts:${effectiveToken}`;

  useEffect(() => {
    if (!token && !demoMode) return;
    const stored = readAttemptCount(attemptKey);
    console.log("[verify] Loaded local attempt count:", stored);
    setAttempts(stored);
  }, [attemptKey, demoMode, token]);

  useEffect(() => {
    if (!info?.expiresAt) return;
    const tick = () =>
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(info.expiresAt!).getTime() - Date.now()) / 1000)),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [info?.expiresAt]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () =>
      setCooldownSeconds(
        Math.max(0, Math.ceil((new Date(cooldownUntil).getTime() - Date.now()) / 1000)),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  useEffect(() => {
    console.log("[verify] Phase:", phase, { busy, hasUser: Boolean(info?.discordUser) });
  }, [busy, info?.discordUser, phase]);

  useEffect(() => {
    if (phase !== "loading") return;
    setLoadingStage(0);
    const id = window.setInterval(() => {
      setLoadingStage((current) => Math.min(current + 1, 4));
    }, 1800);
    return () => window.clearInterval(id);
  }, [phase]);

  const fail = useCallback((k: ErrorKind) => {
    console.error("[verify] Transitioning to error:", k);
    setErrorKind(k);
    setPhase("error");
  }, []);

  const runIpCheck = useCallback(
    async (signal?: AbortSignal) => {
      console.log("[verify] Step 2: Starting IP check");
      setBusy(true);
      try {
        const response = await fetch("/api/check-ip", {
          cache: "no-store",
          ...(signal ? { signal } : {}),
        });
        console.log("[verify] IP check response:", response.status);
        if (!response.ok) throw new Error(`IP check failed with status ${response.status}`);
        const result = (await response.json()) as {
          status?: string;
          isVPN?: boolean;
          type?: string | null;
        };
        console.log("[verify] IP check completed:", {
          status: result.status,
          isVPN: result.isVPN === true,
        });
        if (signal?.aborted) return;
        if (result.status === "blocked" || result.isVPN) {
          track(token, "network_blocked");
          setPhase("vpn");
        } else if (result.status === "clear") {
          track(token, "network_clear");
          setPhase("captcha");
        } else {
          track(token, "network_unavailable");
          fail("network");
        }
      } catch (error) {
        if (signal?.aborted) return;
        console.error("[verify] IP check failed; stopping verification:", error);
        track(token, "network_unavailable");
        fail("network");
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [fail, token],
  );

  const startDemo = useCallback(() => {
    console.log("[verify] Demo started; moving to Step 2");
    setPhase("captcha");
  }, []);

  useEffect(() => {
    console.log("[verify] Route initialized:", {
      hasToken: Boolean(token),
      authCompleted: auth === "1",
      hasError: Boolean(error),
      demoMode,
    });
    track(token, "page_opened");
    if (demoMode) {
      console.log("[verify] Demo mode: loading sample identity");
      setInfo({
        guildName: "Axex Demo Server",
        guildMemberCount: 1284,
        discordUser: {
          id: "80351110224678912",
          username: "demo_user",
          avatar: null,
          createdAt: "2018-01-01T00:00:00.000Z",
        },
      });
      console.log("[verify] Demo identity loaded; showing Step 1 after preparation delay");
      window.setTimeout(() => {
        setPhase("auth");
      }, 9000);
      return;
    }
    if (!token) return fail("invalid");
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        console.log("[verify] Validating verification token");
        const minimumPreparation = new Promise<void>((resolve) => window.setTimeout(resolve, 9000));
        const res = await fetch(`/api/verify/${encodeURIComponent(token)}`);
        console.log("[verify] Token validation response:", res.status);
        if (!res.ok) throw new Error(`Token validation failed with status ${res.status}`);
        const data = (await res.json()) as TokenInfo & { valid: boolean; reason?: string };
        console.log("[verify] Token validation result:", {
          valid: data.valid,
          reason: data.reason,
          hasDiscordIdentity: Boolean(data.discordUser),
        });
        if (!active) return;
        if (!data.valid) {
          if (data.reason === "cooldown") {
            setAttempts(data.attempts ?? 0);
            setCooldownUntil(data.cooldownUntil ?? null);
            setFailureReason(data.failureReason ?? null);
            setPhase("cooldown");
            return;
          }
          return fail(
            data.reason === "lockout"
              ? "lockout"
              : data.reason === "used"
                ? "used"
                : data.reason === "error"
                  ? "generic"
                  : "invalid",
          );
        }
        setInfo(data);
        setAttempts(data.attempts ?? 0);
        await minimumPreparation;
        if (!active) return;
        if (error) return fail(error === "auth" ? "auth" : "generic");
        if (auth && data.discordUser) {
          console.log("[verify] OAuth complete: identity found; moving from Step 1 to Step 2");
          console.log("[verify] Keeping TanStack-managed URL state intact");
          await runIpCheck(controller.signal);
        } else if (auth) {
          console.error("[verify] OAuth completed but token has no stored Discord identity");
          fail(error === "auth" ? "auth" : "generic");
        } else {
          console.log("[verify] OAuth not complete; showing Step 1");
          setPhase("auth");
        }
      } catch (error) {
        if (!active) return;
        console.error("[verify] Initialization failed:", error);
        fail("generic");
      }
    })();
    return () => {
      active = false;
      controller.abort();
      console.log("[verify] Initialization cancelled or component unmounted");
    };
  }, [attemptKey, token, auth, error, demoMode, fail, runIpCheck]);

  const submitAttempt = useCallback(
    async (
      passed: boolean,
      clickMs: number,
      timeout = false,
      failureReason?: "WRONG_ANSWER" | "TIMEOUT" | "BOT_DETECTED" | "VPN_BLOCKED",
      honeypotTriggered = false,
    ) => {
      console.log("[verify] Submitting verification result:", {
        passed,
        timeout,
        honeypotTriggered,
      });
      if (demoMode) {
        console.log("[verify] Demo result accepted locally");
        return { success: true, passed };
      }
      const u = info?.discordUser;
      const response = await fetch("/api/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          discordId: u?.id,
          discordTag: u?.username,
          discordAvatar: u?.avatar,
          passed,
          vpnDetected: false,
          accountAgeDays: u
            ? Math.floor((Date.now() - new Date(u.createdAt).getTime()) / 86400000)
            : 0,
          clickMs,
          timeout,
          failureReason,
          honeypotTriggered,
        }),
      }).catch((requestError: unknown) => {
        console.error("[verify] Callback request failed:", requestError);
        return null;
      });
      if (!response) return null;
      console.log("[verify] Callback response:", response.status);
      track(token, response.ok ? "callback_sent" : "callback_failed");
      return (await response.json().catch((parseError: unknown) => {
        console.error("[verify] Could not parse callback response:", parseError);
        return null;
      })) as {
        success?: boolean;
        passed?: boolean;
        attempts?: number;
        status?: string;
        referenceId?: string | null;
        cooldownUntil?: string | null;
        failureReason?: string | null;
        locked?: boolean;
        error?: string;
      } | null;
    },
    [demoMode, info, token],
  );

  const complete = useCallback(
    async (clickMs: number, honeypotTriggered = false) => {
      console.log("[verify] Step 2 passed; submitting completion");
      const result = await submitAttempt(true, clickMs, false, undefined, honeypotTriggered);
      if (result?.success && result.passed) {
        console.log("[verify] Completion accepted; moving to Step 3");
        track(token, "captcha_passed");
        if (result.status === "completed") {
          track(token, "verification_completed");
          setPhase("done");
        } else {
          setPhase("pending");
          let completed = false;
          for (let i = 0; i < 8; i += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            const statusResponse = await fetch(`/api/verify/${encodeURIComponent(token)}`, {
              cache: "no-store",
            });
            const status = (await statusResponse.json()) as TokenInfo & { valid?: boolean };
            if (status.status === "completed") {
              setInfo((current) => (current ? { ...current, ...status } : current));
              track(token, "verification_completed");
              setPhase("done");
              completed = true;
              break;
            }
          }
          if (!completed) fail("bot");
        }
      } else {
        console.error("[verify] Completion rejected");
        track(
          token,
          result?.error === "network_check_unavailable" ? "network_unavailable" : "callback_failed",
        );
        if (result?.cooldownUntil && (result.attempts ?? 0) < 3) {
          setAttempts(result.attempts ?? attempts);
          setCooldownUntil(result.cooldownUntil);
          setFailureReason(result.failureReason ?? "Verification failed");
          setPhase("cooldown");
        } else {
          fail(
            result?.error === "network_check_unavailable"
              ? "network"
              : result?.attempts && result.attempts >= 3
                ? "lockout"
                : "generic",
          );
        }
      }
    },
    [attempts, fail, submitAttempt, token],
  );

  const failedAttempt = useCallback(
    async (
      clickMs: number,
      timeout = false,
      failureReason: "WRONG_ANSWER" | "TIMEOUT" = timeout ? "TIMEOUT" : "WRONG_ANSWER",
      honeypotTriggered = false,
    ) => {
      const nextAttempts = attempts + (timeout ? 0 : 1);
      console.log("[verify] Step 2 failed:", { timeout, nextAttempts, honeypotTriggered });
      if (!timeout) {
        writeAttemptCount(attemptKey, nextAttempts);
        setAttempts(nextAttempts);
      }
      const result = await submitAttempt(
        false,
        clickMs,
        timeout,
        honeypotTriggered ? "BOT_DETECTED" : failureReason,
        honeypotTriggered,
      );
      track(token, timeout ? "verification_error" : "captcha_failed");
      const serverAttempts = result?.attempts ?? nextAttempts;
      if (result?.cooldownUntil && serverAttempts < 3) {
        setAttempts(serverAttempts);
        setCooldownUntil(result.cooldownUntil);
        setFailureReason(result.failureReason ?? failureReason);
        setPhase("cooldown");
      } else if (serverAttempts >= 3 || result?.locked) {
        fail("lockout");
      } else if (timeout) {
        fail("timeout");
      }
    },
    [attemptKey, attempts, fail, submitAttempt, token],
  );

  const step =
    phase === "auth" || phase === "vpn" || phase === "loading"
      ? 0
      : phase === "captcha" || phase === "cooldown" || phase === "pending"
        ? 1
        : 2;
  const user = info?.discordUser;
  const ageDays = user
    ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000)
    : null;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,var(--red)_0%,transparent_70%)] opacity-[0.08]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,var(--green)_0%,transparent_70%)] opacity-[0.06]" />

      <CardShell phase={phase}>
        {phase === "loading" || busy ? (
          <VerificationLoader stage={busy ? 2 : loadingStage} networkCheck={busy} />
        ) : null}
        {phase !== "error" && phase !== "loading" && <Steps step={step} />}

        <AnimatePresence mode="wait">
          {phase === "error" && (
            <motion.div key="err" {...fade}>
              <ErrorAlert
                title={ERRORS[errorKind][0]}
                desc={ERRORS[errorKind][1]}
                referenceId={info?.referenceId ?? null}
                onRetry={errorKind === "network" ? runIpCheck : undefined}
              />
            </motion.div>
          )}

          {phase === "cooldown" && (
            <motion.div key="cooldown" {...fade} className="space-y-5 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[var(--amber)]/40 bg-[var(--amber)]/10 text-2xl">
                ⏳
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Verification paused</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Your verification was not accepted. You can try again after the cooldown.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--amber)]/30 bg-[var(--amber)]/10 p-4 text-left">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--amber)]">Reason</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {failureReason === "WRONG_ANSWER"
                    ? "Wrong answer"
                    : failureReason === "TIMEOUT"
                      ? "Verification timed out"
                      : (failureReason ?? "Verification failed")}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Attempt {Math.min(attempts, 3)} of 3 · You may retry in
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {formatCountdown(cooldownSeconds)}
                </p>
              </div>
              {info?.referenceId && (
                <p className="text-xs text-muted-foreground">
                  Reference: <strong className="text-foreground">{info.referenceId}</strong>
                </p>
              )}
              {cooldownSeconds === 0 ? (
                <PrimaryButton onClick={() => window.location.reload()}>
                  Try verification again
                </PrimaryButton>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Return using the same verification link when the timer ends.
                </p>
              )}
            </motion.div>
          )}

          {(phase === "auth" || phase === "vpn") && info && (
            <motion.div key="auth" {...fade} className="space-y-4">
              <Header info={info} />
              {phase === "vpn" ? (
                <motion.div
                  initial={{ opacity: 0, y: -16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  <div className="animate-[redglow_2s_ease-in-out_infinite] rounded-xl border border-destructive/40 bg-[var(--red-soft)] p-4">
                    <div className="flex gap-3">
                      <ShieldX />
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          VPN / Proxy Detected
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          We detected a VPN or proxy on your connection. Disable it completely, then
                          retry. Your link remains valid until it expires.
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--surface)] p-3">
                  <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[var(--red)]/40 to-[var(--green)]/20">
                    <div className="absolute inset-0 rounded-full backdrop-blur-md" />
                    <LockIcon />
                  </div>
                  <div>
                    <p className="text-sm italic text-muted-foreground">Authenticate to continue</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--red)]" />
                      Awaiting Discord login
                    </p>
                  </div>
                </div>
              )}
              <Stats
                items={[
                  [
                    "Account Age",
                    ageDays !== null ? `${ageDays} days` : "—",
                    ageDays !== null ? "g" : "n",
                  ],
                  ["Network", phase === "vpn" ? "VPN Detected ✗" : "Pending", "r"],
                  ["Token", "✓ Valid", "g"],
                  ["Status", phase === "vpn" ? "Blocked" : "Awaiting", "r"],
                ]}
              />
              {phase === "vpn" ? (
                <PrimaryButton onClick={runIpCheck} disabled={busy}>
                  I've disabled it — Retry Check
                </PrimaryButton>
              ) : demoMode ? (
                <PrimaryButton onClick={startDemo}>Start Demo Verification</PrimaryButton>
              ) : (
                <PrimaryButton
                  onClick={() => (
                    track(token, "oauth_started"),
                    (window.location.href = `/api/auth/discord?token=${encodeURIComponent(token)}`)
                  )}
                >
                  <DiscordIcon /> Continue with Discord
                </PrimaryButton>
              )}
              {secondsLeft !== null && (
                <p className="text-center text-[11px] text-muted-foreground">
                  Link expires in{" "}
                  <strong className={secondsLeft < 60 ? "text-[var(--amber)]" : "text-foreground"}>
                    {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                  </strong>
                </p>
              )}
            </motion.div>
          )}

          {phase === "captcha" && info && user && (
            <motion.div key="captcha" {...fade}>
              <Captcha
                info={info}
                user={user}
                ageDays={ageDays ?? 0}
                question={question}
                onPass={complete}
                onFail={(clickMs, reason) => failedAttempt(clickMs, false, reason)}
                onTimeout={(clickMs) => failedAttempt(clickMs, true, "TIMEOUT")}
              />
            </motion.div>
          )}

          {phase === "pending" && info && (
            <motion.div key="pending" {...fade} className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[var(--green)]/30 bg-[var(--green-soft)]">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--green)]/20 border-t-[var(--green)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Verification accepted</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                We are notifying Discord now. This usually takes a few seconds. Keep this tab open.
              </p>
              {info.referenceId && (
                <p className="text-xs text-muted-foreground">
                  Reference <strong className="text-foreground">{info.referenceId}</strong>
                </p>
              )}
            </motion.div>
          )}

          {phase === "done" && info && (
            <motion.div
              key="done"
              {...fade}
              className="flex flex-col items-center py-4 text-center"
            >
              <svg viewBox="0 0 52 52" className="h-16 w-16">
                <circle
                  cx="26"
                  cy="26"
                  r="24"
                  fill="none"
                  stroke="var(--green)"
                  strokeOpacity="0.2"
                  strokeWidth="2"
                />
                <path
                  d="M15 27 l7 7 l15 -16"
                  fill="none"
                  stroke="var(--green)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="check-path"
                />
              </svg>
              <h2 className="mt-4 text-xl font-bold text-foreground">Verification Complete</h2>
              <p className="mt-1 text-sm text-muted-foreground">Welcome to {info.guildName}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {user && <Pill tone="g">@{user.username}</Pill>}
                <Pill tone="n">{info.guildName}</Pill>
                <Pill tone="g">Role granted</Pill>
              </div>
              <div className="my-5 h-px w-full bg-border" />
              <p className="text-sm text-muted-foreground">You may now close this tab.</p>
              <p className="mt-1 text-xs text-[var(--faint)]">
                Access has been granted to your account.
              </p>
              {info.referenceId && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reference: <strong className="text-foreground">{info.referenceId}</strong>
                </p>
              )}
              <div className="mt-5 flex w-full gap-2">
                <a
                  href="https://discord.com/app"
                  className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[var(--green)]/20 px-3 text-sm font-semibold text-foreground hover:bg-[var(--green)]/30"
                >
                  Open Discord
                </a>
                <a
                  href="/support"
                  className="flex min-h-11 items-center justify-center rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-accent"
                >
                  Support
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardShell>

      <div className="relative mt-6 flex flex-wrap justify-center gap-x-3 gap-y-1 text-center text-[11px] text-[var(--faint)]">
        <span>Secured by Axex • Your IP is checked privately</span>
        <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy
        </a>
        <a href="/support" className="underline underline-offset-2 hover:text-foreground">
          Having trouble?
        </a>
      </div>
    </main>
  );
}

function CardShell({ children, phase }: { children: React.ReactNode; phase: Phase }) {
  return (
    <div
      data-phase={phase}
      className={`relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.6),0_12px_32px_rgba(0,0,0,0.55),0_40px_100px_rgba(220,38,38,0.08)] ${phase === "loading" ? "min-h-[500px]" : ""}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[var(--red)] via-[var(--green)] to-transparent" />
      {children}
    </div>
  );
}

const LOADING_STAGES = [
  [
    "Validating verification link",
    "Confirming that this link is valid and belongs to this server.",
  ],
  [
    "Preparing Discord sign-in",
    "Loading the Discord identity check. Your password stays with Discord.",
  ],
  ["Checking network reputation", "Checking for VPN, proxy, or hosting connections."],
  ["Preparing the human check", "Loading one short question to confirm you are human."],
  ["Preparing access confirmation", "Getting the final verification result ready for the server."],
] as const;

function VerificationLoader({ stage, networkCheck }: { stage: number; networkCheck: boolean }) {
  const activeStage = Math.min(Math.max(stage, 0), LOADING_STAGES.length - 1);
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-card px-6 py-8"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-[330px]">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-foreground">Secure verification</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Preparing your verification</p>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {networkCheck ? "Checking" : `Step ${activeStage + 1} of 5`}
          </span>
        </div>

        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-[var(--pill)]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[var(--red)] via-[var(--amber)] to-[var(--green)]"
            animate={{
              width: `${Math.max(12, ((activeStage + 1) / LOADING_STAGES.length) * 100)}%`,
            }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        </div>

        <div className="space-y-2">
          {LOADING_STAGES.map(([title, description], index) => {
            const complete = index < activeStage && !networkCheck;
            const current = index === activeStage;
            return (
              <div
                key={title}
                className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
                  current
                    ? "border-[var(--green)]/30 bg-[var(--green-soft)]"
                    : "border-transparent bg-[var(--surface)] opacity-55"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    complete
                      ? "bg-[var(--green)]"
                      : current
                        ? "border border-[var(--green)] text-[var(--green)]"
                        : "bg-[var(--pill)] text-muted-foreground"
                  }`}
                >
                  {complete ? (
                    "✓"
                  ) : current ? (
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--green)]" />
                  ) : (
                    index + 1
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{title}</p>
                  {current && (
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          This usually takes a few seconds. Please keep this tab open.
        </p>
      </div>
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ["Auth", "Verify", "Done"];
  return (
    <div className="mb-5">
      <div className="flex items-center">
        {labels.map((l, i) => (
          <div key={l} className="flex flex-1 items-center last:flex-none">
            <div
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 ${
                i <= step
                  ? "bg-gradient-to-r from-[var(--red)] to-[var(--green)] text-foreground"
                  : "bg-[var(--pill)] text-muted-foreground"
              }`}
            >
              {l}
            </div>
            {i < labels.length - 1 && (
              <div className="mx-2 h-px flex-1 bg-[var(--pill)]">
                <motion.div
                  className="h-px bg-gradient-to-r from-[var(--red)] to-[var(--green)]"
                  animate={{ width: i < step ? "100%" : "0%" }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground" aria-live="polite">
        Step {step + 1} of 3 — {["Discord authentication", "Human verification", "Complete"][step]}
      </p>
    </div>
  );
}

function Header({ info }: { info: TokenInfo }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-gradient-to-r from-[var(--red)] to-[#450a0a] px-2.5 py-0.5 text-xs font-bold text-foreground">
          Ax
        </div>
        <span className="text-sm font-semibold text-foreground">Axex</span>
        <span className="ml-auto rounded-full border border-[var(--green)]/25 bg-[var(--green-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--green-text)]">
          Secure
        </span>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--red-soft)] p-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--pill)] text-sm font-bold text-foreground">
          {info.guildName.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{info.guildName}</p>
          <p className="text-[11px] text-muted-foreground">
            {info.guildMemberCount.toLocaleString()} members • Verification required
          </p>
        </div>
      </div>
    </div>
  );
}

function Stats({ items }: { items: [string, string, "g" | "r" | "a" | "n"][] }) {
  const tone = {
    g: "text-[var(--green-text)]",
    r: "text-[var(--red-text)]",
    a: "text-[var(--amber)]",
    n: "text-foreground",
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(([label, value, t]) => (
        <div
          key={label}
          className="rounded-[10px] border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2.5"
        >
          <p className="text-[10px] uppercase tracking-[0.8px] text-[var(--faint-2)]">{label}</p>
          <p
            className={`mt-0.5 text-[12.5px] font-medium transition-colors duration-200 ${tone[t]}`}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-[var(--red)]/25 bg-gradient-to-r from-[#450a0a] to-[#1a2e00] px-4 py-3 text-sm font-semibold text-foreground transition-all duration-200 hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--green)] disabled:opacity-60"
    >
      {children}
      <span className="absolute inset-x-6 bottom-0 h-px bg-[var(--green)]/30" />
    </button>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "g" | "n" }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        tone === "g"
          ? "border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green-text)]"
          : "border-[var(--surface-border)] bg-[var(--surface)] text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function Captcha({
  info,
  user,
  ageDays,
  question,
  onPass,
  onFail,
  onTimeout,
}: {
  info: TokenInfo;
  user: NonNullable<TokenInfo["discordUser"]>;
  ageDays: number;
  question: (typeof QUESTIONS)[number];
  onPass: (clickMs: number, honeypotTriggered?: boolean) => void;
  onFail: (
    clickMs: number,
    reason?: "WRONG_ANSWER" | "TIMEOUT",
    honeypotTriggered?: boolean,
  ) => Promise<void>;
  onTimeout: (clickMs: number, honeypotTriggered?: boolean) => void;
}) {
  const [left, setLeft] = useState(60);
  const [flash, setFlash] = useState<{ opt: string; ok: boolean } | null>(null);
  const [honeypotTriggered, setHoneypotTriggered] = useState(false);
  const shake = useAnimationControls();
  const done = useRef(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left === 0 && !done.current) {
      done.current = true;
      onTimeout(Date.now() - startedAt.current, honeypotTriggered);
    }
  }, [honeypotTriggered, left, onTimeout]);

  const pick = (opt: string) => {
    if (done.current) return;
    if (opt === question.answer) {
      done.current = true;
      setFlash({ opt, ok: true });
      setTimeout(() => onPass(Date.now() - startedAt.current, honeypotTriggered), 650);
    } else {
      setFlash({ opt, ok: false });
      void shake.start({ x: [-8, 8, -8, 8, 0], transition: { duration: 0.4 } });
      void onFail(Date.now() - startedAt.current, "WRONG_ANSWER", honeypotTriggered);
      setTimeout(() => setFlash(null), 500);
    }
  };

  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;

  return (
    <motion.div animate={shake} className="space-y-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor="website_url">Website</label>
        <input
          id="website_url"
          name="website_url"
          type="url"
          tabIndex={-1}
          autoComplete="off"
          onFocus={() => setHoneypotTriggered(true)}
          onChange={() => setHoneypotTriggered(true)}
        />
        <label htmlFor="company_name">Company</label>
        <input
          id="company_name"
          name="company_name"
          type="text"
          tabIndex={-1}
          autoComplete="organization"
          onFocus={() => setHoneypotTriggered(true)}
          onChange={() => setHoneypotTriggered(true)}
        />
        <button type="button" tabIndex={-1} onClick={() => setHoneypotTriggered(true)}>
          Skip verification
        </button>
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>Time remaining</span>
          <span className="tabular-nums">0:{String(left).padStart(2, "0")}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--pill)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--red)] to-[var(--green)] transition-[width] duration-1000 ease-linear"
            style={{ width: `${(left / 60) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--surface)] p-3">
        <img
          src={avatar}
          alt={user.username}
          className="h-11 w-11 rounded-full border border-[var(--red)]/15"
        />
        <div>
          <p className="text-sm font-bold text-foreground">{user.username}</p>
          <p className="text-[11px] text-muted-foreground">
            Created{" "}
            {new Date(user.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      <Stats
        items={[
          ["Account Age", `${ageDays} days`, "g"],
          ["Network", "Clean ✓", "g"],
          ["Token", "✓ Valid", "g"],
          ["Status", "Verifying", "a"],
        ]}
      />

      <div>
        <p className="text-[10px] uppercase tracking-[0.8px] text-[var(--faint-2)]">
          Human Verification
        </p>
        <p className="mt-1.5 text-sm text-foreground">{question.q}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {question.options.map((o) => {
            const f = flash?.opt === o ? flash : null;
            return (
              <motion.button
                key={o}
                type="button"
                onClick={() => pick(o)}
                animate={f?.ok ? { scale: [1, 1.05, 1], opacity: [1, 1, 0.4] } : {}}
                transition={{ duration: 0.6 }}
                aria-label={`Answer: ${o}`}
                className={`min-h-11 rounded-lg border px-3 py-2.5 text-sm text-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--green)] ${
                  f
                    ? f.ok
                      ? "border-[var(--green)] bg-[var(--green)]/20"
                      : "border-[var(--red)] bg-[var(--red)]/20"
                    : "border-[var(--surface-border-2)] bg-[var(--surface-2)] hover:border-[var(--green)]/30 hover:bg-[var(--green-soft)]"
                }`}
              >
                {o}
              </motion.button>
            );
          })}
        </div>
      </div>
      <p className="text-center text-[11px] text-[var(--faint)]">Verifying for {info.guildName}</p>
    </motion.div>
  );
}

function ErrorAlert({
  title,
  desc,
  referenceId,
  onRetry,
}: {
  title: string;
  desc: string;
  referenceId?: string | null;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--red)]/30 bg-[var(--red-soft)]">
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="var(--red)"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </div>
      <div
        role="alert"
        className="mt-5 w-full rounded-xl border border-destructive/40 bg-[var(--red-soft)] p-4 text-left"
      >
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        {referenceId && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
            <span>
              Reference <strong className="text-foreground">{referenceId}</strong>
            </span>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(referenceId)}
              className="font-semibold text-[var(--green-text)] underline underline-offset-2"
            >
              Copy
            </button>
          </div>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 min-h-11 rounded-lg border border-[var(--red)]/30 px-3 text-xs font-semibold text-foreground hover:bg-[var(--red-soft)]"
          >
            Check again
          </button>
        )}
        <a
          href="/support"
          className="mt-3 inline-block text-xs font-semibold text-[var(--green-text)] underline underline-offset-2"
        >
          Having trouble?
        </a>
      </div>
    </div>
  );
}

function ShieldX() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="var(--red)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="relative h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}
function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M20.3 4.4A19.8 19.8 0 0015.4 3l-.6 1.3a18.4 18.4 0 00-5.6 0L8.6 3a19.7 19.7 0 00-4.9 1.4C.6 9 0 13.6.3 18.1a19.9 19.9 0 006 3l1.3-2a13 13 0 01-2-1l.5-.4a14.2 14.2 0 0012 0l.5.4-2 1 1.3 2a19.8 19.8 0 006-3c.4-5.2-.8-9.8-3.6-13.7zM8.5 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z" />
    </svg>
  );
}
