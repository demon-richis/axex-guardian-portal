import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const forbidden = [
  "CRON_SECRET",
  "PROXYCHECK_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "DISCORD_CLIENT_SECRET",
  "AXEX_BOT_API_KEY",
  "PORTAL_TO_BOT_KEY",
  "INTELLIGENCE_API_KEY",
];

test("client bundle does not contain server environment variable names", async () => {
  const assetsDir = path.resolve("dist/client/assets");
  const assets = await readdir(assetsDir);
  const bundles = assets.filter((file) => file.endsWith(".js"));
  assert.ok(bundles.length > 0, "expected built client JavaScript assets");

  for (const file of bundles) {
    const source = await readFile(path.join(assetsDir, file), "utf8");
    for (const name of forbidden) {
      assert.equal(source.includes(name), false, `${name} found in ${file}`);
    }
  }
});
