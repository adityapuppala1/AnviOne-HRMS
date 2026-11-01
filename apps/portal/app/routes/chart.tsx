import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Columns } from "@phosphor-icons/react/dist/csr/Columns";
import { Rows } from "@phosphor-icons/react/dist/csr/Rows";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  ErrorState,
  LoadingState,
  PageHeader,
  UTabs,
} from "@anvi/ui";
import type { OrgChartNodeLite } from "@anvi/contracts";
import { ApiError, useOrgNeighborhood } from "../lib/api";
import {
  isUuid,
  readOrientation,
  saveOrientation,
  useReducedMotion,
  type Orientation,
} from "../lib/org-chart";
import { useWorkspace } from "./workspace";
import { chartCopy as text } from "../lib/copy/chart";
import { OrgSearch } from "../components/org-search";
import { OrgList } from "../components/org-list";
import { WholeTree } from "../components/org-whole-tree";
import OrgNetwork from "../components/org-network";
import "./chart.css";
import "./chart-view.css";

// three.js is large and only the 3D tab needs it, so it loads on demand.
const Org3D = lazy(() => import("../components/org-3d"));

type View = "network" | "3d" | "list" | "whole";
const VIEWS: readonly View[] = ["network", "3d", "list", "whole"];

export default function Chart() {
  const { me } = useWorkspace();
  return me.permissions.includes("directory.read") ? (
    <ChartView />
  ) : (
    <ErrorState message={text.noAccess} />
  );
}

function ChartView() {
  const { me } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const requested = params.get("focus");
  const focusId = isUuid(requested) ? requested : me.employeeId;
  const [view, setView] = useState<View>("network");
  const [orientation, setOrientation] = useState<Orientation>("vertical");
  const reduced = useReducedMotion();
  const hood = useOrgNeighborhood(focusId);
  const [said, setSaid] = useState("");

  // localStorage is read after mount so server and client markup agree.
  useEffect(() => setOrientation(readOrientation()), []);

  function refocus(id: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === me.employeeId) next.delete("focus");
        else next.set("focus", id);
        return next;
      },
      { preventScrollReset: true },
    );
  }
  function pick(person: OrgChartNodeLite) {
    refocus(person.id);
    setSaid(text.find.shown(person.name));
  }
  function chooseOrientation(next: Orientation) {
    setOrientation(next);
    saveOrientation(next);
  }

  const data = hood.data;
  const summary = data
    ? text.neighborhood(
        data.focus.name,
        data.manager?.name ?? null,
        data.reportCount,
      )
    : "";
  const visual = view === "network" || view === "3d";

  return (
    <div className="page-enter chart-page">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.heading}
        description={text.intro2}
      />
      <OrgSearch onPick={pick} />
      <section className="panel chart-panel">
        <UTabs
          selectedKey={view}
          onSelectionChange={(key) => {
            const next = VIEWS.find((item) => item === key);
            if (next) setView(next);
          }}
        >
          <div className="chart-tabs-bar">
            <div className="chart-tabs-scroll">
              <UTabs.List type="underline" aria-label={text.views.label}>
                <UTabs.Item id="network">{text.views.network}</UTabs.Item>
                <UTabs.Item id="3d">{text.views.threeD}</UTabs.Item>
                <UTabs.Item id="list">{text.views.list}</UTabs.Item>
                <UTabs.Item id="whole">{text.views.whole}</UTabs.Item>
              </UTabs.List>
            </div>
            {visual && (
              <ButtonGroup
                aria-label={text.orientation.label}
                size="sm"
                disallowEmptySelection
                selectedKeys={[orientation]}
                onSelectionChange={(keys) => {
                  const key = [...keys][0];
                  if (key === "vertical" || key === "horizontal")
                    chooseOrientation(key);
                }}
              >
                <ButtonGroupItem
                  id="vertical"
                  iconLeading={<Rows size={18} aria-hidden="true" />}
                >
                  {text.orientation.vertical}
                </ButtonGroupItem>
                <ButtonGroupItem
                  id="horizontal"
                  iconLeading={<Columns size={18} aria-hidden="true" />}
                >
                  {text.orientation.horizontal}
                </ButtonGroupItem>
              </ButtonGroup>
            )}
          </div>

          {view !== "whole" && (
            <div className="chart-focusbar">
              <Button
                variant="secondary"
                isDisabled={focusId === me.employeeId}
                onPress={() => refocus(me.employeeId)}
              >
                {text.focusBar.mine}
              </Button>
              {data?.manager && (
                <Button
                  variant="secondary"
                  onPress={() => refocus(data.manager!.id)}
                >
                  {text.focusBar.manager}
                </Button>
              )}
              {data?.truncated && (
                <p className="chart-note chart-note-warn" role="status">
                  <Warning size={18} weight="duotone" aria-hidden="true" />
                  <span>
                    {text.truncated(data.reports.length, data.reportCount)}
                  </span>
                </p>
              )}
            </div>
          )}

          {(["network", "3d", "list"] as const).map((key) => (
            <UTabs.Panel key={key} id={key} className="chart-view">
              <Neighborhood
                state={hood}
                onRetry={() => void hood.refetch()}
                onMine={() => refocus(me.employeeId)}
              >
                {(hoodData) =>
                  key === "network" ? (
                    <OrgNetwork
                      data={hoodData}
                      meId={me.employeeId}
                      orientation={orientation}
                      reduced={reduced}
                      onFocus={refocus}
                      onHome={() => refocus(me.employeeId)}
                    />
                  ) : key === "3d" ? (
                    <Suspense
                      fallback={
                        <p className="oc-3d-loading-block" role="status">
                          {text.three.loading}
                        </p>
                      }
                    >
                      <Org3D
                        data={hoodData}
                        meId={me.employeeId}
                        orientation={orientation}
                        reduced={reduced}
                        onFocus={refocus}
                        onUnsupported={() => setView("network")}
                      />
                    </Suspense>
                  ) : (
                    <OrgList
                      data={hoodData}
                      meId={me.employeeId}
                      onFocus={refocus}
                    />
                  )
                }
              </Neighborhood>
            </UTabs.Panel>
          ))}
          <UTabs.Panel id="whole" className="chart-view">
            <WholeTree />
          </UTabs.Panel>
        </UTabs>
      </section>
      <p className="chart-note chart-visibility">
        <Info size={18} weight="duotone" aria-hidden="true" />
        <span>{text.visibility}</span>
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {said && data ? `${said} ${summary}` : summary}
      </p>
    </div>
  );
}

function Neighborhood({
  state,
  onRetry,
  onMine,
  children,
}: {
  state: ReturnType<typeof useOrgNeighborhood>;
  onRetry: () => void;
  onMine: () => void;
  children: (
    data: NonNullable<ReturnType<typeof useOrgNeighborhood>["data"]>,
  ) => React.ReactNode;
}) {
  const { data, error, isPending } = state;
  if (data) return <>{children(data)}</>;
  if (error) {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 404)
      return <ErrorState message={text.unknownPerson} onRetry={onMine} />;
    const message =
      status === 403
        ? text.neighborhoodForbidden
        : status === 503
          ? text.neighborhoodUnavailable
          : text.neighborhoodFailed;
    return (
      <ErrorState
        message={message}
        onRetry={status === 403 ? undefined : onRetry}
      />
    );
  }
  if (isPending) return <LoadingState />;
  return null;
}
