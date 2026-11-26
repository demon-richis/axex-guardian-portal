import { createFileRoute } from "@tanstack/react-router";
import termsSource from "../../legal/TERMS_OF_SERVICE.md?raw";
import { LegalPage } from "../lib/legal-markdown";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({ meta: [{ title: "Axex Terms of Service" }] }),
});

function TermsPage() {
  return <LegalPage source={termsSource} />;
}
