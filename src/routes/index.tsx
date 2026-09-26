import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/verify", search: { token: undefined, auth: undefined, error: undefined } });
  },
  head: () => ({
    meta: [
      { title: "Axex — Discord Verification" },
      { name: "description", content: "Axex secure verification portal for Discord servers." },
      { property: "og:title", content: "Axex — Discord Verification" },
      { property: "og:description", content: "Axex secure verification portal for Discord servers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
