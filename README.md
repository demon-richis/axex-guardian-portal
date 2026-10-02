# Axex Guardian Portal

Discord bot verification portal for Axex security bot.

## Stack

React, Tailwind CSS, shadcn/ui, Neon DB, and Drizzle ORM.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill in the values.
3. Start the development server with `npm run dev`.

To preview the verification experience without a Discord bot or database token, open `http://localhost:5173/verify?demo=1` while running the development server. The demo path is disabled in production builds.

Run `npm run db:push` to apply the Drizzle schema to Neon. Build for production with `npm run build`, then start it with `npm start`.

## Environment Variables

- `DATABASE_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `PROXYCHECK_API_KEY`
- `AXEX_BOT_API_KEY` (optional shared key for bot registration and audit APIs)
- `BOT_WEBHOOK_URL` (bot verification-result receiver)
- `INTELLIGENCE_URL` (server-only account intelligence API base URL)
- `INTELLIGENCE_API_KEY` (server-only account intelligence API key)

`INTELLIGENCE_URL` and `INTELLIGENCE_API_KEY` must be configured in the hosting provider's server environment. Do not prefix them with `VITE_`, because they must never be exposed to browser code.
