<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Database: Neon serverless Postgres via drizzle-orm/neon-http, accessed only in server routes (src/lib/db/client.server.ts) — edge runtime needs HTTP driver.
- Discord identity is stored on the token row by the OAuth callback — so the final result cannot be forged by the browser.
