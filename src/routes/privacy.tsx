import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--green-text)]">
          Axex Verification
        </p>
        <h1 className="mt-3 text-3xl font-bold">Privacy, in plain language</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          We use verification to confirm Discord account ownership and protect communities from
          automated abuse. Discord handles authentication; Axex does not ask for or store your
          Discord password.
        </p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="text-base font-semibold text-foreground">What we check</h2>
            <p>
              We receive your basic Discord identity, account age, verification timing, and a
              security classification for your network such as clear, VPN, proxy, or hosting
              connection.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">What we do not show</h2>
            <p>
              We do not display your raw IP address on this page. Moderators may receive security
              signals needed to review access decisions.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">How long it is kept</h2>
            <p>
              Verification and security records are retained by the community according to its
              moderation and privacy practices. Contact the server moderators if you need a deletion
              or access request.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">Your choice</h2>
            <p>
              You can close this page at any time. If you cancel Discord authorization, no
              verification result is submitted.
            </p>
          </section>
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
