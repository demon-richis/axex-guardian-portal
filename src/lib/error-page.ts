function describeServerError(error: unknown): string {
  if (error && typeof error === "object") {
    const detail = error as { status?: unknown; statusCode?: unknown; name?: unknown };
    const status = detail.status ?? detail.statusCode;
    if (status === 401 || status === 403) {
      return "The server rejected this request because the required access or verification session could not be confirmed. Reopen the original verification link and try again.";
    }
    if (status === 404) {
      return "The requested server resource was not found. Check the link or return to the verification page.";
    }
    if (status === 408 || status === 504 || detail.name === "TimeoutError") {
      return "A required server request timed out before the page could be rendered. Check your connection and retry.";
    }
    if (status === 429) {
      return "Axex received too many requests. Wait a moment before trying again.";
    }
    if (status === 503) {
      return "A required Axex service is temporarily unavailable. No verification result was submitted; try again shortly.";
    }
    if (typeof status === "number" && status >= 500) {
      return "The server failed while rendering this page. Technical details were recorded securely.";
    }
  }
  return "An unexpected server-side error stopped this page from loading. Axex could not safely identify a more specific cause. Try again once, then contact server staff if it continues.";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderErrorPage(error?: unknown): string {
  const description = escapeHtml(describeServerError(error));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Axex could not load this page</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Axex could not load this page</h1>
      <p>${description}</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </main>
  </body>
</html>`;
}
