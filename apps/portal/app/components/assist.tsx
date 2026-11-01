import { Link } from "react-router";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { Badge } from "@anvi/ui";
import { assistCopy as text } from "../lib/copy/screens";

export type Suggestion = {
  key: string;
  title: string;
  detail: string;
  to: string;
};

// "Anvi Assist" has two honest halves. Suggested next steps are computed from
// the person's own permissions and counts, with no AI involved. The AI helper
// itself is shown as switched off, because policy-only retrieval is still
// waiting on its privacy and security gate (backlog AI-01).
export function Assist({ suggestions }: { suggestions: Suggestion[] }) {
  return (
    <section className="assist" aria-label={text.label}>
      <div className="assist-orb" aria-hidden="true">
        <i />
        <i />
        <Sparkle size={26} weight="fill" />
      </div>
      <div className="assist-head">
        <h2>{text.title}</h2>
        <Badge>{text.aiOff}</Badge>
      </div>
      <p className="assist-note">{text.aiNote}</p>
      <div className="assist-steps">
        <h3>{text.stepsTitle}</h3>
        {suggestions.length ? (
          <ul>
            {suggestions.map((s) => (
              <li key={s.key}>
                <Link to={s.to}>
                  <span>
                    <strong>{s.title}</strong>
                    <small>{s.detail}</small>
                  </span>
                  <ArrowUpRight size={17} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="assist-empty">{text.noSteps}</p>
        )}
      </div>
    </section>
  );
}
