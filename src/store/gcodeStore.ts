import { create } from "zustand";
import type { GcodeResult } from "../lib/gcode";

interface GcodeState {
  result: GcodeResult | null;
  setResult: (result: GcodeResult | null) => void;
}

export const useGcodeStore = create<GcodeState>((set) => ({
  result: null,
  setResult: (result) => set({ result }),
}));
