import { access } from "node:fs/promises";

let handlerPromise;
async function getHandler() {
  handlerPromise ??= import("../dist/server/server.js").then((module) => module.default ?? module);
  return handlerPromise;
}

function requestUrl(request) {
  const forwardedProto = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || "https";
  const host = request.headers.host || request.headers["x-forwarded-host"] || "localhost";
  const originalPath = request.headers["x-matched-path"] || request.url || "/";
  return new URL(originalPath, `${forwardedProto}://${host}`).toString();
}

async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const fetchRequest = new Request(requestUrl(request), {
      method: request.method,
      headers,
      body: await readBody(request),
    });
    const result = await (await getHandler()).fetch(fetchRequest, {}, {});
    response.status(result.status);
    for (const [key, value] of result.headers) {
      if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
    }
    const cookies = result.headers.getSetCookie?.();
    if (cookies?.length) response.setHeader("set-cookie", cookies);
    response.send(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error("[vercel] Request failed:", error);
    response.status(500).send("Internal Server Error");
  }
}

await access(new URL("../dist/server/server.js", import.meta.url));
