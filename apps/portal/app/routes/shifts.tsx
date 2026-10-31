import type { ReactNode } from "react";
import { ErrorState, PageHeader, UTabs } from "@anvi/ui";
import { shiftsCopy as text } from "../lib/copy/shifts";
import { MyRosterTab } from "../components/shifts/roster";
import { TeamRosterTab } from "../components/shifts/team";
import { SwapsTab } from "../components/shifts/swaps";
import { OpenShiftsTab } from "../components/shifts/open";
import { SettingsTab } from "../components/shifts/settings";
import { useWorkspace } from "./workspace";
import "./leave.css";
import "./recruitment.css";
import "./performance.css";
import "./helpdesk.css";
import "./shifts.css";

export default function Shifts() {
  const { me } = useWorkspace();
  const has = (permission: string) =>
    me.permissions.includes(permission as (typeof me.permissions)[number]);
  const self = has("shift.self");
  const team = has("shift.team");
  const manage = has("shift.manage");
  if (!self && !team && !manage) return <ErrorState message={text.denied} />;
  const plans = team || manage;
  const tabs = [
    { id: "mine", label: text.tabs.mine, show: self },
    { id: "team", label: text.tabs.team, show: plans },
    { id: "swaps", label: text.tabs.swaps, show: true },
    { id: "open", label: text.tabs.open, show: true },
    { id: "settings", label: text.tabs.settings, show: manage },
  ].filter((tab) => tab.show);
  const panels: Record<string, ReactNode> = {
    mine: <MyRosterTab />,
    team: <TeamRosterTab />,
    swaps: <SwapsTab self={self} decide={plans} />,
    open: <OpenShiftsTab decide={plans} />,
    settings: <SettingsTab />,
  };
  return (
    <div className="page-enter recruit-page perf-page hd-page shf-page">
      <PageHeader
        title={text.title}
        description={
          manage
            ? text.subtitleManage
            : team
              ? text.subtitleTeam
              : text.subtitleSelf
        }
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
