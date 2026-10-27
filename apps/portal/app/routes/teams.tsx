import { Link, useSearchParams } from "react-router";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import {
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  Tabs,
  TabList,
  Tab,
  TabPanel,
} from "@anvi/ui";
import { useDashboard } from "../lib/api";
import { useWorkspace } from "./workspace";
import { Distribution } from "../components/distribution";
import { teamsCopy as text } from "../lib/copy/screens";

export default function Teams() {
  const { me } = useWorkspace();
  return me.permissions.includes("directory.read") ? (
    <Explorer />
  ) : (
    <ErrorState message={text.noAccess} />
  );
}
function Explorer() {
  const { me } = useWorkspace();
  const { data, error, refetch } = useDashboard();
  const [params, setParams] = useSearchParams();
  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (!data) return <LoadingState />;
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={
          me.role === "employee" ? text.subtitleEmployee : text.subtitleOther
        }
        actions={
          <StatusBadge color="brand" size="lg">
            <UsersThree size={16} />
            {text.inScope(data.total)}
          </StatusBadge>
        }
      ></PageHeader>
      <div className="team-explorer-layout">
        <section className="panel team-explorer">
          <Tabs
            selectedKey={
              params.get("view") === "locations" ? "locations" : "departments"
            }
            onSelectionChange={(key) =>
              void setParams(key === "locations" ? { view: "locations" } : {}, {
                replace: true,
              })
            }
          >
            <TabList aria-label={text.exploreLabel} className="tabs-list">
              <Tab id="departments" className="tab">
                <TreeStructure size={18} />
                {text.tabs.departments}{" "}
                <span className="tab-count">{data.departments.length}</span>
              </Tab>
              <Tab id="locations" className="tab">
                <MapPin size={18} />
                {text.tabs.locations}{" "}
                <span className="tab-count">{data.locations.length}</span>
              </Tab>
            </TabList>
            {(["departments", "locations"] as const).map((kind) => (
              <TabPanel id={kind} key={kind} className="tab-panel">
                <div className="team-grid">
                  {data[kind].length ? (
                    data[kind].map((group, index) => (
                      <Link
                        key={group.name}
                        className="team-card"
                        to={`/people?${kind === "departments" ? "department" : "location"}=${encodeURIComponent(group.name)}`}
                      >
                        <div className="team-card-top">
                          <span
                            style={{ background: `var(--chart-${index % 6})` }}
                          >
                            {kind === "departments" ? (
                              <Buildings size={24} />
                            ) : (
                              <MapPin size={24} />
                            )}
                          </span>
                          <ArrowUpRight size={20} />
                        </div>
                        <h2>{group.name}</h2>
                        <p>{text.card.inWorkspace(group.count)}</p>
                        <div className="team-share">
                          <div>
                            <span
                              style={{
                                transform: `scaleX(${data.total ? group.count / data.total : 0})`,
                              }}
                            />
                          </div>
                          <span>
                            {text.card.share(
                              data.total
                                ? Math.round((group.count / data.total) * 100)
                                : 0,
                            )}
                          </span>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <EmptyBlock
                      icon={kind === "departments" ? Buildings : MapPin}
                      title={text.empty.title(kind)}
                      description={text.empty.detail}
                    />
                  )}
                </div>
              </TabPanel>
            ))}
          </Tabs>
        </section>
        <aside className="panel team-breakdown">
          <div className="panel-heading">
            <div>
              <h2>{text.breakdown.title}</h2>
              <p>{text.breakdown.subtitle}</p>
            </div>
          </div>
          <Distribution data={data} />
          <p className="team-scope-note">{text.breakdown.note}</p>
        </aside>
      </div>
    </div>
  );
}
