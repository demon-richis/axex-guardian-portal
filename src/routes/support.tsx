import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/support")({
  component: SupportPage,
});

function SupportPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--green-text)]">
          Axex Verification
        </p>
        <h1 className="mt-3 text-3xl font-bold">Having trouble?</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          Try the action suggested on the verification page first. If access still does not work,
          contact a moderator in the Discord server and include the short reference code shown
          there. Never send your Discord password or OAuth code.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            "Disable VPN or proxy and retry",
            "Use your normal mobile or home connection",
            "Share your AX- reference with moderators",
          ].map((item, index) => (
            <div
              key={item}
              className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-4 text-sm text-muted-foreground"
            >
              <span className="text-xs font-bold text-[var(--green-text)]">0{index + 1}</span>
              <p className="mt-2">{item}</p>
            </div>
          ))}
        </div>
        <Link
          to="/"
          className="mt-8 inline-flex min-h-11 items-center rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
        >
          Back to verification
        </Link>
      </article>
    </main>
  );
}
