import { useMemo, useState, type ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Button,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  StatusBadge,
  UAvatar,
} from "@anvi/ui";
import type { OrganizationChart } from "@anvi/contracts";
import { useOrgChart } from "../lib/api";
import { useWorkspace } from "./workspace";
import { chartCopy as text } from "../lib/copy/chart";
import "./chart.css";

type ChartNode = OrganizationChart["nodes"][number];
type Tree = {
  roots: ChartNode[];
  children: Map<string, ChartNode[]>;
};

export default function Chart() {
  const { me } = useWorkspace();
  return me.permissions.includes("directory.read") ? (
    <ChartView />
  ) : (
    <ErrorState message={text.noAccess} />
  );
}

// The server returns a flat list; rebuild the tree from managerId, following
// each node once so a reporting loop can never repeat or hang the page.
function buildTree(chart: OrganizationChart): Tree {
  const byId = new Map(chart.nodes.map((node) => [node.id, node]));
  const children = new Map<string, ChartNode[]>();
  for (const node of chart.nodes) {
    if (node.managerId && byId.has(node.managerId)) {
      const siblings = children.get(node.managerId) ?? [];
      siblings.push(node);
      children.set(node.managerId, siblings);
    }
  }
  const roots = chart.rootIds
    .map((id) => byId.get(id))
    .filter((node): node is ChartNode => Boolean(node));
  return { roots, children };
}

function matches(node: ChartNode, needle: string) {
  return [node.name, node.title, node.department].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

function ChartView() {
  const { data, error, isPending, refetch } = useOrgChart(null, 20);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string> | null>(null);
  const tree = useMemo(() => (data ? buildTree(data) : null), [data]);
  const needle = query.trim().toLowerCase();

  // Nodes to draw while searching: every match plus the people it sits under.
  const visible = useMemo(() => {
    if (!needle || !tree) return null;
    const keep = new Set<string>();
    const walk = (node: ChartNode, trail: ChartNode[], seen: Set<string>) => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      const path = [...trail, node];
      if (matches(node, needle)) path.forEach((item) => keep.add(item.id));
      for (const child of tree.children.get(node.id) ?? [])
        walk(child, path, seen);
    };
    const seen = new Set<string>();
    tree.roots.forEach((root) => walk(root, [], seen));
    return keep;
  }, [needle, tree]);
  const matchCount = useMemo(() => {
    if (!needle || !data) return 0;
    return data.nodes.filter((node) => matches(node, needle)).length;
  }, [needle, data]);

  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (isPending || !data || !tree) return <LoadingState />;

  const withReports = data.nodes.filter((node) => tree.children.has(node.id));
  // First view: the top of the tree open, deeper teams one click away.
  const expanded =
    open ??
    new Set(
      tree.roots
        .filter((root) => tree.children.has(root.id))
        .map((root) => root.id),
    );
  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  }

  return (
    <div className="page-enter chart-page">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.heading}
        description={text.intro}
      />
      <div className="chart-notes">
        <p className="chart-note">
          <Info size={18} weight="duotone" />
          <span>
            {text.scope[data.scope]} {text.total(data.total)}.
          </span>
        </p>
        {data.truncated && (
          <p className="chart-note chart-note-warn" role="status">
            <Warning size={18} weight="duotone" />
            <span>
              <strong>{text.partialTitle}.</strong> {text.partial}
            </span>
          </p>
        )}
      </div>
      <section className="panel chart-panel" aria-label={text.treeLabel}>
        <div className="chart-toolbar">
          <Input
            aria-label={text.searchLabel}
            placeholder={text.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={query}
            onChange={setQuery}
            className="chart-search"
          />
          {query && (
            <Button variant="ghost" onPress={() => setQuery("")}>
              {text.clearSearch}
              <X size={15} />
            </Button>
          )}
          <div className="chart-bulk">
            <Button
              variant="secondary"
              isDisabled={!withReports.length || Boolean(needle)}
              onPress={() => setOpen(new Set(withReports.map((n) => n.id)))}
            >
              {text.expandAll}
            </Button>
            <Button
              variant="secondary"
              isDisabled={!withReports.length || Boolean(needle)}
              onPress={() => setOpen(new Set())}
            >
              {text.collapseAll}
            </Button>
          </div>
        </div>
        <p className="chart-live" role="status" aria-live="polite">
          {needle ? text.matches(matchCount) : ""}
        </p>
        {!tree.roots.length ? (
          <EmptyBlock
            icon={TreeStructure}
            title={text.emptyTitle}
            description={text.emptyBody}
          />
        ) : visible && visible.size === 0 ? (
          <EmptyBlock
            icon={MagnifyingGlass}
            title={text.noMatchesTitle}
            description={text.noMatchesBody}
            action={
              <Button variant="secondary" onPress={() => setQuery("")}>
                {text.clearSearch}
              </Button>
            }
          />
        ) : (
          <ul className="chart-tree chart-level-1" aria-label={text.treeLabel}>
            {tree.roots
              .filter((root) => !visible || visible.has(root.id))
              .map((root) => (
                <Branch
                  key={root.id}
                  node={root}
                  level={1}
                  tree={tree}
                  expanded={expanded}
                  onToggle={toggle}
                  visible={visible}
                  needle={needle}
                  trail={new Set()}
                />
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Branch({
  node,
  level,
  tree,
  expanded,
  onToggle,
  visible,
  needle,
  trail,
}: {
  node: ChartNode;
  level: number;
  tree: Tree;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  visible: Set<string> | null;
  needle: string;
  trail: Set<string>;
}) {
  const kids = (tree.children.get(node.id) ?? []).filter(
    (child) => !trail.has(child.id) && (!visible || visible.has(child.id)),
  );
  const searching = Boolean(visible);
  const isOpen = searching ? kids.length > 0 : expanded.has(node.id);
  const listId = `chart-reports-${node.id}`;
  const nextTrail = new Set(trail).add(node.id);
  return (
    <li className="chart-branch" data-deep={level > 4 ? "true" : undefined}>
      <div className="chart-row">
        {kids.length > 0 && !searching ? (
          <button
            type="button"
            className="chart-toggle"
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-label={text.reportsToggle(node.name)}
            onClick={() => onToggle(node.id)}
          >
            <CaretRight size={18} weight="bold" aria-hidden="true" />
          </button>
        ) : (
          <span className="chart-toggle-spacer" aria-hidden="true" />
        )}
        <Card
          node={node}
          needle={needle}
          matched={Boolean(needle) && matches(node, needle)}
        />
      </div>
      {kids.length > 0 && (
        <ul
          id={listId}
          className="chart-children"
          hidden={!isOpen}
          aria-label={text.reportsToggle(node.name)}
        >
          {isOpen &&
            kids.map((child) => (
              <Branch
                key={child.id}
                node={child}
                level={level + 1}
                tree={tree}
                expanded={expanded}
                onToggle={onToggle}
                visible={visible}
                needle={needle}
                trail={nextTrail}
              />
            ))}
        </ul>
      )}
    </li>
  );
}

function Card({
  node,
  needle,
  matched,
}: {
  node: ChartNode;
  needle: string;
  matched: boolean;
}) {
  return (
    <div className={`chart-card${matched ? " is-match" : ""}`}>
      <UAvatar size="md" initials={node.initials} alt="" />
      <div className="chart-card-body">
        <p className="chart-name">
          <Highlight value={node.name} needle={needle} />
          {node.status === "notice" && (
            <StatusBadge color="warning" size="sm" type="pill-color">
              {text.onNotice}
            </StatusBadge>
          )}
        </p>
        <p className="chart-title">
          <Highlight value={node.title || text.noTitle} needle={needle} />
        </p>
        <p className="chart-meta">
          <span>
            <Highlight
              value={node.department || text.noDepartment}
              needle={needle}
            />
          </span>
          <span>{text.directReports(node.directReportCount)}</span>
        </p>
      </div>
    </div>
  );
}

function Highlight({
  value,
  needle,
}: {
  value: string;
  needle: string;
}): ReactNode {
  if (!needle) return value;
  const lower = value.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (;;) {
    const hit = lower.indexOf(needle, at);
    if (hit < 0) break;
    if (hit > at) parts.push(value.slice(at, hit));
    parts.push(<mark key={hit}>{value.slice(hit, hit + needle.length)}</mark>);
    at = hit + needle.length;
  }
  if (!parts.length) return value;
  if (at < value.length) parts.push(value.slice(at));
  return parts;
}
