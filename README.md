# Axex Guardian Portal

Discord bot verification portal for the Axex security bot.

## Stack

React, Tailwind CSS, TanStack Start, Neon Postgres, and Drizzle ORM.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill in the values.
3. Start the development server with `npm run dev`.
4. To preview the verification experience without a Discord bot or database token, open `http://localhost:5173/verify?demo=1`.

Apply the Drizzle schema with `npm run db:push` when using a new Neon database.

## Production deployment

The app produces a standard Node-compatible build and does not depend on Render-specific runtime behavior.

### Vercel

The GitHub repository is linked to the Vercel project. Vercel can use the default settings:

- **Framework preset:** Vite
- **Build command:** `npm run build`
- **Install command:** `npm install`
- **Production branch:** `main`

Add the environment variables below to the Vercel project before using OAuth, verification, or bot APIs. Keep server-only values unprefixed; never expose them as `VITE_*` variables.

### Any Node host

```sh
npm install
npm run build
PORT=3000 HOST=0.0.0.0 node server.mjs
```

The `start` script runs the same production server after building:

```sh
npm start
```

### Docker

```sh
docker build -t axex-guardian-portal .
docker run --env-file .env -p 3000:3000 axex-guardian-portal
```

The container listens on `0.0.0.0:$PORT` and can run on any Docker-compatible host.

## Environment variables

- `DATABASE_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` — set this to `https://your-domain.example/api/auth/callback` in production.
- `PROXYCHECK_API_KEY`
- `ALLOW_LOCALHOST_NETWORK_CHECK=false` — local development only; do not enable in production.
- `AXEX_BOT_API_KEY` — optional shared key for bot registration and audit APIs.
- `BOT_WEBHOOK_URL` — server-only bot verification-result receiver.
- `INTELLIGENCE_URL` — server-only account intelligence API base URL.
- `INTELLIGENCE_API_KEY` — server-only account intelligence API key.

After changing the deployment domain, update the Discord OAuth redirect URL in the Discord application as well as `DISCORD_REDIRECT_URI`.
