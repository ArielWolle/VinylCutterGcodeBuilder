import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MachineSettings } from "../types";

interface MachineState {
  settings: MachineSettings;
  updateSettings: (partial: Partial<MachineSettings>) => void;
  resetDefaults: () => void;
}

export const defaultMachineSettings: MachineSettings = {
  cutMode: "cut",

  feedRateCutMmMin: 800,
  feedRateTravelMmMin: 3000,

  headActuation: "spindle",
  zUp: 5,
  zDown: 0,
  safeZ: 10,
  spindleOnCode: "M03",
  spindleOffCode: "M05",

  // Off by default: this is a drag-knife swivel/overcut feature and should be an explicit
  // opt-in once you've measured your actual blade, not a silent default that can introduce
  // corner artifacts on cuts that never asked for it.
  toolDiameterMm: 0,
  overcutMm: 0,
  optimizeToolpath: true,

  passes: 1,
  passHeightDeltaMm: 0,

  originOffsetX: 0,
  originOffsetY: 0,
  invertY: false,
  // M05 first so the spindle/blade is guaranteed off before homing or any other startup motion
  // (matters most for headActuation === "spindle", but is a harmless no-op otherwise).
  startGcode: "M05\nG21\nG90\nG28",
  endGcode: "M05\nG0 X0 Y0",
  decimals: 3,
};

export const useMachineStore = create<MachineState>()(
  persist(
    (set) => ({
      settings: defaultMachineSettings,
      updateSettings: (partial) => set((s) => ({ settings: { ...s.settings, ...partial } })),
      resetDefaults: () => set({ settings: defaultMachineSettings }),
    }),
    { name: "vcgb-machine-settings" }
  )
);
