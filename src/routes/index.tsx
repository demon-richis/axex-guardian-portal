import { createFileRoute } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";

const features = [
  { label: "Raid Protection", icon: "shield" },
  { label: "Verification", icon: "check" },
  { label: "Account Intelligence", icon: "signal" },
];

function AxexMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="axex-mark">
      <path d="M4 31 20 4l16 27h-7L20 15 11 31H4Z" fill="currentColor" />
      <path d="m14 31 6-10 6 10h-5l-1-2-1 2h-5Z" fill="currentColor" opacity=".55" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.54 5.16A16.4 16.4 0 0 0 15.5 4l-.49 1a14.8 14.8 0 0 0-6.02 0L8.5 4c-1.4.22-2.75.6-4.04 1.16C1.9 9.35 1.2 13.38 1.55 17.35a16.5 16.5 0 0 0 4.97 2.5l1.2-1.64c-.66-.24-1.3-.54-1.9-.9l.46-.35c3.67 1.72 7.9 1.72 11.57 0l.47.35c-.61.36-1.25.66-1.91.9l1.2 1.64a16.5 16.5 0 0 0 4.98-2.5c.4-4.6-.7-8.59-3.05-12.19ZM8.53 15.13c-1.1 0-2-.99-2-2.2s.88-2.2 2-2.2 2 .99 2 2.2-.9 2.2-2 2.2Zm6.94 0c-1.1 0-2-.99-2-2.2s.88-2.2 2-2.2 2 .99 2 2.2-.9 2.2-2 2.2Z"
      />
    </svg>
  );
}

function ShieldArtwork() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="hero-orbit hero-orbit-a" />
      <div className="hero-orbit hero-orbit-b" />
      <div className="hero-orbit hero-orbit-c" />
      <div className="hero-grid" />
      <div className="hero-shield-glow" />
      <div className="hero-shield">
        <div className="hero-shield-inner">
          <AxexMark />
        </div>
      </div>
      <div className="hero-particle particle-a" />
      <div className="hero-particle particle-b" />
      <div className="hero-particle particle-c" />
      <div className="hero-particle particle-d" />
      <div className="hero-mountains">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function FeatureIcon({ type }: { type: string }) {
  if (type === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="m8.5 12 2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (type === "signal") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 18v-3M9.7 18v-6M14.3 18V8M19 18V5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 6v5.2c0 4.25-2.6 7.45-7 9.3-4.4-1.85-7-5.05-7-9.3V6l7-2.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8.7 12 2.15 2.15L15.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniPanel() {
  return (
    <motion.div
      className="hero-panel"
      initial={{ opacity: 0, y: 28, rotateY: -12 }}
      animate={{ opacity: 1, y: 0, rotateY: -7 }}
      transition={{ duration: 1, delay: 0.35, ease: "easeOut" }}
    >
      <div className="hero-panel-top">
        <span className="panel-dot" />
        <span className="panel-dot" />
        <span className="panel-dot" />
        <span className="panel-title">AXEX SECURITY</span>
      </div>
      <div className="panel-body">
        <div className="panel-sidebar">
          <span className="panel-active" />
          <span />
          <span />
          <span />
        </div>
        <div className="panel-content">
          <div className="panel-line panel-line-lg" />
          <div className="panel-cards">
            <div><small>VERIFICATION</small><b>ACTIVE</b></div>
            <div><small>RAID MODE</small><b className="green">CLEAR</b></div>
          </div>
          <div className="panel-graph">
            <i /><i /><i /><i /><i /><i /><i /><i />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export const Route = createFileRoute("/")({
  component: AxexLanding,
  head: () => ({
    meta: [
      { title: "Axex — Security. Built for Discord." },
      {
        name: "description",
        content: "Axex protects Discord communities with verification, raid protection, account intelligence, quarantine, and security controls.",
      },
      { property: "og:title", content: "Axex — Security. Built for Discord." },
      {
        property: "og:description",
        content: "Security for the communities you run.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
});

function AxexLanding() {
  const reduceMotion = useReducedMotion();

  return (
    <main className="axex-site">
      <header className="axex-nav-wrap">
        <nav className="axex-nav" aria-label="Primary navigation">
          <a className="axex-brand" href="#top" aria-label="Axex home">
            <AxexMark />
            <span>AXEX</span>
          </a>

          <div className="axex-nav-links">
            <a className="active" href="#top">Home</a>
            <a href="#features">Features</a>
            <a href="#guardian">Guardian Portal</a>
            <a href="#intelligence">Account Intelligence</a>
            <a href="#about">About</a>
          </div>

          <a className="axex-nav-cta" href="https://discord.com/oauth2/authorize?client_id=1453399273550123050&scope=bot%20applications.commands&permissions=8">
            <DiscordIcon />
            <span>Add to Discord</span>
            <span aria-hidden="true">→</span>
          </a>
        </nav>
      </header>

      <section id="top" className="axex-hero">
        <div className="hero-noise" />
        <div className="hero-copy">
          <motion.div
            className="eyebrow"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
          >
            <span className="eyebrow-icon">⌁</span>
            DISCORD SECURITY PLATFORM
            <span className="eyebrow-live" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
          >
            Security.
            <br />
            Built for <em>Discord.</em>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.16 }}
          >
            Protect, verify and manage your community
            <br className="desktop-only" /> with the power of Axex.
          </motion.p>

          <motion.div
            className="hero-actions"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24 }}
          >
            <a className="primary-cta" href="https://discord.com/oauth2/authorize?client_id=1453399273550123050&scope=bot%20applications.commands&permissions=8">
              <DiscordIcon />
              Add Axex to Discord
              <span>→</span>
            </a>
            <a className="secondary-cta" href="#features">
              <span className="play-icon">▶</span>
              Explore security
            </a>
          </motion.div>

          <motion.div
            className="hero-features"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.4 }}
          >
            {features.map((feature) => (
              <div className="hero-feature" key={feature.label}>
                <FeatureIcon type={feature.icon} />
                <span>{feature.label}</span>
              </div>
            ))}
          </motion.div>
        </div>

        <ShieldArtwork />
        <MiniPanel />

        <div className="hero-footer-line">
          <span>●</span>
          A complete security ecosystem — Bot + Guardian Portal
          <i />
        </div>

        <motion.a
          href="#features"
          className="scroll-cue"
          animate={reduceMotion ? undefined : { y: [0, 7, 0] }}
          transition={reduceMotion ? undefined : { duration: 1.7, repeat: Infinity }}
          aria-label="Scroll to features"
        >
          ↓
        </motion.a>
      </section>

      <section id="features" className="axex-section">
        <div>
          <span className="section-kicker">POWERFUL FEATURES</span>
          <h2>Everything you need<br />for a <em>safer</em> server.</h2>
        </div>
        <p>From join surges to secure verification, Axex gives you control without the noise.</p>
      </section>

      <section id="guardian" className="axex-section axex-section-alt">
        <div>
          <span className="section-kicker">UNIFIED ECOSYSTEM</span>
          <h2>Bot + Guardian Portal.<br />One security layer.</h2>
        </div>
        <p>Connect Discord-side protection with centralized verification and security management.</p>
      </section>

      <section id="intelligence" className="axex-section">
        <div>
          <span className="section-kicker">ACCOUNT INTELLIGENCE</span>
          <h2>Understand the account<br />before you <em>trust</em> it.</h2>
        </div>
        <p>Use the intelligence signals already exposed by Axex to inform verification and risk handling.</p>
      </section>

      <section id="about" className="axex-final">
        <span className="section-kicker">AXEX</span>
        <h2>Protect what you <em>built.</em></h2>
        <p>Security for the communities you run.</p>
        <a className="primary-cta" href="https://discord.com/oauth2/authorize?client_id=1453399273550123050&scope=bot%20applications.commands&permissions=8">
          <DiscordIcon />
          Add Axex to Discord
          <span>→</span>
        </a>
      </section>
    </main>
  );
}
