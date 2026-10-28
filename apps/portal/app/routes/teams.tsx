import { Link, useNavigate, useSearchParams } from "react-router";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import {
  CollectionView,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  UTabs,
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
  const navigate = useNavigate();
  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (!data) return <LoadingState />;
  const href = (kind: "departments" | "locations", name: string) =>
    `/people?${kind === "departments" ? "department" : "location"}=${encodeURIComponent(name)}`;
  const pct = (count: number) =>
    data.total ? Math.round((count / data.total) * 100) : 0;
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
          <UTabs
            keyboardActivation="automatic"
            selectedKey={
              params.get("view") === "locations" ? "locations" : "departments"
            }
            onSelectionChange={(key) =>
              void setParams(key === "locations" ? { view: "locations" } : {}, {
                replace: true,
              })
            }
          >
            <UTabs.List type="underline" aria-label={text.exploreLabel}>
              <UTabs.Item id="departments">
                <TreeStructure size={18} />
                {text.tabs.departments}{" "}
                <span className="tab-count">{data.departments.length}</span>
              </UTabs.Item>
              <UTabs.Item id="locations">
                <MapPin size={18} />
                {text.tabs.locations}{" "}
                <span className="tab-count">{data.locations.length}</span>
              </UTabs.Item>
            </UTabs.List>
            {(["departments", "locations"] as const).map((kind) => (
              <UTabs.Panel id={kind} key={kind} className="tab-panel">
                <CollectionView
                  id={`teams-${kind}`}
                  label={text.tabs[kind]}
                  noun={kind}
                  items={data[kind]}
                  getKey={(group) => group.name}
                  onOpen={(group) => void navigate(href(kind, group.name))}
                  cardClassName="!bg-transparent !p-0 !shadow-none !ring-0"
                  emptyIcon={kind === "departments" ? Buildings : MapPin}
                  emptyTitle={text.empty.title(kind)}
                  emptyDescription={text.empty.detail}
                  columns={[
                    {
                      id: "name",
                      label: kind === "departments" ? "Department" : "Location",
                      isRowHeader: true,
                      sortValue: (group) => group.name.toLowerCase(),
                      render: (group) => (
                        <Link to={href(kind, group.name)}>{group.name}</Link>
                      ),
                    },
                    {
                      id: "count",
                      label: "People",
                      sortValue: (group) => group.count,
                      render: (group) => text.card.inWorkspace(group.count),
                    },
                    {
                      id: "share",
                      label: "Share",
                      sortValue: (group) => group.count,
                      render: (group) => text.card.share(pct(group.count)),
                    },
                  ]}
                  renderCard={(group) => {
                    const index = data[kind].indexOf(group);
                    return (
                      <Link className="team-card" to={href(kind, group.name)}>
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
                          <span>{text.card.share(pct(group.count))}</span>
                        </div>
                      </Link>
                    );
                  }}
                />
              </UTabs.Panel>
            ))}
          </UTabs>
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
