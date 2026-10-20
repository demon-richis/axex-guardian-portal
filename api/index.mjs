let handlerPromise;
async function getHandler() {
  handlerPromise ??= import("./dist-server/server.js").then((module) => module.default ?? module);
  return handlerPromise;
}

function requestUrl(request) {
  const forwardedProto = header(request, "x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host = header(request, "host") || header(request, "x-forwarded-host") || "localhost";
  const origin = `${forwardedProto}://${host}`;
  const incoming = new URL(request.url || "/", origin);
  const rewrittenPath = incoming.searchParams.get("__axex_path");
  const matchedPath = header(request, "x-matched-path");
  const originalPath = rewrittenPath || matchedPath || incoming.pathname;
  const target = new URL(originalPath, origin);

  for (const [key, value] of incoming.searchParams) {
    if (key !== "__axex_path") target.searchParams.append(key, value);
  }
  return target.toString();
}

function header(request, name) {
  if (typeof request.headers?.get === "function") return request.headers.get(name) ?? undefined;
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (typeof request.arrayBuffer === "function") return Buffer.from(await request.arrayBuffer());
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  try {
    const headers = new Headers();
    if (typeof request.headers?.forEach === "function") {
      request.headers.forEach((value, key) => headers.set(key, value));
    } else {
      for (const [key, value] of Object.entries(request.headers ?? {})) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
    }
    const fetchRequest = new Request(requestUrl(request), {
      method: request.method,
      headers,
      body: await readBody(request),
    });
    const result = await (await getHandler()).fetch(fetchRequest, {}, {});
    if (!response) return result;
    response.status(result.status);
    for (const [key, value] of result.headers) {
      if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
    }
    const cookies = result.headers.getSetCookie?.();
    if (cookies?.length) response.setHeader("set-cookie", cookies);
    response.send(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error("[vercel] Request failed:", error instanceof Error ? error.name : "unknown");
    if (!response) return new Response("Internal Server Error", { status: 500 });
    response.status(500).send("Internal Server Error");
  }
}
