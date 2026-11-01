import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { Button } from "@anvi/ui";
import type { OrgChartNeighborhood, OrgChartNodeLite } from "@anvi/contracts";
import {
  createScene,
  readPalette,
  MAX_3D_REPORTS,
  type SceneApi,
} from "../lib/org-scene";
import type { Orientation } from "../lib/org-chart";
import { chartCopy as text } from "../lib/copy/chart";

export default function Org3D({
  data,
  meId,
  orientation,
  reduced,
  onFocus,
  onUnsupported,
}: {
  data: OrgChartNeighborhood;
  meId: string;
  orientation: Orientation;
  reduced: boolean;
  onFocus: (id: string) => void;
  onUnsupported: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneApi | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [percent, setPercent] = useState(100);
  const [announce, setAnnounce] = useState("");
  const [theme, setTheme] = useState(0);
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  // Build the renderer once; everything it draws is rebuilt by the effect below.
  useLayoutEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;
    try {
      scene.current = createScene(hostEl, {
        onActivate: (id) => onFocusRef.current(id),
        onSelect: (node: OrgChartNodeLite | null) =>
          setAnnounce(node ? text.three.selected(node.name, node.title) : ""),
        onZoom: setPercent,
        onLost: () => setFailed(true),
      });
      setReady(true);
    } catch {
      setFailed(true);
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  // Colours come from the live theme tokens, so a theme switch rebuilds them.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((n) => n + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready || !scene.current) return;
    let cancelled = false;
    const build = () => {
      if (cancelled || !scene.current) return;
      scene.current.setContent(data, orientation, meId, readPalette(), reduced);
    };
    // Card labels use the portal fonts; wait for them so text is not drawn in a fallback.
    if (document.fonts?.ready) void document.fonts.ready.then(build, build);
    else build();
    return () => {
      cancelled = true;
    };
  }, [ready, data, orientation, meId, theme, reduced]);

  useEffect(() => {
    scene.current?.setReduced(reduced);
  }, [reduced]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (scene.current?.key(event.nativeEvent)) event.preventDefault();
  }

  if (failed)
    return (
      <div className="oc-fallback" role="status">
        <p>{text.three.noWebgl}</p>
        <Button variant="secondary" onPress={onUnsupported}>
          {text.three.switchNetwork}
        </Button>
      </div>
    );

  return (
    <div className="oc-net">
      <div
        ref={host}
        className="oc-3d"
        role="group"
        aria-roledescription={text.three.roleDescription}
        aria-label={text.three.canvasLabel}
        aria-describedby="oc-3d-help"
        tabIndex={0}
        data-testid="org-3d"
        onKeyDown={onKeyDown}
      >
        {!ready && <p className="oc-3d-loading">{text.three.loading}</p>}
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
            onClick={() => scene.current?.zoomBy(1.25)}
          >
            <Plus size={18} weight="bold" aria-hidden="true" />
          </button>
          <span className="oc-zoom-level" aria-hidden="true">
            {percent}%
          </span>
          <button
            type="button"
            className="oc-tool"
            aria-label={text.zoom.out}
            onClick={() => scene.current?.zoomBy(0.8)}
          >
            <Minus size={18} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="oc-tool"
            aria-label={text.three.reset}
            onClick={() => scene.current?.reset()}
          >
            <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {data.reportCount > MAX_3D_REPORTS && (
        <p className="oc-help">
          {text.three.capped(MAX_3D_REPORTS, data.reportCount)}
        </p>
      )}
      <p id="oc-3d-help" className="oc-help">
        {text.three.help}
      </p>
    </div>
  );
}
