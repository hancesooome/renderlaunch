import { create } from "zustand";
import { produce } from "immer";
import { createDefaultProject } from "../project/defaults";
import type { TemplateProject } from "../project/schema";
import { loadRecentProject, saveProject } from "../persistence/database";
import { clamp } from "../animation/frame";

type SaveStatus = "loading" | "saved" | "unsaved" | "saving" | "error";
type ProjectRecipe = (draft: TemplateProject) => void;
export type TransformMode = "translate" | "rotate" | "scale";

type EditorState = {
  project: TemplateProject;
  currentFrame: number;
  playing: boolean;
  selectedLayerId: string;
  activeTool: string;
  zoom: number;
  preview: boolean;
  transformMode: TransformMode;
  hydrated: boolean;
  saveStatus: SaveStatus;
  past: TemplateProject[];
  future: TemplateProject[];
  hydrate: () => Promise<void>;
  updateProject: (recipe: ProjectRecipe) => void;
  setFrame: (frame: number) => void;
  advanceFrame: () => void;
  setPlaying: (playing: boolean) => void;
  setSelectedLayer: (id: string) => void;
  setActiveTool: (tool: string) => void;
  setZoom: (zoom: number) => void;
  setPreview: (preview: boolean) => void;
  setTransformMode: (mode: TransformMode) => void;
  undo: () => void;
  redo: () => void;
  persist: () => Promise<void>;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  project: createDefaultProject(),
  currentFrame: 126,
  playing: false,
  selectedLayerId: "phone",
  activeTool: "Model",
  zoom: 77,
  preview: false,
  transformMode: "translate",
  hydrated: false,
  saveStatus: "loading",
  past: [],
  future: [],
  hydrate: async () => {
    try {
      const restored = await loadRecentProject();
      set({
        project: restored ?? get().project,
        hydrated: true,
        saveStatus: "saved",
      });
    } catch {
      set({ hydrated: true, saveStatus: "error" });
    }
  },
  updateProject: (recipe) =>
    set((state) => ({
      past: [...state.past.slice(-49), state.project],
      future: [],
      saveStatus: "unsaved",
      project: produce(state.project, (draft) => {
        recipe(draft);
        draft.updatedAt = new Date().toISOString();
      }),
    })),
  setFrame: (frame) =>
    set((state) => ({
      currentFrame: Math.round(
        clamp(frame, 0, state.project.canvas.durationInFrames - 1),
      ),
    })),
  advanceFrame: () =>
    set((state) => {
      const next = state.currentFrame + 1;
      return next >= state.project.canvas.durationInFrames
        ? { currentFrame: 0, playing: false }
        : { currentFrame: next };
    }),
  setPlaying: (playing) => set({ playing }),
  setSelectedLayer: (selectedLayerId) => set({ selectedLayerId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setZoom: (zoom) => set({ zoom: clamp(zoom, 30, 150) }),
  setPreview: (preview) => set({ preview }),
  setTransformMode: (transformMode) => set({ transformMode }),
  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future],
        saveStatus: "unsaved",
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        project: next,
        past: [...state.past, state.project],
        future: state.future.slice(1),
        saveStatus: "unsaved",
      };
    }),
  persist: async () => {
    set({ saveStatus: "saving" });
    try {
      await saveProject(get().project);
      set({ saveStatus: "saved" });
    } catch {
      set({ saveStatus: "error" });
    }
  },
}));
