import assert from "node:assert/strict";
import test from "node:test";

const serverModule = await import("../dist/server/server.js");
const handler = serverModule.default ?? serverModule;

test("built server handler returns secured verification HTML and no-store API responses", async () => {
  const pageResponse = await handler.fetch(
    new Request("http://localhost/verify?token=abc"),
    {},
    {},
  );

  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await pageResponse.text();
  assert.notEqual(html.trim(), "");

  const csp = pageResponse.headers.get("content-security-policy") ?? "";
  const nonce = csp.match(/(?:^|;\s*)script-src\b[^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, "Content-Security-Policy must include a script nonce");

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  assert.ok(scriptTags.length > 0, "verification HTML must contain script tags");
  for (const scriptTag of scriptTags) {
    const scriptNonce = scriptTag.match(/\bnonce=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    assert.ok(scriptNonce, `script tag is missing a nonce: ${scriptTag}`);
    assert.equal(scriptNonce[1] ?? scriptNonce[2] ?? scriptNonce[3], nonce);
  }

  const apiResponse = await handler.fetch(new Request("http://localhost/api/check-ip"), {}, {});
  assert.equal(apiResponse.headers.get("cache-control"), "no-store");
});
