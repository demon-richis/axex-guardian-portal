import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

function inlineText(value: string): ReactNode {
  const parts = value.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!match) return <span key={index}>{part}</span>;
    const [, label, href] = match;
    if (href === "/" || href === "/terms" || href === "/privacy")
      return (
        <Link key={index} to={href}>
          {label}
        </Link>
      );
    return (
      <a key={index} href={href} rel="noreferrer">
        {label}
      </a>
    );
  });
}

export function LegalMarkdown({ source }: { source: string }) {
  const blocks = source
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/);
  return (
    <div className="legal-copy">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const first = lines[0] ?? "";
        if (first.startsWith("# ")) return <h1 key={index}>{inlineText(first.slice(2))}</h1>;
        if (first.startsWith("## ")) return <h2 key={index}>{inlineText(first.slice(3))}</h2>;
        if (first.startsWith("### ")) return <h3 key={index}>{inlineText(first.slice(4))}</h3>;
        if (lines.every((line) => /^- /.test(line))) {
          return (
            <ul key={index}>
              {lines.map((line) => (
                <li key={line}>{inlineText(line.slice(2))}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => /^\d+\. /.test(line))) {
          return (
            <ol key={index}>
              {lines.map((line) => (
                <li key={line}>{inlineText(line.replace(/^\d+\. /, ""))}</li>
              ))}
            </ol>
          );
        }
        if (lines.every((line) => /^\|/.test(line))) {
          const rows = lines.filter((line) => !/^\|[-| :]+\|$/.test(line));
          return (
            <div key={index} className="legal-table-wrap">
              <table>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row}>
                      {row
                        .split("|")
                        .slice(1, -1)
                        .map((cell) => (
                          <td key={cell}>{inlineText(cell.trim())}</td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inlineText(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function LegalPage({ source }: { source: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--green-text)]">
          Axex Verification
        </p>
        <LegalMarkdown source={source} />
        <Link
          to="/"
          className="mt-8 inline-flex min-h-11 items-center rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
        >
          Back to verification
        </Link>
      </article>
    </main>
  );
}
