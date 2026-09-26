import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

export const Route = createFileRoute("/verify")({
  validateSearch: z.object({
    token: z.string().optional(),
    auth: z.string().optional(),
    error: z.string().optional(),
  }),
  head: () => ({
    meta: [
      { title: "Axex Verification — Secure Server Access" },
      { name: "description", content: "Verify your Discord account with Axex to gain access to the server." },
      { property: "og:title", content: "Axex Verification" },
      { property: "og:description", content: "Secure Discord server verification by Axex." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VerifyPage,
});

const QUESTIONS = [
  { q: "Which of these is NOT a number?", options: ["Seven", "Four", "Blue", "Nine"], answer: "Blue" },
  { q: "Which of these is a fruit?", options: ["Chair", "Apple", "Window", "Cloud"], answer: "Apple" },
  { q: "What comes after Monday?", options: ["Sunday", "Friday", "Tuesday", "January"], answer: "Tuesday" },
  { q: "Which of these is NOT a color?", options: ["Red", "Eleven", "Blue", "Green"], answer: "Eleven" },
  { q: "How many sides does a triangle have?", options: ["4", "5", "3", "6"], answer: "3" },
  { q: "Which of these is an animal?", options: ["Table", "River", "Eagle", "Thunder"], answer: "Eagle" },
  { q: "Which season comes after Winter?", options: ["Autumn", "Summer", "Spring", "Storm"], answer: "Spring" },
  { q: "Which of these is NOT a planet?", options: ["Mars", "Venus", "Cloud", "Saturn"], answer: "Cloud" },
  { q: "What is 5 + 3?", options: ["7", "9", "6", "8"], answer: "8" },
  { q: "Which of these is a vehicle?", options: ["Mountain", "Train", "Ocean", "Forest"], answer: "Train" },
];

type TokenInfo = {
  guildName: string;
  guildMemberCount: number;
  discordUser: { id: string; username: string; avatar: string | null; createdAt: string } | null;
};
type ErrorKind = "invalid" | "used" | "timeout" | "generic";
type Phase = "loading" | "auth" | "vpn" | "captcha" | "done" | "error";

const ERRORS: Record<ErrorKind, [string, string]> = {
  invalid: ["Invalid Link", "This verification link is invalid or has expired."],
  used: ["Already Verified", "This link has already been used."],
  timeout: ["Time Expired", "You did not complete verification in time. Contact server staff."],
  generic: ["Something went wrong", "Please try again or contact server staff."],
};

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3 },
};

function VerifyPage() {
  const { token = "", auth, error } = Route.useSearch();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [question] = useState(() => QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]!);

  const fail = (k: ErrorKind) => {
    setErrorKind(k);
    setPhase("error");
  };

  const runIpCheck = useCallback(async () => {
    setBusy(true);
    try {
      const r = (await (await fetch("/api/check-ip", { cache: "no-store" })).json()) as { isVPN: boolean };
      setPhase(r.isVPN ? "vpn" : "captcha");
    } catch {
      setPhase("captcha");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return fail("invalid");
    (async () => {
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(token)}`);
        const data = (await res.json()) as TokenInfo & { valid: boolean; reason?: string };
        if (!data.valid) return fail(data.reason === "used" ? "used" : data.reason === "error" ? "generic" : "invalid");
        setInfo(data);
        if (error) return fail("generic");
        if (auth && data.discordUser) {
          window.history.replaceState(null, "", `/verify?token=${encodeURIComponent(token)}`);
          await runIpCheck();
        } else setPhase("auth");
      } catch {
        fail("generic");
      }
    })();
  }, [token, auth, error, runIpCheck]);

  const complete = useCallback(async () => {
    setPhase("done");
    const u = info?.discordUser;
    await fetch("/api/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        discordId: u?.id,
        discordTag: u?.username,
        discordAvatar: u?.avatar,
        passed: true,
        vpnDetected: false,
        accountAge: u ? Math.floor((Date.now() - new Date(u.createdAt).getTime()) / 86400000) : 0,
      }),
    }).catch(() => undefined);
  }, [info, token]);

  const step = phase === "auth" || phase === "vpn" || phase === "loading" ? 0 : phase === "captcha" ? 1 : 2;
  const user = info?.discordUser;
  const ageDays = user ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000) : null;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,var(--red)_0%,transparent_70%)] opacity-[0.08]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,var(--green)_0%,transparent_70%)] opacity-[0.06]" />

      <CardShell phase={phase}>
        {phase === "loading" || busy ? <Spinner /> : null}
        {phase !== "error" && phase !== "loading" && <Steps step={step} />}

        <AnimatePresence mode="wait">
          {phase === "error" && (
            <motion.div key="err" {...fade}>
              <ErrorAlert title={ERRORS[errorKind][0]} desc={ERRORS[errorKind][1]} />
            </motion.div>
          )}

          {(phase === "auth" || phase === "vpn") && info && (
            <motion.div key="auth" {...fade} className="space-y-4">
              <Header info={info} />
              {phase === "vpn" ? (
                <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                  <div className="animate-[redglow_2s_ease-in-out_infinite] rounded-xl border border-destructive/40 bg-[var(--red-soft)] p-4">
                    <div className="flex gap-3">
                      <ShieldX />
                      <div>
                        <p className="text-sm font-semibold text-foreground">VPN / Proxy Detected</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          We detected a VPN or proxy on your connection. Please disable it completely and try again.
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
                  ["Account Age", ageDays !== null ? `${ageDays} days` : "—", ageDays !== null ? "g" : "n"],
                  ["Network", phase === "vpn" ? "VPN Detected ✗" : "Pending", "r"],
                  ["Token", "✓ Valid", "g"],
                  ["Status", phase === "vpn" ? "Blocked" : "Awaiting", "r"],
                ]}
              />
              {phase === "vpn" ? (
                <PrimaryButton onClick={runIpCheck} disabled={busy}>
                  I've disabled it — Retry Check
                </PrimaryButton>
              ) : (
                <PrimaryButton onClick={() => (window.location.href = `/api/auth/discord?token=${encodeURIComponent(token)}`)}>
                  <DiscordIcon /> Continue with Discord
                </PrimaryButton>
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
                onTimeout={() => fail("timeout")}
              />
            </motion.div>
          )}

          {phase === "done" && info && (
            <motion.div key="done" {...fade} className="flex flex-col items-center py-4 text-center">
              <svg viewBox="0 0 52 52" className="h-16 w-16">
                <circle cx="26" cy="26" r="24" fill="none" stroke="var(--green)" strokeOpacity="0.2" strokeWidth="2" />
                <path d="M15 27 l7 7 l15 -16" fill="none" stroke="var(--green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="check-path" />
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
              <p className="mt-1 text-xs text-[var(--faint)]">Access has been granted to your account.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </CardShell>

      <p className="relative mt-6 text-center text-[11px] text-[var(--faint)]">
        Secured by Axex • axex.gg • Your IP is being verified
      </p>
    </main>
  );
}

function CardShell({ children, phase }: { children: React.ReactNode; phase: Phase }) {
  return (
    <div
      data-phase={phase}
      className="relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.6),0_12px_32px_rgba(0,0,0,0.55),0_40px_100px_rgba(220,38,38,0.08)]"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[var(--red)] via-[var(--green)] to-transparent" />
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-card/80 backdrop-blur-sm">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--red)]/20 border-t-[var(--green)]" />
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
      <p className="mt-2 text-[11px] text-muted-foreground">
        Step {step + 1} of 3 — {["Discord authentication", "Human verification", "Complete"][step]}
      </p>
    </div>
  );
}

function Header({ info }: { info: TokenInfo }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-gradient-to-r from-[var(--red)] to-[#450a0a] px-2.5 py-0.5 text-xs font-bold text-foreground">Ax</div>
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
  const tone = { g: "text-[var(--green-text)]", r: "text-[var(--red-text)]", a: "text-[var(--amber)]", n: "text-foreground" };
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(([label, value, t]) => (
        <div key={label} className="rounded-[10px] border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.8px] text-[var(--faint-2)]">{label}</p>
          <p className={`mt-0.5 text-[12.5px] font-medium transition-colors duration-200 ${tone[t]}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-[var(--red)]/25 bg-gradient-to-r from-[#450a0a] to-[#1a2e00] px-4 py-3 text-sm font-semibold text-foreground transition-all duration-200 hover:brightness-125 disabled:opacity-60"
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
  onTimeout,
}: {
  info: TokenInfo;
  user: NonNullable<TokenInfo["discordUser"]>;
  ageDays: number;
  question: (typeof QUESTIONS)[number];
  onPass: () => void;
  onTimeout: () => void;
}) {
  const [left, setLeft] = useState(60);
  const [flash, setFlash] = useState<{ opt: string; ok: boolean } | null>(null);
  const shake = useAnimationControls();
  const done = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left === 0 && !done.current) {
      done.current = true;
      onTimeout();
    }
  }, [left, onTimeout]);

  const pick = (opt: string) => {
    if (done.current) return;
    if (opt === question.answer) {
      done.current = true;
      setFlash({ opt, ok: true });
      setTimeout(onPass, 650);
    } else {
      setFlash({ opt, ok: false });
      void shake.start({ x: [-8, 8, -8, 8, 0], transition: { duration: 0.4 } });
      setTimeout(() => setFlash(null), 500);
    }
  };

  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;

  return (
    <motion.div animate={shake} className="space-y-4">
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
        <img src={avatar} alt={user.username} className="h-11 w-11 rounded-full border border-[var(--red)]/15" />
        <div>
          <p className="text-sm font-bold text-foreground">{user.username}</p>
          <p className="text-[11px] text-muted-foreground">
            Created {new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
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
        <p className="text-[10px] uppercase tracking-[0.8px] text-[var(--faint-2)]">Human Verification</p>
        <p className="mt-1.5 text-sm text-foreground">{question.q}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {question.options.map((o) => {
            const f = flash?.opt === o ? flash : null;
            return (
              <motion.button
                key={o}
                onClick={() => pick(o)}
                animate={f?.ok ? { scale: [1, 1.05, 1], opacity: [1, 1, 0.4] } : {}}
                transition={{ duration: 0.6 }}
                className={`rounded-lg border px-3 py-2.5 text-sm text-foreground transition-colors duration-200 ${
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

function ErrorAlert({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--red)]/30 bg-[var(--red-soft)]">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </div>
      <div role="alert" className="mt-5 w-full rounded-xl border border-destructive/40 bg-[var(--red-soft)] p-4 text-left">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function ShieldX() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="relative h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
