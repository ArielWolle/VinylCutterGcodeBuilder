import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface FramePreset {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

interface FramePresetsState {
  presets: FramePreset[];
  /** Saves (or overwrites, by name) a named cutting-frame size preset in the browser. */
  savePreset: (name: string, widthMm: number, heightMm: number) => void;
  deletePreset: (id: string) => void;
}

export const useFramePresetsStore = create<FramePresetsState>()(
  persist(
    (set) => ({
      presets: [],
      savePreset: (name, widthMm, heightMm) =>
        set((s) => {
          const existingIdx = s.presets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
          const preset: FramePreset = {
            id: existingIdx >= 0 ? s.presets[existingIdx].id : crypto.randomUUID(),
            name,
            widthMm,
            heightMm,
          };
          const presets =
            existingIdx >= 0 ? s.presets.map((p, i) => (i === existingIdx ? preset : p)) : [...s.presets, preset];
          return { presets };
        }),
      deletePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    { name: "vcgb-frame-presets" }
  )
);
