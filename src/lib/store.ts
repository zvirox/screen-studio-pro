import { create } from "zustand";

/* lib/store.ts — Zustand UI-state wiring (ARCHITECTURE §2 tree).
   Task 0.4 seeds only the nav view id; recording/event state joins in 0.6+. */

export type ViewId = "record" | "library" | "settings";

interface UiState {
  view: ViewId;
  setView: (view: ViewId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "record",
  setView: (view) => set({ view }),
}));
