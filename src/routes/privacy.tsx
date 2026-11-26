import { createFileRoute } from "@tanstack/react-router";
import privacySource from "../../legal/PRIVACY_POLICY.md?raw";
import { LegalPage } from "../lib/legal-markdown";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({ meta: [{ title: "Axex Privacy Policy" }] }),
});

function PrivacyPage() {
  return <LegalPage source={privacySource} />;
}
