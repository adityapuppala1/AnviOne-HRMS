import type { ReactNode } from "react";
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase";
import { PauseCircle } from "@phosphor-icons/react/dist/csr/PauseCircle";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { ErrorState, PageHeader, StatCard, UTabs } from "@anvi/ui";
import { useRecruitRequisitions } from "../lib/api";
import { recruitmentCopy as text } from "../lib/copy/recruitment";
import { usePreferences } from "../lib/preferences";
import { CandidatesTab } from "../components/recruit/candidates";
import { FunnelTab } from "../components/recruit/funnel";
import { InterviewsTab } from "../components/recruit/interviews";
import { OffersTab } from "../components/recruit/offers";
import { PipelineTab } from "../components/recruit/pipeline";
import { RequisitionsTab } from "../components/recruit/requisitions";
import { useWorkspace } from "./workspace";
import "./leave.css";
import "./recruitment.css";

export default function Recruitment() {
  const { me } = useWorkspace();
  const has = (permission: string) =>
    me.permissions.includes(permission as (typeof me.permissions)[number]);
  const canManage = has("recruit.manage");
  const canRequest = has("recruit.request");
  const canInterview = has("recruit.interview");
  const canFollow = canManage || canRequest;
  const { reduceMotion } = usePreferences();
  const summary = useRecruitRequisitions(canFollow, "limit=1");
  if (!canFollow && !canInterview) return <ErrorState message={text.denied} />;
  const counts = summary.data?.counts;
  const tabs = [
    { id: "requisitions", label: text.tabs.requisitions, show: canFollow },
    { id: "candidates", label: text.tabs.candidates, show: canManage },
    { id: "pipeline", label: text.tabs.pipeline, show: canFollow },
    { id: "interviews", label: text.tabs.interviews, show: true },
    { id: "offers", label: text.tabs.offers, show: canManage },
    { id: "funnel", label: text.tabs.funnel, show: canFollow },
  ].filter((tab) => tab.show);
  const panels: Record<string, ReactNode> = {
    requisitions: <RequisitionsTab canManage={canManage} />,
    candidates: <CandidatesTab />,
    pipeline: <PipelineTab />,
    interviews: (
      <InterviewsTab canFollow={canFollow} canInterview={canInterview} />
    ),
    offers: <OffersTab />,
    funnel: <FunnelTab />,
  };
  return (
    <div className="page-enter recruit-page">
      <PageHeader
        title={text.title}
        description={
          canManage
            ? text.subtitleManage
            : canRequest
              ? text.subtitleRequest
              : text.subtitleInterview
        }
      />
      {canFollow && counts && (
        <div className="leave-stats">
          <StatCard
            label={text.requisition.stats.open}
            value={counts.open ?? 0}
            hint={text.requisition.stats.openHint}
            icon={Briefcase}
            animate={!reduceMotion}
          />
          <StatCard
            label={text.requisition.stats.pending}
            value={counts.pending_approval ?? 0}
            hint={text.requisition.stats.pendingHint}
            icon={Hourglass}
            animate={!reduceMotion}
          />
          <StatCard
            label={text.requisition.stats.hold}
            value={counts.on_hold ?? 0}
            hint={text.requisition.stats.holdHint}
            icon={PauseCircle}
            animate={!reduceMotion}
          />
        </div>
      )}
      {tabs.length > 1 ? (
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
      ) : (
        panels[tabs[0]!.id]
      )}
      <p className="recruit-limits">{text.limits}</p>
    </div>
  );
}
