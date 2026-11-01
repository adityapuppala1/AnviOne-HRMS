import type { ReactNode } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import { ErrorState, PageHeader, StatCard, UTabs } from "@anvi/ui";
import { usePerfObjectives } from "../lib/api";
import { performanceCopy as text } from "../lib/copy/performance";
import { usePreferences } from "../lib/preferences";
import { CyclesTab } from "../components/performance/cycles";
import { GoalsTab } from "../components/performance/goals";
import { ReviewsTab } from "../components/performance/reviews";
import { useWorkspace } from "./workspace";
import "./leave.css";
import "./recruitment.css";
import "./performance.css";

export default function Performance() {
  const { me } = useWorkspace();
  const has = (permission: string) =>
    me.permissions.includes(permission as (typeof me.permissions)[number]);
  const canSelf = has("performance.self");
  const canReview = has("performance.review");
  const canManage = has("performance.manage");
  const { reduceMotion } = usePreferences();
  const allowed = canSelf || canReview || canManage;
  // The summary counts the goals the person owns, or everything HR can see.
  const summary = usePerfObjectives(
    allowed,
    `limit=1&view=${canSelf ? "mine" : canManage ? "all" : "team"}`,
  );
  if (!allowed) return <ErrorState message={text.denied} />;
  const counts = summary.data?.counts;
  const tabs = [
    { id: "goals", label: text.tabs.goals, show: canSelf },
    {
      id: "team",
      label: canManage ? text.tabs.all : text.tabs.team,
      show: canReview || canManage,
    },
    { id: "my-reviews", label: text.tabs.myReviews, show: canSelf },
    { id: "team-reviews", label: text.tabs.teamReviews, show: canReview },
    { id: "cycles", label: text.tabs.cycles, show: canManage },
    { id: "finalise", label: text.tabs.finalise, show: canManage },
  ].filter((tab) => tab.show);
  const panels: Record<string, ReactNode> = {
    goals: <GoalsTab view="mine" canCreate canCreateForOthers={false} />,
    team: (
      <GoalsTab
        view={canManage ? "all" : "team"}
        canCreate={canSelf || canReview || canManage}
        canCreateForOthers
      />
    ),
    "my-reviews": <ReviewsTab mode="mine" canManage={canManage} />,
    "team-reviews": <ReviewsTab mode="team" canManage={canManage} />,
    cycles: <CyclesTab />,
    finalise: <ReviewsTab mode="finalise" canManage={canManage} />,
  };
  return (
    <div className="page-enter recruit-page perf-page">
      <PageHeader
        title={text.title}
        description={
          canManage
            ? text.subtitleManage
            : canReview
              ? text.subtitleReview
              : text.subtitleSelf
        }
      />
      {counts && (
        <div className="leave-stats">
          <StatCard
            label={text.stats.active}
            value={counts.active ?? 0}
            hint={text.stats.activeHint}
            icon={Target}
            animate={!reduceMotion}
          />
          <StatCard
            label={text.stats.draft}
            value={counts.draft ?? 0}
            hint={text.stats.draftHint}
            icon={PencilSimple}
            animate={!reduceMotion}
          />
          <StatCard
            label={text.stats.completed}
            value={counts.completed ?? 0}
            hint={text.stats.completedHint}
            icon={CheckCircle}
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
