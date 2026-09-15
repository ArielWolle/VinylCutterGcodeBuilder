import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorTool, FlattenedPath, FrameSettings, SvgItem } from "../types";
import { flattenSvgGeometry, parseSvgMetadata } from "../lib/svgFlatten";
import { defaultTransform } from "../lib/geometryTransform";

// Raw SVG text per item id, kept outside the reactive store (it's only needed to (re)run the
// background geometry flatten, never for rendering) plus in-flight flatten promises so multiple
// callers (e.g. clicking "Generate G-code" while a background flatten is still running) can all
// await the same work instead of triggering it twice.
const rawSvgById = new Map<string, string>();
const pendingFlattens = new Map<string, Promise<void>>();

interface MeasurePoints {
  a: { x: number; y: number } | null;
  b: { x: number; y: number } | null;
}

interface ViewState {
  pixelsPerMm: number;
  panX: number;
  panY: number;
}

interface DesignState {
  frame: FrameSettings;
  items: SvgItem[];
  selectedId: string | null;
  tool: EditorTool;
  view: ViewState;
  measure: MeasurePoints;
  /** True while an SVG import is being parsed/sampled (see lib/svgFlatten.ts). */
  importing: boolean;

  setFrame: (frame: Partial<FrameSettings>) => void;
  setTool: (tool: EditorTool) => void;
  setView: (view: Partial<ViewState>) => void;

  importSvgFile: (file: File) => Promise<string>;
  /** Resolves once the item's cut/draw geometry has been flattened in the background (see
   *  lib/svgFlatten.ts). Safe to call any number of times / concurrently for the same item. */
  ensureItemGeometry: (id: string) => Promise<void>;
  removeItem: (id: string) => void;
  selectItem: (id: string | null) => void;
  updateTransform: (id: string, transform: Partial<SvgItem["transform"]>) => void;
  setItemVisible: (id: string, visible: boolean) => void;
  setItemLocked: (id: string, locked: boolean) => void;
  reorderItem: (id: string, direction: "up" | "down") => void;
  renameItem: (id: string, name: string) => void;

  setMeasurePoint: (which: "a" | "b", point: { x: number; y: number } | null) => void;
  clearMeasure: () => void;
}

function centerTransformFor(item: Pick<SvgItem, "naturalWidthMm" | "naturalHeightMm">, frame: FrameSettings) {
  const t = defaultTransform();
  t.x = Math.max(0, (frame.widthMm - item.naturalWidthMm) / 2);
  t.y = Math.max(0, (frame.heightMm - item.naturalHeightMm) / 2);
  return t;
}

export const useDesignStore = create<DesignState>()(
  persist(
    (set, get) => ({
  frame: { widthMm: 640, heightMm: 300 },
  items: [],
  selectedId: null,
  tool: "select",
  view: { pixelsPerMm: 2.2, panX: 40, panY: 40 },
  measure: { a: null, b: null },
  importing: false,

  setFrame: (frame) => set((s) => ({ frame: { ...s.frame, ...frame } })),
  setTool: (tool) => set({ tool, measure: { a: null, b: null } }),
  setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),

  importSvgFile: async (file: File) => {
    set({ importing: true });
    try {
      const id = crypto.randomUUID();
      const text = await file.text();
      // Fast, synchronous metadata-only parse (size/viewBox/markup) - no geometry sampling, so
      // this is effectively instant even for very complex files. The item is draggable/resizable
      // immediately, rendered as the real native SVG; actual cut/draw geometry is flattened
      // separately in the background (kicked off below) without blocking the import at all.
      const meta = parseSvgMetadata(text, id);
      rawSvgById.set(id, text);

      const item: SvgItem = {
        id,
        name: file.name.replace(/\.svg$/i, ""),
        naturalWidthMm: meta.naturalWidthMm,
        naturalHeightMm: meta.naturalHeightMm,
        transform: centerTransformFor(meta, get().frame),
        viewBox: meta.viewBox,
        innerSvgHTML: meta.innerSvgHTML,
        paths: null,
        visible: true,
        locked: false,
      };
      set((s) => ({ items: [...s.items, item], selectedId: id }));

      // Fire-and-forget: start the background flatten now so it's typically already done by the
      // time the user gets around to generating G-code, without making them wait for it here.
      void get().ensureItemGeometry(id);

      return id;
    } finally {
      set({ importing: false });
    }
  },

  ensureItemGeometry: async (id: string) => {
    const existing = pendingFlattens.get(id);
    if (existing) return existing;

    const item = get().items.find((i) => i.id === id);
    if (!item || item.paths) return;

    const rawSvg = rawSvgById.get(id);
    if (!rawSvg) return;

    const promise = (async () => {
      let paths: FlattenedPath[] = [];
      try {
        paths = await flattenSvgGeometry(rawSvg, item.naturalWidthMm, item.naturalHeightMm);
      } catch (err) {
        console.error("Failed to flatten SVG geometry for cutting:", err);
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, paths } : i)) }));
        pendingFlattens.delete(id);
        return;
      }

      // The SVG's declared canvas (width/height/viewBox) often includes extra margin beyond the
      // actual artwork - crop the item's bounding box down to the true content bbox now that we
      // know it, so the box the user drags/resizes on the design canvas always matches exactly
      // what gets cut, instead of the design view and G-code preview disagreeing on where the
      // words sit. The native SVG's viewBox is re-cropped to the same region so both stay in
      // sync, and the position is compensated so the artwork doesn't visually jump.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of paths) {
        for (const [x, y] of p.points) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }

      set((s) => {
        const current = s.items.find((i) => i.id === id);
        if (!current || !Number.isFinite(minX)) {
          return { items: s.items.map((i) => (i.id === id ? { ...i, paths } : i)) };
        }

        const oldW = current.naturalWidthMm;
        const oldH = current.naturalHeightMm;
        const vb = current.viewBox;
        const mmPerUnitX = vb.w > 0 ? oldW / vb.w : 1;
        const mmPerUnitY = vb.h > 0 ? oldH / vb.h : 1;

        const naturalWidthMm = Math.max(maxX - minX, 0.01);
        const naturalHeightMm = Math.max(maxY - minY, 0.01);

        const viewBox = {
          x: minX / mmPerUnitX + vb.x,
          y: (oldH - maxY) / mmPerUnitY + vb.y,
          w: naturalWidthMm / mmPerUnitX,
          h: naturalHeightMm / mmPerUnitY,
        };

        const shiftedPaths: FlattenedPath[] = paths.map((p) => ({
          closed: p.closed,
          points: p.points.map(([x, y]) => [x - minX, y - minY] as [number, number]),
        }));

        // Position compensation assumes rotation 0 (the normal case immediately after import);
        // world = x + lx*scaleX at rotation 0, so shifting the local origin by (minX,minY) needs
        // the same shift applied to x/y, scaled, to keep the artwork's on-screen position fixed.
        const { scaleX, scaleY } = current.transform;
        const x = current.transform.x + minX * scaleX;
        const y = current.transform.y + minY * scaleY;

        return {
          items: s.items.map((i) =>
            i.id === id
              ? {
                  ...i,
                  naturalWidthMm,
                  naturalHeightMm,
                  viewBox,
                  paths: shiftedPaths,
                  transform: { ...i.transform, x, y },
                }
              : i
          ),
        };
      });
      pendingFlattens.delete(id);
    })();

    pendingFlattens.set(id, promise);
    return promise;
  },

  removeItem: (id) => {
    rawSvgById.delete(id);
    pendingFlattens.delete(id);
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

  selectItem: (id) => set({ selectedId: id }),

  updateTransform: (id, transform) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, transform: { ...i.transform, ...transform } } : i)),
    })),

  setItemVisible: (id, visible) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, visible } : i)) })),

  setItemLocked: (id, locked) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, locked } : i)) })),

  reorderItem: (id, direction) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === id);
      if (idx < 0) return s;
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= s.items.length) return s;
      const items = [...s.items];
      [items[idx], items[swapWith]] = [items[swapWith], items[idx]];
      return { items };
    }),

  renameItem: (id, name) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, name } : i)) })),

  setMeasurePoint: (which, point) =>
    set((s) => ({ measure: { ...s.measure, [which]: point } })),
  clearMeasure: () => set({ measure: { a: null, b: null } }),
    }),
    {
      name: "vcgb-design-state",
      // Only the cutting frame size survives reloads - the design canvas itself (items,
      // selection, etc.) is treated as ephemeral per-session state.
      partialize: (state) => ({ frame: state.frame }),
    }
  )
);
