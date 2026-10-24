import { Link, useSearchParams } from "react-router";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import {
  Badge,
  ErrorState,
  LoadingState,
  Tabs,
  TabList,
  Tab,
  TabPanel,
} from "@anvi/ui";
import { useDashboard } from "../lib/api";
import { useWorkspace } from "./workspace";
import { Distribution } from "../components/distribution";

export default function Teams() {
  const { me } = useWorkspace();
  return me.permissions.includes("directory.read") ? (
    <Explorer />
  ) : (
    <ErrorState message="Your current workspace does not include team or people access." />
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
      <div className="page-heading">
        <div>
          <p className="eyebrow">Different talents. Shared direction.</p>
          <h1>Meet the bigger picture.</h1>
          <p>
            {me.role === "employee"
              ? "Your department and location, based on your own profile."
              : "Explore the departments and locations within your access."}
          </p>
        </div>
        <Badge>
          <UsersThree size={16} />
          {data.total} {data.total === 1 ? "person" : "people"} in scope
        </Badge>
      </div>
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
            <TabList
              aria-label="Explore your organization"
              className="tabs-list"
            >
              <Tab id="departments" className="tab">
                <TreeStructure size={18} />
                Departments{" "}
                <span className="tab-count">{data.departments.length}</span>
              </Tab>
              <Tab id="locations" className="tab">
                <MapPin size={18} />
                Locations{" "}
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
                        <p>
                          {group.count}{" "}
                          {group.count === 1 ? "person" : "people"} in your
                          workspace
                        </p>
                        <div className="team-share">
                          <div>
                            <span
                              style={{
                                transform: `scaleX(${data.total ? group.count / data.total : 0})`,
                              }}
                            />
                          </div>
                          <span>
                            {data.total
                              ? Math.round((group.count / data.total) * 100)
                              : 0}
                            % of scope
                          </span>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="state-card">
                      <h2>No {kind} to show</h2>
                      <p>Visible assignments will appear here.</p>
                    </div>
                  )}
                </div>
              </TabPanel>
            ))}
          </Tabs>
        </section>
        <aside className="panel team-breakdown">
          <div className="panel-heading">
            <div>
              <h2>Connected by people</h2>
              <p>Your department composition.</p>
            </div>
          </div>
          <Distribution data={data} />
          <p className="team-scope-note">
            Counts reflect your current role. They may represent part of a
            department or location.
          </p>
        </aside>
      </div>
    </div>
  );
}
