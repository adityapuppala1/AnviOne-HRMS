import type { ReactNode } from "react";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Tray } from "@phosphor-icons/react/dist/csr/Tray";
import { ErrorState, PageHeader, StatCard, UTabs } from "@anvi/ui";
import { useHdCases } from "../lib/api";
import { helpdeskCopy as text } from "../lib/copy/helpdesk";
import { usePreferences } from "../lib/preferences";
import { CasesTab } from "../components/helpdesk/cases";
import { KnowledgeTab } from "../components/helpdesk/knowledge";
import { SettingsTab } from "../components/helpdesk/settings";
import { useWorkspace } from "./workspace";
import "./leave.css";
import "./recruitment.css";
import "./performance.css";
import "./helpdesk.css";

export default function Helpdesk() {
  const { me } = useWorkspace();
  const has = (permission: string) =>
    me.permissions.includes(permission as (typeof me.permissions)[number]);
  const canAgent = has("helpdesk.agent") || has("helpdesk.manage");
  const canManage = has("helpdesk.manage");
  const allowed = has("helpdesk.self") || canAgent;
  const { reduceMotion } = usePreferences();
  // The summary counts the cases the person raised, or the whole queue for HR.
  const summary = useHdCases(
    allowed,
    `limit=1&view=${canAgent ? "all" : "mine"}`,
  );
  if (!allowed) return <ErrorState message={text.denied} />;
  const counts = summary.data?.counts;
  const tabs = [
    { id: "mine", label: text.tabs.mine, show: true },
    { id: "queue", label: text.tabs.queue, show: canAgent },
    { id: "knowledge", label: text.tabs.knowledge, show: true },
    { id: "settings", label: text.tabs.settings, show: canManage },
  ].filter((tab) => tab.show);
  const panels: Record<string, ReactNode> = {
    mine: <CasesTab mode="mine" />,
    queue: <CasesTab mode="queue" />,
    knowledge: <KnowledgeTab />,
    settings: <SettingsTab />,
  };
  return (
    <div className="page-enter recruit-page perf-page hd-page">
      <PageHeader
        title={text.title}
        description={
          canManage
            ? text.subtitleManage
            : canAgent
              ? text.subtitleAgent
              : text.subtitleSelf
        }
      />
      {counts && (
        <div className="leave-stats">
          <StatCard
            label={text.stats.open}
            value={counts.open ?? 0}
            hint={text.stats.openHint}
            icon={Tray}
            animate={!reduceMotion}
          />
          <StatCard
            label={text.stats.inProgress}
            value={counts.in_progress ?? 0}
            hint={text.stats.inProgressHint}
            icon={Clock}
            animate={!reduceMotion}
          />
          <StatCard
            label={text.stats.waiting}
            value={counts.waiting_on_employee ?? 0}
            hint={text.stats.waitingHint}
            icon={Hourglass}
            animate={!reduceMotion}
          />
          <StatCard
            label={text.stats.resolved}
            value={counts.resolved ?? 0}
            hint={text.stats.resolvedHint}
            icon={CheckCircle}
            animate={!reduceMotion}
          />
        </div>
      )}
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
