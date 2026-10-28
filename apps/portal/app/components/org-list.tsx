import { Avatar } from "@anvi/ui";
import type { OrgChartNeighborhood, OrgChartNodeLite } from "@anvi/contracts";
import { deptLabel } from "../lib/org-chart";
import { chartCopy as text } from "../lib/copy/chart";

// The plain-text equivalent of the visual views: manager, person, reports.
export function OrgList({
  data,
  meId,
  onFocus,
}: {
  data: OrgChartNeighborhood;
  meId: string;
  onFocus: (id: string) => void;
}) {
  return (
    <div className="oc-list">
      <p className="oc-help">{text.list.intro}</p>
      <section aria-labelledby="oc-list-manager">
        <h2 id="oc-list-manager" className="oc-list-h">
          {text.list.reportsTo}
        </h2>
        {data.manager ? (
          <ul className="oc-list-ul">
            <Row person={data.manager} meId={meId} onFocus={onFocus} />
          </ul>
        ) : (
          <p className="oc-list-empty">{text.noManager}</p>
        )}
      </section>
      <section aria-labelledby="oc-list-person">
        <h2 id="oc-list-person" className="oc-list-h">
          {text.list.person}
        </h2>
        <div className="oc-list-focus" aria-current="true">
          <Person person={data.focus} meId={meId} />
        </div>
      </section>
      <section aria-labelledby="oc-list-reports">
        <h2 id="oc-list-reports" className="oc-list-h">
          {text.list.reports(data.reportCount)}
        </h2>
        {data.reports.length ? (
          <ul className="oc-list-ul">
            {data.reports.map((person) => (
              <Row
                key={person.id}
                person={person}
                meId={meId}
                onFocus={onFocus}
              />
            ))}
          </ul>
        ) : (
          <p className="oc-list-empty">{text.noReports}</p>
        )}
        {data.truncated && (
          <p className="oc-list-empty">
            {text.truncated(data.reports.length, data.reportCount)}
          </p>
        )}
      </section>
    </div>
  );
}

function Person({ person, meId }: { person: OrgChartNodeLite; meId: string }) {
  return (
    <>
      <Avatar initials={person.initials} />
      <span className="oc-list-text">
        <span className="oc-list-name">
          {person.name}
          {person.id === meId && (
            <span className="oc-you">{text.node.youBadge}</span>
          )}
        </span>
        <span className="oc-list-sub">
          {person.title || text.noTitle}
          {" · "}
          {deptLabel(person.department, text.noDepartment)}
          {" · "}
          {text.node.reports(person.directReportCount)}
        </span>
      </span>
    </>
  );
}

function Row({
  person,
  meId,
  onFocus,
}: {
  person: OrgChartNodeLite;
  meId: string;
  onFocus: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="oc-list-row"
        onClick={() => onFocus(person.id)}
        aria-label={`${text.list.show(person.name)}. ${person.title || text.noTitle}`}
      >
        <Person person={person} meId={meId} />
      </button>
    </li>
  );
}
