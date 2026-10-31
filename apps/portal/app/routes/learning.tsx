import type { ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { PlayCircle } from "@phosphor-icons/react/dist/csr/PlayCircle";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ErrorState, PageHeader, StatCard, UTabs } from "@anvi/ui";
import { useLrnAssignments } from "../lib/learning-api";
import { learningCopy as text } from "../lib/copy/learning";
import { usePreferences } from "../lib/preferences";
import { AssignmentsTab } from "../components/learning/assignments";
import { CatalogueTab } from "../components/learning/catalogue";
import { ComplianceTab } from "../components/learning/compliance";
import { ManageTab } from "../components/learning/manage";
import { useWorkspace } from "./workspace";
import "./leave.css";
import "./recruitment.css";
import "./performance.css";
import "./learning.css";

export default function Learning() {
  const { me } = useWorkspace();
  const has = (permission: string) =>
    me.permissions.includes(permission as (typeof me.permissions)[number]);
  const canManage = has("learn.manage");
  const canTeam = has("learn.team");
  const allowed = has("learn.self") || canTeam || canManage;
  const { reduceMotion } = usePreferences();
  // The summary counts the person's own assignments.
  const mine = (extra: string) => `limit=1&view=mine&${extra}`;
  const overdue = useLrnAssignments(allowed, mine("overdue=true"));
  const inProgress = useLrnAssignments(allowed, mine("status=in_progress"));
  const completed = useLrnAssignments(allowed, mine("status=completed"));
  const renewal = useLrnAssignments(allowed, mine("renewal=due"));
  if (!allowed) return <ErrorState message={text.denied} />;
  const tabs = [
    { id: "mine", label: text.tabs.mine, show: true },
    { id: "catalogue", label: text.tabs.catalogue, show: true },
    { id: "team", label: text.tabs.team, show: canTeam },
    { id: "manage", label: text.tabs.manage, show: canManage },
    { id: "compliance", label: text.tabs.compliance, show: canManage },
  ].filter((tab) => tab.show);
  const panels: Record<string, ReactNode> = {
    mine: <AssignmentsTab mode="mine" />,
    catalogue: <CatalogueTab manage={canManage} />,
    team: <AssignmentsTab mode="team" />,
    manage: <ManageTab />,
    compliance: <ComplianceTab />,
  };
  return (
    <div className="page-enter recruit-page perf-page lrn-page">
      <PageHeader
        title={text.title}
        description={
          canManage
            ? text.subtitleManage
            : canTeam
              ? text.subtitleTeam
              : text.subtitleSelf
        }
      />
      <div className="leave-stats">
        <StatCard
          label={text.stats.overdue}
          value={overdue.data?.total ?? 0}
          hint={text.stats.overdueHint}
          icon={WarningCircle}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.inProgress}
          value={inProgress.data?.total ?? 0}
          hint={text.stats.inProgressHint}
          icon={PlayCircle}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.completed}
          value={completed.data?.total ?? 0}
          hint={text.stats.completedHint}
          icon={CheckCircle}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.renewal}
          value={renewal.data?.total ?? 0}
          hint={text.stats.renewalHint}
          icon={ArrowsClockwise}
          animate={!reduceMotion}
        />
      </div>
      <UTabs className="leave-tabs" keyboardActivation="automatic">
        <UTabs.List type="underline" aria-label={text.tabs.label}>
          {tabs.map((tab) => (
            <UTabs.Item key={tab.id} id={tab.id}>
              {tab.label}
            </UTabs.Item>
          ))}
        </UTabs.List>
        {tabs.map((tab) => (
          <UTabs.Panel key={tab.id} id={tab.id} className="tab-panel">
            {panels[tab.id]}
          </UTabs.Panel>
        ))}
      </UTabs>
      <p className="recruit-limits">{text.limits}</p>
    </div>
  );
}
