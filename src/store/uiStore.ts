import { create } from "zustand";

export type MainView = "design" | "gcode";

interface UiState {
  mainView: MainView;
  setMainView: (view: MainView) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mainView: "design",
  setMainView: (mainView) => set({ mainView }),
}));
