import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const clientRoot = join(root, "dist", "client");
const port = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const host = process.env.HOST ?? "0.0.0.0";
const staticContentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let handlerPromise;
async function getHandler() {
  handlerPromise ??= import("./dist/server/server.js").then((module) => module.default ?? module);
  return handlerPromise;
}

function requestUrl(request) {
  const protocol = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || "http";
  const hostHeader = request.headers.host || `localhost:${port}`;
  return `${protocol}://${hostHeader}${request.url || "/"}`;
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const candidate = resolve(clientRoot, `.${decoded}`);
  return candidate === clientRoot || candidate.startsWith(`${clientRoot}/`) ? candidate : null;
}

async function serveStatic(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const filePath = safeStaticPath(new URL(requestUrl(request)).pathname);
  if (!filePath) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      staticContentTypes[extname(filePath)] || "application/octet-stream",
    );
    response.setHeader("Content-Length", info.size);
    if (filePath.includes(`${join("dist", "client", "assets")}${pathSeparator()}`)) {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

async function handle(request, response) {
  if (await serveStatic(request, response)) return;
  try {
    const body =
      request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const fetchRequest = new Request(requestUrl(request), {
      method: request.method,
      headers,
      body,
    });
    const result = await (await getHandler()).fetch(fetchRequest, {}, {});
    response.statusCode = result.status;
    for (const [key, value] of result.headers) {
      if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
    }
    const cookies = result.headers.getSetCookie?.();
    if (cookies?.length) response.setHeader("set-cookie", cookies);
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error("[server] Request failed:", error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Internal Server Error");
  }
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

await access(join(root, "dist", "server", "server.js"));
http.createServer(handle).listen(port, host, () => {
  console.log(`[server] Axex Guardian Portal listening on http://${host}:${port}`);
});
