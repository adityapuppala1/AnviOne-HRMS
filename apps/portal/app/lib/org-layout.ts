import { hierarchy, tree } from "d3-hierarchy";
import { linkHorizontal, linkVertical } from "d3-shape";
import type { OrgChartNeighborhood, OrgChartNodeLite } from "@anvi/contracts";
import type { Orientation } from "./org-chart";

export const CARD = { w: 252, h: 96 } as const;
// Past this many reports a single row stops being readable; they wrap into a grid.
const GRID_FROM = 6;

export type Role = "manager" | "focus" | "report";
export type Placed = {
  id: string;
  role: Role;
  node: OrgChartNodeLite;
  x: number; // top-left of the card
  y: number;
};
export type Layout = {
  nodes: Placed[];
  links: { id: string; d: string; to: { x: number; y: number } }[];
  width: number;
  height: number;
};

type Datum = { node: OrgChartNodeLite; role: Role; children?: Datum[] };
type Pt = { x: number; y: number };
type Link = { source: Pt; target: Pt };

// Three tiers drawn with d3-hierarchy's tree layout: manager, then the
// selected person, then their direct reports. Positions are card centres in a
// "depth, across" space that is mapped onto x/y by orientation.
export function layoutNeighborhood(
  data: OrgChartNeighborhood,
  orientation: Orientation,
): Layout {
  const vertical = orientation === "vertical";
  const reports: Datum[] = data.reports.map((node) => ({
    node,
    role: "report",
  }));
  const focus: Datum = { node: data.focus, role: "focus", children: reports };
  const root: Datum = data.manager
    ? { node: data.manager, role: "manager", children: [focus] }
    : focus;

  const acrossStep = vertical ? CARD.w + 24 : CARD.h + 18;
  const depthStep = vertical ? CARD.h + 76 : CARD.w + 96;
  const laid = tree<Datum>().nodeSize([acrossStep, depthStep])(hierarchy(root));

  const centres = new Map<string, { depth: number; across: number }>();
  laid.each((item) =>
    centres.set(item.data.node.id, { depth: item.y, across: item.x }),
  );

  if (reports.length > GRID_FROM) {
    const anchor = centres.get(data.focus.id)!;
    const perRow = vertical ? 4 : 6;
    const rowStep = vertical ? CARD.h + 28 : CARD.w + 40;
    const firstRow = anchor.depth + depthStep;
    reports.forEach((report, index) => {
      const row = Math.floor(index / perRow);
      const inRow = Math.min(perRow, reports.length - row * perRow);
      const col = index % perRow;
      centres.set(report.node.id, {
        depth: firstRow + row * rowStep,
        across: anchor.across + (col - (inRow - 1) / 2) * acrossStep,
      });
    });
  }

  const toXY = (c: { depth: number; across: number }): Pt =>
    vertical ? { x: c.across, y: c.depth } : { x: c.depth, y: c.across };

  const placed: Placed[] = [];
  const add = (datum: Datum) => {
    const c = toXY(centres.get(datum.node.id)!);
    placed.push({
      id: datum.node.id,
      role: datum.role,
      node: datum.node,
      x: c.x - CARD.w / 2,
      y: c.y - CARD.h / 2,
    });
  };
  if (data.manager) add(root);
  add(focus);
  reports.forEach(add);

  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  const pad = 40;
  placed.forEach((p) => {
    p.x = Math.round(p.x - minX + pad);
    p.y = Math.round(p.y - minY + pad);
  });
  const width = Math.max(...placed.map((p) => p.x + CARD.w)) + pad;
  const height = Math.max(...placed.map((p) => p.y + CARD.h)) + pad;

  const byId = new Map(placed.map((p) => [p.id, p]));
  const make = vertical ? linkVertical<Link, Pt>() : linkHorizontal<Link, Pt>();
  const curve = make.x((p) => p.x).y((p) => p.y);
  const links: Layout["links"] = [];
  const connect = (fromId: string, toId: string) => {
    const a = byId.get(fromId)!;
    const b = byId.get(toId)!;
    const source = vertical
      ? { x: a.x + CARD.w / 2, y: a.y + CARD.h }
      : { x: a.x + CARD.w, y: a.y + CARD.h / 2 };
    const target = vertical
      ? { x: b.x + CARD.w / 2, y: b.y }
      : { x: b.x, y: b.y + CARD.h / 2 };
    links.push({
      id: `${fromId}>${toId}`,
      d: curve({ source, target }) ?? "",
      to: target,
    });
  };
  if (data.manager) connect(data.manager.id, data.focus.id);
  reports.forEach((report) => connect(data.focus.id, report.node.id));
  return { nodes: placed, links, width, height };
}
