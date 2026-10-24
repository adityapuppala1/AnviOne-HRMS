import { ShieldCheck, History } from "lucide-react";
import { Badge, ErrorState, LoadingState } from "@anvi/ui";
import { useAudit } from "../lib/api";
import { useWorkspace } from "./workspace";
const actionNames: Record<string, string> = {
  "session.started": "Signed in",
  "session.ended": "Signed out",
  "session.role_changed": "Changed workspace role",
  "branding.published": "Published workspace settings",
};
export default function Activity() {
  const { me } = useWorkspace();
  if (!me.permissions.includes("audit.read"))
    return (
      <ErrorState message="Activity history requires an assigned Auditor workspace." />
    );
  return <ActivityLog />;
}
function ActivityLog() {
  const { data, error, refetch } = useAudit();
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLEAR ACTIONS. LASTING ACCOUNTABILITY.</p>
          <h1>The story behind every change.</h1>
          <p>The latest 50 recorded actions in your workspace.</p>
        </div>
        <Badge>
          <ShieldCheck size={14} />
          Read only
        </Badge>
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <section className="panel activity-list">
          {data.length ? (
            data.map((event) => (
              <article className="activity-event" key={event.id}>
                <span className="activity-icon">
                  <History size={19} />
                </span>
                <div>
                  <h2>{actionNames[event.action] ?? event.action}</h2>
                  <p>
                    {event.actor}{" "}
                    <span>· {event.role.replaceAll("_", " ")}</span>
                  </p>
                  <small>{event.target}</small>
                </div>
                <time dateTime={event.occurredAt}>
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  }).format(new Date(event.occurredAt))}
                </time>
              </article>
            ))
          ) : (
            <div className="state-card">
              <History size={28} />
              <h2>A fresh start</h2>
              <p>
                Recorded actions will appear here as your workspace is used.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
