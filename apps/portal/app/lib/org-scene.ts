// The three.js scene for the org chart's 3D view. Only imported by the lazily
// loaded components/org-3d.tsx, so three.js never reaches the main bundle.
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  CubicBezierCurve3,
  DoubleSide,
  Fog,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Spherical,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { OrgChartNeighborhood, OrgChartNodeLite } from "@anvi/contracts";
import type { Orientation } from "./org-chart";
import { chartCopy as text } from "./copy/chart";

export const MAX_3D_REPORTS = 48;
const GAP = 4.4;
const NODE_W = 2.5;
const NODE_H = 0.98;

type Palette = {
  dark: boolean;
  surface: string;
  subtle: string;
  ink: string;
  muted: string;
  line: string;
  brand: string;
  brandSoft: string;
  brandInk: string;
  accent: string;
  coral: string;
};

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    dark: document.documentElement.dataset.mode === "dark",
    surface: v("--surface", "#ffffff"),
    subtle: v("--surface-subtle", "#f6f5fb"),
    ink: v("--ink", "#1f1e3d"),
    muted: v("--muted", "#5d5b7a"),
    line: v("--line", "#e3e1ef"),
    brand: v("--brand", "#3b3a9e"),
    brandSoft: v("--brand-soft", "#e9e8f8"),
    brandInk: v("--brand-ink", "#34338c"),
    accent: v("--accent", "#f4b23e"),
    coral: v("--coral", "#d9573f"),
  };
}

export type SceneCallbacks = {
  onActivate: (id: string) => void;
  onSelect: (node: OrgChartNodeLite | null) => void;
  onZoom: (percent: number) => void;
  onLost: () => void;
};

export type SceneApi = {
  setContent: (
    data: OrgChartNeighborhood,
    orientation: Orientation,
    meId: string,
    palette: Palette,
    reduced: boolean,
  ) => void;
  setReduced: (reduced: boolean) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
  key: (event: KeyboardEvent) => boolean;
  dispose: () => void;
};

type Item = {
  id: string;
  node: OrgChartNodeLite;
  sprite: Sprite;
  base: Vector3;
  role: "manager" | "focus" | "report";
};

function fitText(ctx: CanvasRenderingContext2D, value: string, max: number) {
  if (ctx.measureText(value).width <= max) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max)
    out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = '"Public Sans Variable", system-ui, sans-serif';
const DISPLAY =
  '"Bricolage Grotesque Variable", "Public Sans Variable", sans-serif';

function cardTexture(
  node: OrgChartNodeLite,
  role: Item["role"],
  isMe: boolean,
  p: Palette,
  tone: string,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 200;
  const ctx = canvas.getContext("2d")!;
  const focus = role === "focus";
  roundRect(ctx, 6, 6, 500, 188, 28);
  ctx.fillStyle = p.surface;
  ctx.fill();
  ctx.lineWidth = focus ? 7 : 3;
  ctx.strokeStyle = focus ? p.accent : tone;
  ctx.stroke();
  // Tone band on the left edge ties each card to its layer colour.
  ctx.save();
  roundRect(ctx, 6, 6, 500, 188, 28);
  ctx.clip();
  ctx.fillStyle = tone;
  ctx.fillRect(6, 6, 14, 188);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(86, 100, 48, 0, Math.PI * 2);
  ctx.fillStyle = p.brandSoft;
  ctx.fill();
  ctx.fillStyle = p.brandInk;
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(node.initials.slice(0, 2), 86, 102);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const x = 154;
  const max = 340;
  ctx.fillStyle = p.ink;
  ctx.font = `650 38px ${DISPLAY}`;
  const name = isMe ? `${node.name} (${text.node.youBadge})` : node.name;
  ctx.fillText(fitText(ctx, name, max), x, 64);
  ctx.font = `500 27px ${FONT}`;
  ctx.fillText(fitText(ctx, node.title || text.noTitle, max), x, 104);
  ctx.fillStyle = p.muted;
  ctx.font = `400 23px ${FONT}`;
  ctx.fillText(fitText(ctx, node.department || text.noDepartment, max), x, 138);
  ctx.fillStyle = p.brandInk;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(text.node.reports(node.directReportCount), x, 174);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function labelTexture(label: string, tone: string, p: Palette) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `700 34px ${FONT}`;
  const width = Math.min(600, ctx.measureText(label.toUpperCase()).width + 104);
  roundRect(ctx, 4, 12, width, 72, 36);
  ctx.fillStyle = p.surface;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 3;
  ctx.strokeStyle = tone;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(44, 48, 11, 0, Math.PI * 2);
  ctx.fillStyle = tone;
  ctx.fill();
  ctx.fillStyle = p.ink;
  ctx.textBaseline = "middle";
  ctx.fillText(label.toUpperCase(), 70, 50);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, width };
}

function glowTexture(tone: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, tone);
  gradient.addColorStop(0.55, `${tone}55`);
  gradient.addColorStop(1, `${tone}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function haloTexture(tone: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 220;
  const ctx = canvas.getContext("2d")!;
  ctx.shadowColor = tone;
  ctx.shadowBlur = 26;
  ctx.lineWidth = 8;
  ctx.strokeStyle = tone;
  roundRect(ctx, 30, 30, 452, 160, 34);
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// Safe hex for the glow gradient: CSS tokens here are plain hex colours.
const hexOr = (value: string, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

function disposeTree(root: Object3D) {
  root.traverse((object) => {
    const target = object as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    target.geometry?.dispose();
    const materials = Array.isArray(target.material)
      ? target.material
      : target.material
        ? [target.material]
        : [];
    for (const material of materials) {
      (material as Material & { map?: Texture | null }).map?.dispose();
      material.dispose();
    }
  });
}

export function createScene(
  host: HTMLElement,
  callbacks: SceneCallbacks,
): SceneApi {
  // A fresh canvas per scene: a context lost on dispose can never be reused.
  const canvas = document.createElement("canvas");
  canvas.className = "oc-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "default",
    });
  } catch (error) {
    canvas.remove();
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = true;
  controls.minDistance = 3;
  controls.maxDistance = 70;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI * 0.64;
  controls.minAzimuthAngle = -1.25;
  controls.maxAzimuthAngle = 1.25;

  let content: Group | null = null;
  let items: Item[] = [];
  let halo: Sprite | null = null;
  let selected = -1;
  let hovered = -1;
  let homePosition = new Vector3(0, 3, 12);
  let homeDistance = 12;
  let reduced = false;
  let dirty = true;
  let raf = 0;
  let running = false;
  let inView = true;
  let lastTouch = 0;
  let lastNow = 0;
  let tween: { start: number; from: Vector3; to: Vector3 } | null = null;
  let lastPercent = 100;

  const raycaster = new Raycaster();
  const pointer = new Vector2();

  function size() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  function reportZoom() {
    const distance = camera.position.distanceTo(controls.target);
    const percent = Math.round((homeDistance / Math.max(distance, 0.01)) * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      callbacks.onZoom(percent);
    }
  }

  function highlight() {
    if (!halo) return;
    const index = hovered >= 0 ? hovered : selected;
    const item = items[index];
    halo.visible = Boolean(item);
    if (item) {
      halo.position.copy(item.sprite.position);
      halo.scale.set(NODE_W * 1.16, NODE_H * 1.16 * (220 / 200), 1);
    }
    items.forEach((entry, i) => {
      const grow = i === selected || i === hovered ? 1.06 : 1;
      entry.sprite.scale.set(entry.base.x * grow, entry.base.y * grow, 1);
    });
    dirty = true;
  }

  function select(index: number) {
    selected = index;
    callbacks.onSelect(items[index]?.node ?? null);
    highlight();
  }

  function pick(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      items.map((i) => i.sprite),
      false,
    );
    const first = hits[0];
    return first ? items.findIndex((i) => i.sprite === first.object) : -1;
  }

  let down: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => {
    lastTouch = performance.now();
    down = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (!start || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6)
      return;
    const index = pick(event);
    if (index < 0) return;
    select(index);
    const hit = items[index];
    if (hit && hit.role !== "focus") callbacks.onActivate(hit.id);
  };
  const onMove = (event: PointerEvent) => {
    if (event.buttons) return;
    const index = pick(event);
    if (index !== hovered) {
      hovered = index;
      canvas.style.cursor = index >= 0 ? "pointer" : "grab";
      highlight();
    }
  };
  const onLeave = () => {
    if (hovered >= 0) {
      hovered = -1;
      highlight();
    }
  };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    callbacks.onLost();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("webglcontextlost", onContextLost);
  controls.addEventListener("start", () => (lastTouch = performance.now()));
  controls.addEventListener("change", () => {
    dirty = true;
    reportZoom();
  });

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastNow) / 1000 || 0.016);
    lastNow = now;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / 650);
      const eased = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(tween.from, tween.to, eased);
      if (t >= 1) tween = null;
      dirty = true;
    }
    // Gentle sway only when nobody is touching the chart and motion is allowed.
    const drifting = !reduced && !tween && now - lastTouch > 4000;
    if (drifting) {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(
        new Vector3(0, 1, 0),
        Math.cos((now / 1000) * 0.35) * 0.09 * dt,
      );
      camera.position.copy(controls.target).add(offset);
      dirty = true;
    }
    const moved = controls.update();
    if (moved || dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  };
  function start() {
    if (running || !inView || document.hidden) return;
    running = true;
    lastNow = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);
  const intersection =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          inView = entries.some((entry) => entry.isIntersecting);
          if (inView) start();
          else stop();
        })
      : null;
  intersection?.observe(host);
  const resizer =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
  resizer?.observe(host);
  size();

  function frameHome(box: Box3, orientation: Orientation, animate: boolean) {
    const sizeVec = box.getSize(new Vector3());
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const dist =
      Math.max(
        sizeVec.y / (2 * half),
        sizeVec.x / (2 * half * Math.max(camera.aspect, 0.4)),
      ) *
        1.12 +
      sizeVec.z / 2 +
      2;
    const direction =
      orientation === "vertical"
        ? new Vector3(0, 0.36, 1)
        : new Vector3(0.22, 0.14, 1);
    homeDistance = dist;
    homePosition = direction.normalize().multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    controls.maxDistance = dist * 3;
    controls.minDistance = Math.max(3, dist * 0.18);
    lastPercent = 100;
    if (animate && !reduced) {
      tween = {
        start: performance.now(),
        from: homePosition.clone().multiplyScalar(1.22),
        to: homePosition.clone(),
      };
      camera.position.copy(tween.from);
    } else {
      tween = null;
      camera.position.copy(homePosition);
    }
    controls.update();
    callbacks.onZoom(100);
    dirty = true;
  }

  let firstContent = true;
  return {
    setReduced(value) {
      reduced = value;
      controls.enableDamping = !value;
    },
    setContent(data, orientation, meId, p, reduceNow) {
      reduced = reduceNow;
      controls.enableDamping = !reduceNow;
      if (content) {
        scene.remove(content);
        disposeTree(content);
      }
      const group = new Group();
      content = group;
      items = [];
      selected = -1;
      hovered = -1;
      const vertical = orientation === "vertical";
      const brand = hexOr(p.brand, "#3b3a9e");
      const accent = hexOr(p.accent, "#f4b23e");
      const coral = hexOr(p.coral, "#d9573f");

      const shown = data.reports.slice(0, MAX_3D_REPORTS);
      const more = Math.max(0, data.reportCount - shown.length);
      type Layer = {
        key: "manager" | "focus" | "report";
        label: string;
        tone: string;
        people: OrgChartNodeLite[];
        chip: boolean;
      };
      const layers: Layer[] = [];
      if (data.manager)
        layers.push({
          key: "manager",
          label: text.three.layerManager,
          tone: brand,
          people: [data.manager],
          chip: false,
        });
      layers.push({
        key: "focus",
        label:
          data.focus.id === meId ? text.three.layerYou : text.three.layerFocus,
        tone: accent,
        people: [data.focus],
        chip: false,
      });
      if (shown.length || more)
        layers.push({
          key: "report",
          label: text.three.layerReports,
          tone: coral,
          people: shown,
          chip: more > 0,
        });

      const perLine = vertical ? 7 : 10;
      const spacingAcross = vertical ? 2.9 : 1.3;
      const spacingLine = vertical ? 1.5 : 2.8;
      const counts = layers.map((l) => l.people.length + (l.chip ? 1 : 0));
      const maxLine = Math.min(perLine, Math.max(...counts));
      const maxLines = Math.max(...counts.map((c) => Math.ceil(c / perLine)));
      const across = (maxLine - 1) * spacingAcross;
      const depth = (maxLines - 1) * spacingLine;
      const planeA = Math.max(
        vertical ? 7 : 4.2,
        across + (vertical ? 4.2 : 2.4),
      );
      const planeB = Math.max(4.2, depth + 3.4);

      const box = new Box3();
      layers.forEach((layer, layerIndex) => {
        const main = (layerIndex - (layers.length - 1) / 2) * GAP;
        const tone = new Color(layer.tone);
        const layerGroup = new Group();
        // The plane: flat sheets stacked top to bottom, or upright sheets
        // spread left to right.
        const fill = new Mesh(
          new PlaneGeometry(
            vertical ? planeA : planeB,
            vertical ? planeB : planeA,
          ),
          new MeshBasicMaterial({
            color: tone,
            transparent: true,
            opacity: p.dark ? 0.1 : 0.075,
            side: DoubleSide,
            depthWrite: false,
          }),
        );
        const w = vertical ? planeA : planeB;
        const h = vertical ? planeB : planeA;
        const border = new LineLoop(
          new BufferGeometry().setFromPoints([
            new Vector3(-w / 2, -h / 2, 0),
            new Vector3(w / 2, -h / 2, 0),
            new Vector3(w / 2, h / 2, 0),
            new Vector3(-w / 2, h / 2, 0),
          ]),
          new LineBasicMaterial({
            color: tone,
            transparent: true,
            opacity: p.dark ? 0.75 : 0.6,
          }),
        );
        const glow = new Mesh(
          new PlaneGeometry(w * 1.45, h * 1.45),
          new MeshBasicMaterial({
            map: glowTexture(layer.tone),
            transparent: true,
            opacity: p.dark ? 0.5 : 0.3,
            depthWrite: false,
            ...(p.dark ? { blending: AdditiveBlending } : {}),
            fog: false,
          }),
        );
        layerGroup.add(glow, fill, border);
        if (vertical) {
          layerGroup.rotation.x = -Math.PI / 2;
          layerGroup.position.y = -main;
        } else {
          layerGroup.rotation.y = Math.PI / 2;
          layerGroup.position.x = main;
        }
        group.add(layerGroup);

        // Layer name tag at the near corner.
        const { texture: tag } = labelTexture(layer.label, layer.tone, p);
        const tagSprite = new Sprite(
          new SpriteMaterial({
            map: tag,
            transparent: true,
            depthWrite: false,
            fog: false,
          }),
        );
        const tagScale = 0.0042;
        tagSprite.scale.set(640 * tagScale, 96 * tagScale, 1);
        tagSprite.center.set(0, 0.5);
        if (vertical)
          tagSprite.position.set(-planeA / 2, -main + 0.12, planeB / 2 + 0.2);
        else tagSprite.position.set(main, planeA / 2 + 0.5, -planeB / 2);
        group.add(tagSprite);

        // People on this layer.
        const total = layer.people.length + (layer.chip ? 1 : 0);
        const lines = Math.ceil(total / perLine);
        for (let i = 0; i < total; i++) {
          const line = Math.floor(i / perLine);
          const inLine = Math.min(perLine, total - line * perLine);
          const col = i % perLine;
          const lineOffset = (line - (lines - 1) / 2) * spacingLine;
          const acrossOffset = (col - (inLine - 1) / 2) * spacingAcross;
          const pos = vertical
            ? new Vector3(acrossOffset, -main + 0.72, lineOffset)
            : new Vector3(main, -acrossOffset, lineOffset);
          const person = layer.people[i];
          let texture: CanvasTexture;
          if (person) {
            texture = cardTexture(
              person,
              layer.key,
              person.id === meId,
              p,
              layer.tone,
            );
          } else {
            const canvasEl = document.createElement("canvas");
            canvasEl.width = 512;
            canvasEl.height = 200;
            const ctx = canvasEl.getContext("2d")!;
            roundRect(ctx, 6, 6, 500, 188, 28);
            ctx.setLineDash([14, 12]);
            ctx.lineWidth = 3;
            ctx.strokeStyle = layer.tone;
            ctx.stroke();
            ctx.fillStyle = p.ink;
            ctx.font = `600 30px ${FONT}`;
            ctx.textAlign = "center";
            ctx.fillText(`+${more}`, 256, 96);
            ctx.fillStyle = p.muted;
            ctx.font = `400 22px ${FONT}`;
            ctx.fillText(
              fitText(ctx, text.three.more(more).replace(/^\+\d+ /, ""), 440),
              256,
              138,
            );
            texture = new CanvasTexture(canvasEl);
            texture.colorSpace = SRGBColorSpace;
          }
          const sprite = new Sprite(
            new SpriteMaterial({
              map: texture,
              transparent: true,
              depthWrite: false,
              fog: false,
            }),
          );
          sprite.position.copy(pos);
          sprite.scale.set(NODE_W, NODE_H, 1);
          sprite.renderOrder = 3;
          group.add(sprite);
          box.expandByPoint(
            pos.clone().add(new Vector3(NODE_W / 2, NODE_H / 2, 0)),
          );
          box.expandByPoint(
            pos.clone().sub(new Vector3(NODE_W / 2, NODE_H / 2, 0)),
          );
          if (person)
            items.push({
              id: person.id,
              node: person,
              sprite,
              base: new Vector3(NODE_W, NODE_H, 1),
              role: layer.key,
            });
        }
        box.expandByPoint(
          new Vector3(
            vertical ? planeA / 2 : main + 1,
            vertical ? -main - 0.5 : planeA / 2,
            planeB / 2,
          ),
        );
        box.expandByPoint(
          new Vector3(
            vertical ? -planeA / 2 : main - 1,
            vertical ? -main + 1.5 : -planeA / 2,
            -planeB / 2,
          ),
        );
      });

      // Soft curves from each layer to the next.
      const byId = new Map(items.map((i) => [i.id, i]));
      const connect = (from: Item, to: Item, tone: string) => {
        const a = from.sprite.position.clone();
        const b = to.sprite.position.clone();
        if (vertical) {
          a.y -= NODE_H / 2;
          b.y += NODE_H / 2;
        } else {
          a.x += NODE_W / 2;
          b.x -= NODE_W / 2;
        }
        const c1 = a
          .clone()
          .add(vertical ? new Vector3(0, -1.7, 0) : new Vector3(1.9, 0, 0));
        const c2 = b
          .clone()
          .add(vertical ? new Vector3(0, 1.7, 0) : new Vector3(-1.9, 0, 0));
        const curve = new CubicBezierCurve3(a, c1, c2, b);
        const tube = new Mesh(
          new TubeGeometry(curve, 28, 0.016, 6, false),
          new MeshBasicMaterial({
            color: new Color(tone),
            transparent: true,
            opacity: p.dark ? 0.7 : 0.55,
            fog: false,
          }),
        );
        group.add(tube);
      };
      const focusItem = byId.get(data.focus.id);
      if (focusItem) {
        if (data.manager) {
          const m = byId.get(data.manager.id);
          if (m) connect(m, focusItem, brand);
        }
        for (const item of items) {
          if (item.role === "report") connect(focusItem, item, coral);
        }
      }

      // Selection halo, shared by hover and keyboard selection.
      halo = new Sprite(
        new SpriteMaterial({
          map: haloTexture(accent),
          transparent: true,
          depthWrite: false,
          fog: false,
        }),
      );
      halo.renderOrder = 2;
      halo.visible = false;
      group.add(halo);

      scene.add(group);
      const centre = box.getCenter(new Vector3());
      group.position.sub(centre);
      box.translate(centre.clone().negate());
      frameHome(box, orientation, !firstContent);
      scene.fog = new Fog(
        new Color(p.subtle),
        homeDistance * 1.05,
        homeDistance * 3.4,
      );
      firstContent = false;
      const focusIndex = items.findIndex((i) => i.role === "focus");
      select(focusIndex);
      renderer.render(scene, camera);
    },
    zoomBy(factor) {
      lastTouch = performance.now();
      const offset = camera.position.clone().sub(controls.target);
      const length = Math.min(
        controls.maxDistance,
        Math.max(controls.minDistance, offset.length() / factor),
      );
      offset.setLength(length);
      camera.position.copy(controls.target).add(offset);
      tween = null;
      controls.update();
      reportZoom();
      dirty = true;
    },
    reset() {
      lastTouch = performance.now();
      controls.target.set(0, 0, 0);
      if (reduced) {
        camera.position.copy(homePosition);
        tween = null;
      } else {
        tween = {
          start: performance.now(),
          from: camera.position.clone(),
          to: homePosition.clone(),
        };
      }
      controls.update();
      reportZoom();
      dirty = true;
    },
    key(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      lastTouch = performance.now();
      const api = this as SceneApi;
      switch (event.key) {
        case "+":
        case "=":
          api.zoomBy(1.25);
          return true;
        case "-":
        case "_":
          api.zoomBy(0.8);
          return true;
        case "0":
          api.reset();
          return true;
        case "[":
        case "]": {
          if (!items.length) return true;
          const step = event.key === "]" ? 1 : -1;
          select((selected + step + items.length) % items.length);
          return true;
        }
        case "Enter": {
          const item = items[selected];
          if (item && item.role !== "focus") callbacks.onActivate(item.id);
          return Boolean(item);
        }
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          tween = null;
          camera.updateMatrixWorld();
          if (event.shiftKey) {
            const right = new Vector3().setFromMatrixColumn(camera.matrix, 0);
            const up = new Vector3().setFromMatrixColumn(camera.matrix, 1);
            const step = homeDistance * 0.06;
            const move = new Vector3();
            if (event.key === "ArrowLeft") move.addScaledVector(right, -step);
            if (event.key === "ArrowRight") move.addScaledVector(right, step);
            if (event.key === "ArrowUp") move.addScaledVector(up, step);
            if (event.key === "ArrowDown") move.addScaledVector(up, -step);
            camera.position.add(move);
            controls.target.add(move);
          } else {
            const offset = camera.position.clone().sub(controls.target);
            const sph = new Spherical().setFromVector3(offset);
            if (event.key === "ArrowLeft") sph.theta += 0.15;
            if (event.key === "ArrowRight") sph.theta -= 0.15;
            if (event.key === "ArrowUp") sph.phi -= 0.1;
            if (event.key === "ArrowDown") sph.phi += 0.1;
            sph.phi = Math.min(
              controls.maxPolarAngle,
              Math.max(controls.minPolarAngle, sph.phi),
            );
            offset.setFromSpherical(sph);
            camera.position.copy(controls.target).add(offset);
          }
          controls.update();
          dirty = true;
          return true;
        }
        default:
          return false;
      }
    },
    dispose() {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      intersection?.disconnect();
      resizer?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      controls.dispose();
      if (content) {
        scene.remove(content);
        disposeTree(content);
      }
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
