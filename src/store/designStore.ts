import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorTool, FrameSettings, SvgItem } from "../types";
import { parseSvgToPaths } from "../lib/svgFlatten";
import { defaultTransform } from "../lib/geometryTransform";

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
  frame: { widthMm: 300, heightMm: 300 },
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
    // Let the browser paint the "Importing..." state before the heavy synchronous SVG
    // sampling work begins, otherwise it can start before React ever gets a frame to render it.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const text = await file.text();
      const parsed = await parseSvgToPaths(text);
      const id = crypto.randomUUID();
      const item: SvgItem = {
        id,
        name: file.name.replace(/\.svg$/i, ""),
        naturalWidthMm: parsed.naturalWidthMm,
        naturalHeightMm: parsed.naturalHeightMm,
        transform: centerTransformFor(parsed, get().frame),
        paths: parsed.paths,
        visible: true,
        locked: false,
      };
      set((s) => ({ items: [...s.items, item], selectedId: id }));
      return id;
    } finally {
      set({ importing: false });
    }
  },

  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

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
