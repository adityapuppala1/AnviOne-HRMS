import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import "d3-transition";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { CornersOut } from "@phosphor-icons/react/dist/csr/CornersOut";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { Avatar } from "@anvi/ui";
import type { OrgChartNeighborhood } from "@anvi/contracts";
import { CARD, layoutNeighborhood, type Placed } from "../lib/org-layout";
import { deptLabel, type Orientation } from "../lib/org-chart";
import { chartCopy as text } from "../lib/copy/chart";

const MIN_K = 0.3;
const MAX_K = 3;

export default function OrgNetwork({
  data,
  meId,
  orientation,
  reduced,
  onFocus,
  onHome,
}: {
  data: OrgChartNeighborhood;
  meId: string;
  orientation: Orientation;
  reduced: boolean;
  onFocus: (id: string) => void;
  onHome: () => void;
}) {
  const layout = useMemo(
    () => layoutNeighborhood(data, orientation),
    [data, orientation],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const behavior = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const kRef = useRef(1);
  const [k, setK] = useState(1);
  const [announce, setAnnounce] = useState("");

  // One d3-zoom behaviour for the life of the view: wheel, drag, double click
  // and touch pinch all come from it; the keyboard calls the same behaviour.
  useLayoutEffect(() => {
    const el = viewport.current;
    const st = stage.current;
    if (!el || !st) return;
    const z = zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_K, MAX_K])
      .filter(
        (event: Event & { ctrlKey?: boolean; button?: number }) =>
          !(event.target as Element).closest?.(".oc-zoom") &&
          (!event.ctrlKey || event.type === "wheel") &&
          !event.button,
      )
      .on("zoom", (event) => {
        const t = event.transform;
        st.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        kRef.current = t.k;
        setK(t.k);
      });
    behavior.current = z;
    select(el).call(z);
    return () => {
      select(el).interrupt().on(".zoom", null);
      behavior.current = null;
    };
  }, []);

  const fit = useCallback((animate: boolean) => {
    const el = viewport.current;
    const z = behavior.current;
    if (!el || !z) return;
    const { clientWidth: w, clientHeight: h } = el;
    if (!w || !h) return;
    const { width, height } = layoutRef.current;
    const scale = Math.max(
      MIN_K,
      Math.min(1.15, (w - 24) / width, (h - 24) / height),
    );
    const t = zoomIdentity
      .translate((w - width * scale) / 2, (h - height * scale) / 2)
      .scale(scale);
    const s = select<HTMLDivElement, unknown>(el);
    if (animate && !reducedRef.current)
      s.transition().duration(450).call(z.transform, t);
    else s.interrupt().call(z.transform, t);
  }, []);

  // Fit when the focus, data or orientation changes, and when the box resizes.
  const first = useRef(true);
  useLayoutEffect(() => {
    fit(!first.current);
    first.current = false;
  }, [layout, fit]);
  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => fit(false), 120);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [fit]);

  useEffect(() => {
    const timer = setTimeout(
      () => setAnnounce(text.zoom.level(Math.round(k * 100))),
      500,
    );
    return () => clearTimeout(timer);
  }, [k]);

  const scaleBy = (factor: number) => {
    const el = viewport.current;
    const z = behavior.current;
    if (!el || !z) return;
    const s = select<HTMLDivElement, unknown>(el);
    if (reducedRef.current) s.interrupt().call(z.scaleBy, factor);
    else s.transition().duration(160).call(z.scaleBy, factor);
  };
  const panBy = (dx: number, dy: number) => {
    const el = viewport.current;
    const z = behavior.current;
    if (!el || !z) return;
    select<HTMLDivElement, unknown>(el)
      .interrupt()
      .call(z.translateBy, dx / kRef.current, dy / kRef.current);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = 80;
    switch (event.key) {
      case "+":
      case "=":
        scaleBy(1.25);
        break;
      case "-":
      case "_":
        scaleBy(0.8);
        break;
      case "0":
        fit(true);
        break;
      case "ArrowLeft":
        panBy(step, 0);
        break;
      case "ArrowRight":
        panBy(-step, 0);
        break;
      case "ArrowUp":
        panBy(0, step);
        break;
      case "ArrowDown":
        panBy(0, -step);
        break;
      case "Home":
        onHome();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // Tabbing to a person who is off screen brings them into view.
  function onFocusCapture(event: FocusEvent<HTMLDivElement>) {
    const el = viewport.current;
    const target = event.target as HTMLElement;
    if (!el || target === el || !target.classList.contains("oc-node")) return;
    const v = el.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.left < v.left + 8) dx = v.left + 16 - r.left;
    else if (r.right > v.right - 8) dx = v.right - 16 - r.right;
    if (r.top < v.top + 8) dy = v.top + 16 - r.top;
    else if (r.bottom > v.bottom - 8) dy = v.bottom - 16 - r.bottom;
    if (dx || dy) panBy(dx, dy);
  }

  return (
    <div className="oc-net">
      <div
        ref={viewport}
        className="oc-viewport"
        role="group"
        aria-roledescription={text.zoom.roleDescription}
        aria-label={text.zoom.canvasLabel}
        aria-describedby="oc-net-help"
        tabIndex={0}
        data-orientation={orientation}
        onKeyDown={onKeyDown}
        onFocusCapture={onFocusCapture}
        onScroll={(event) => {
          event.currentTarget.scrollTo(0, 0);
        }}
      >
        <div ref={stage} className="oc-stage">
          <svg
            className="oc-links"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
            focusable="false"
          >
            {layout.links.map((link) => (
              <g key={link.id}>
                <path d={link.d} className="oc-link" />
                <circle
                  cx={link.to.x}
                  cy={link.to.y}
                  r={4.5}
                  className="oc-link-dot"
                />
              </g>
            ))}
          </svg>
          {layout.nodes.map((placed) => (
            <NodeCard
              key={placed.id}
              placed={placed}
              isMe={placed.id === meId}
              managerAbove={
                placed.role === "manager" &&
                data.skipLevelHint.managerHasManager
              }
              onFocus={onFocus}
            />
          ))}
        </div>
        <div
          className="oc-zoom"
          role="group"
          aria-label={text.zoom.group}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="oc-tool"
            aria-label={text.zoom.in}
            onClick={() => scaleBy(1.25)}
          >
            <Plus size={18} weight="bold" aria-hidden="true" />
          </button>
          <span
            className="oc-zoom-level"
            data-testid="zoom-level"
            aria-hidden="true"
          >
            {Math.round(k * 100)}%
          </span>
          <button
            type="button"
            className="oc-tool"
            aria-label={text.zoom.out}
            onClick={() => scaleBy(0.8)}
          >
            <Minus size={18} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="oc-tool"
            aria-label={text.zoom.fit}
            onClick={() => fit(true)}
          >
            <CornersOut size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <p id="oc-net-help" className="oc-help">
        {text.zoom.help}
      </p>
    </div>
  );
}

function NodeCard({
  placed,
  isMe,
  managerAbove,
  onFocus,
}: {
  placed: Placed;
  isMe: boolean;
  managerAbove: boolean;
  onFocus: (id: string) => void;
}) {
  const { node, role } = placed;
  return (
    <button
      type="button"
      className="oc-node"
      data-role={role}
      aria-current={role === "focus" ? "true" : undefined}
      style={{
        width: CARD.w,
        height: CARD.h,
        transform: `translate(${placed.x}px, ${placed.y}px)`,
      }}
      onClick={() => {
        if (role !== "focus") onFocus(node.id);
      }}
    >
      <Avatar initials={node.initials} />
      <span className="oc-node-body">
        <span className="oc-node-name">
          {node.name}
          {isMe && <span className="oc-you">{text.node.youBadge}</span>}
        </span>
        <span className="oc-node-title">{node.title || text.noTitle}</span>
        <span className="oc-node-meta">
          <span>{deptLabel(node.department, text.noDepartment)}</span>
          <span className="oc-count">
            {text.node.reports(node.directReportCount)}
          </span>
        </span>
      </span>
      {managerAbove && (
        <span className="oc-above" title={text.focusBar.managerAbove}>
          <ArrowUp size={12} weight="bold" aria-hidden="true" />
          <span className="sr-only">{text.focusBar.managerAbove}</span>
        </span>
      )}
    </button>
  );
}
