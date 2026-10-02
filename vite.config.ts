import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackStart({ server: { entry: "server" } }), viteReact(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: {
    allowedHosts: [
      "5173-i0lm0f73gycnnn824esnv-031f581a.sg2.manus.computer",
      "deposits-preston-exploring-beginning.trycloudflare.com",
    ],
  },
});
