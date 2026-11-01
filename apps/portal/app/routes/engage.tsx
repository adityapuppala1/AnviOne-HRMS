import type { ReactNode } from "react";
import { ErrorState, PageHeader, UTabs } from "@anvi/ui";
import { engageCopy as text } from "../lib/copy/engage";
import { FeedTab, MineTab } from "../components/engage/feed";
import { ManageTab } from "../components/engage/manage";
import { SurveysTab } from "../components/engage/surveys";
import { useWorkspace } from "./workspace";
import "./leave.css";
import "./recruitment.css";
import "./performance.css";
import "./helpdesk.css";
import "./engage.css";

export default function Engage() {
  const { me } = useWorkspace();
  const has = (permission: string) =>
    me.permissions.includes(permission as (typeof me.permissions)[number]);
  const canManage = has("engage.manage");
  const canSelf = has("engage.self") || canManage;
  if (!canSelf) return <ErrorState message={text.denied} />;
  const tabs = [
    { id: "feed", label: text.tabs.feed, show: true },
    { id: "mine", label: text.tabs.mine, show: true },
    { id: "surveys", label: text.tabs.surveys, show: true },
    { id: "manage", label: text.tabs.manage, show: canManage },
  ].filter((tab) => tab.show);
  const panels: Record<string, ReactNode> = {
    feed: <FeedTab canGive />,
    mine: <MineTab />,
    surveys: <SurveysTab canManage={canManage} />,
    manage: <ManageTab />,
  };
  return (
    <div className="page-enter recruit-page perf-page hd-page eng-page">
      <PageHeader
        title={text.title}
        description={canManage ? text.subtitleManage : text.subtitleSelf}
      />
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
