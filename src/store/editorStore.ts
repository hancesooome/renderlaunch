import { create } from "zustand";
import { produce } from "immer";
import {
  createDefaultProject,
  createDefaultVideoProject,
} from "../project/defaults";
import type {
  TemplateProject,
  VideoProject,
  VideoScene,
} from "../project/schema";
import { loadRecentProject, saveProject } from "../persistence/database";
import { clamp } from "../animation/frame";

type SaveStatus = "loading" | "saved" | "unsaved" | "saving" | "error";
type ProjectRecipe = (draft: TemplateProject) => void;
export type TransformMode = "translate" | "rotate" | "scale";
export type PlaybackScope = "master" | "scene";

type EditorState = {
  project: TemplateProject;
  videoProject: VideoProject;
  currentFrame: number;
  masterFrame: number;
  playing: boolean;
  playbackScope: PlaybackScope;
  selectedLayerId: string;
  activeTool: string;
  zoom: number;
  preview: boolean;
  transformMode: TransformMode;
  autoKey: boolean;
  hydrated: boolean;
  saveStatus: SaveStatus;
  past: VideoProject[];
  future: VideoProject[];
  hydrate: () => Promise<void>;
  updateProject: (recipe: ProjectRecipe) => void;
  setFrame: (frame: number) => void;
  setMasterFrame: (frame: number) => void;
  advanceFrame: () => void;
  setPlaybackScope: (scope: PlaybackScope) => void;
  setPlaying: (playing: boolean) => void;
  setSelectedLayer: (id: string) => void;
  setActiveTool: (tool: string) => void;
  setZoom: (zoom: number) => void;
  setPreview: (preview: boolean) => void;
  setTransformMode: (mode: TransformMode) => void;
  setAutoKey: (enabled: boolean) => void;
  addScene: (name?: string) => void;
  duplicateScene: (sceneId?: string) => void;
  deleteScene: (sceneId: string) => void;
  selectScene: (sceneId: string) => void;
  renameScene: (sceneId: string, name: string) => void;
  reorderScene: (sceneId: string, targetIndex: number) => void;
  trimScene: (
    sceneId: string,
    sourceStartFrame: number,
    durationInFrames: number,
  ) => void;
  splitScene: (sceneId: string, offsetFrame: number) => void;
  undo: () => void;
  redo: () => void;
  persist: () => Promise<void>;
};

const initialVideoProject = createDefaultVideoProject();
const activeComposition = (video: VideoProject) =>
  video.scenes.find((scene) => scene.id === video.activeSceneId)?.composition ??
  video.scenes[0].composition;
const normalizeSceneOrder = (scenes: VideoScene[]) =>
  scenes.forEach((scene, order) => {
    scene.order = order;
  });
const clipDuration = (scene: VideoScene) =>
  Number.isFinite(scene.durationInFrames)
    ? scene.durationInFrames
    : scene.composition.canvas.durationInFrames;
const orderedScenes = (video: VideoProject) =>
  [...video.scenes].sort((a, b) => a.order - b.order);
const sceneMasterStart = (video: VideoProject, sceneId: string) => {
  let start = 0;
  for (const scene of orderedScenes(video)) {
    if (scene.id === sceneId) return start;
    start += clipDuration(scene);
  }
  return 0;
};
const resolveMasterFrame = (video: VideoProject, requestedFrame: number) => {
  const scenes = orderedScenes(video),
    totalFrames = scenes.reduce((sum, scene) => sum + clipDuration(scene), 0),
    frame = Math.round(clamp(requestedFrame, 0, Math.max(0, totalFrames - 1)));
  let start = 0;
  for (const scene of scenes) {
    const duration = clipDuration(scene);
    if (frame < start + duration || scene === scenes[scenes.length - 1])
      return {
        scene,
        localFrame: Math.round(clamp(frame - start, 0, duration - 1)),
        masterFrame: frame,
        totalFrames,
      };
    start += duration;
  }
  return { scene: scenes[0], localFrame: 0, masterFrame: 0, totalFrames };
};

export const useEditorStore = create<EditorState>((set, get) => ({
  videoProject: initialVideoProject,
  project: activeComposition(initialVideoProject),
  currentFrame: 126,
  masterFrame: 126,
  playing: false,
  playbackScope: "master",
  selectedLayerId: "phone",
  activeTool: "Model",
  zoom: 77,
  preview: false,
  transformMode: "translate",
  autoKey: false,
  hydrated: false,
  saveStatus: "loading",
  past: [],
  future: [],
  hydrate: async () => {
    try {
      const restored = await loadRecentProject();
      const videoProject = restored ?? get().videoProject;
      const resolved = resolveMasterFrame(videoProject, get().masterFrame);
      set({
        videoProject,
        project: resolved.scene.composition,
        currentFrame: resolved.localFrame,
        masterFrame: resolved.masterFrame,
        hydrated: true,
        saveStatus: "saved",
      });
    } catch {
      set({ hydrated: true, saveStatus: "error" });
    }
  },
  updateProject: (recipe) =>
    set((state) => {
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          const scene = draft.scenes.find(
            (item) => item.id === draft.activeSceneId,
          )!;
          recipe(scene.composition);
          scene.composition.updatedAt = now;
          scene.name = scene.composition.name;
          scene.thumbnailDataUrl = scene.composition.thumbnailDataUrl;
          scene.updatedAt = now;
          if (draft.scenes.length === 1) draft.name = scene.composition.name;
          if (scene.thumbnailDataUrl)
            draft.thumbnailDataUrl = scene.thumbnailDataUrl;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        saveStatus: "unsaved",
        videoProject,
        project: activeComposition(videoProject),
      };
    }),
  setFrame: (frame) =>
    set((state) => ({
      currentFrame: Math.round(
        clamp(frame, 0, state.project.canvas.durationInFrames - 1),
      ),
    })),
  setMasterFrame: (frame) =>
    set((state) => {
      const resolved = resolveMasterFrame(state.videoProject, frame),
        videoProject =
          resolved.scene.id === state.videoProject.activeSceneId
            ? state.videoProject
            : produce(state.videoProject, (draft) => {
                draft.activeSceneId = resolved.scene.id;
              });
      return {
        masterFrame: resolved.masterFrame,
        currentFrame: resolved.localFrame,
        videoProject,
        project: resolved.scene.composition,
        selectedLayerId:
          resolved.scene.id === state.videoProject.activeSceneId
            ? state.selectedLayerId
            : "phone",
      };
    }),
  advanceFrame: () =>
    set((state) => {
      if (state.playbackScope === "master") {
        const current = resolveMasterFrame(
            state.videoProject,
            state.masterFrame,
          ),
          nextFrame = state.masterFrame + 1;
        if (nextFrame >= current.totalFrames) {
          const first = resolveMasterFrame(state.videoProject, 0),
            videoProject = produce(state.videoProject, (draft) => {
              draft.activeSceneId = first.scene.id;
            });
          return {
            masterFrame: 0,
            currentFrame: 0,
            playing: false,
            videoProject,
            project: first.scene.composition,
            selectedLayerId: "phone",
          };
        }
        const next = resolveMasterFrame(state.videoProject, nextFrame),
          changedScene = next.scene.id !== state.videoProject.activeSceneId,
          videoProject = changedScene
            ? produce(state.videoProject, (draft) => {
                draft.activeSceneId = next.scene.id;
              })
            : state.videoProject;
        return {
          masterFrame: next.masterFrame,
          currentFrame: next.localFrame,
          videoProject,
          project: next.scene.composition,
          selectedLayerId: changedScene ? "phone" : state.selectedLayerId,
        };
      }
      const next = state.currentFrame + 1;
      return next >= state.project.canvas.durationInFrames
        ? { currentFrame: 0, playing: false }
        : { currentFrame: next };
    }),
  setPlaybackScope: (playbackScope) => set({ playbackScope }),
  setPlaying: (playing) =>
    set((state) => {
      if (!playing) return { playing: false };
      if (state.playbackScope === "master") {
        const current = resolveMasterFrame(
          state.videoProject,
          state.masterFrame,
        );
        if (state.masterFrame >= current.totalFrames - 1) {
          const first = resolveMasterFrame(state.videoProject, 0),
            videoProject = produce(state.videoProject, (draft) => {
              draft.activeSceneId = first.scene.id;
            });
          return {
            playing: true,
            masterFrame: 0,
            currentFrame: 0,
            videoProject,
            project: first.scene.composition,
            selectedLayerId: "phone",
          };
        }
      } else if (
        state.currentFrame >=
        state.project.canvas.durationInFrames - 1
      )
        return { playing: true, currentFrame: 0 };
      return { playing: true };
    }),
  setSelectedLayer: (selectedLayerId) => set({ selectedLayerId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setZoom: (zoom) => set({ zoom: clamp(zoom, 30, 150) }),
  setPreview: (preview) => set({ preview }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setAutoKey: (autoKey) => set({ autoKey }),
  addScene: (name) =>
    set((state) => {
      const now = new Date().toISOString(),
        composition = createDefaultProject(),
        sceneId = crypto.randomUUID(),
        videoProject = produce(state.videoProject, (draft) => {
          const sceneNumber = draft.scenes.length + 1;
          composition.name = name?.trim() || `Scene ${sceneNumber}`;
          draft.scenes.push({
            id: sceneId,
            name: composition.name,
            order: draft.scenes.length,
            sourceStartFrame: 0,
            durationInFrames: composition.canvas.durationInFrames,
            composition,
            createdAt: now,
            updatedAt: now,
          });
          draft.activeSceneId = sceneId;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: activeComposition(videoProject),
        masterFrame: sceneMasterStart(videoProject, sceneId),
        currentFrame: 0,
        playing: false,
        selectedLayerId: "phone",
        saveStatus: "unsaved",
      };
    }),
  duplicateScene: (sceneId) =>
    set((state) => {
      const source = state.videoProject.scenes.find(
        (scene) => scene.id === (sceneId ?? state.videoProject.activeSceneId),
      );
      if (!source) return state;
      const now = new Date().toISOString(),
        copyId = crypto.randomUUID(),
        videoProject = produce(state.videoProject, (draft) => {
          const sourceIndex = draft.scenes.findIndex(
              (scene) => scene.id === source.id,
            ),
            composition = structuredClone(source.composition);
          composition.id = crypto.randomUUID();
          composition.name = `${source.name} Copy`;
          composition.createdAt = now;
          composition.updatedAt = now;
          draft.scenes.splice(sourceIndex + 1, 0, {
            id: copyId,
            name: composition.name,
            order: sourceIndex + 1,
            sourceStartFrame: source.sourceStartFrame,
            durationInFrames: source.durationInFrames,
            thumbnailDataUrl: source.thumbnailDataUrl,
            composition,
            createdAt: now,
            updatedAt: now,
          });
          normalizeSceneOrder(draft.scenes);
          draft.activeSceneId = copyId;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: activeComposition(videoProject),
        masterFrame: sceneMasterStart(videoProject, copyId),
        currentFrame: 0,
        playing: false,
        selectedLayerId: "phone",
        saveStatus: "unsaved",
      };
    }),
  deleteScene: (sceneId) =>
    set((state) => {
      if (state.videoProject.scenes.length <= 1) return state;
      const index = state.videoProject.scenes.findIndex(
        (scene) => scene.id === sceneId,
      );
      if (index < 0) return state;
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          draft.scenes.splice(index, 1);
          normalizeSceneOrder(draft.scenes);
          if (draft.activeSceneId === sceneId)
            draft.activeSceneId =
              draft.scenes[Math.min(index, draft.scenes.length - 1)].id;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: activeComposition(videoProject),
        masterFrame: sceneMasterStart(videoProject, videoProject.activeSceneId),
        currentFrame: 0,
        playing: false,
        selectedLayerId: "phone",
        saveStatus: "unsaved",
      };
    }),
  selectScene: (sceneId) =>
    set((state) => {
      if (!state.videoProject.scenes.some((scene) => scene.id === sceneId))
        return state;
      const videoProject = produce(state.videoProject, (draft) => {
        draft.activeSceneId = sceneId;
      });
      return {
        videoProject,
        project: activeComposition(videoProject),
        masterFrame: sceneMasterStart(videoProject, sceneId),
        currentFrame: 0,
        playing: false,
        selectedLayerId: "phone",
      };
    }),
  renameScene: (sceneId, name) =>
    set((state) => {
      const nextName = name.trim();
      if (!nextName) return state;
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          const scene = draft.scenes.find((item) => item.id === sceneId);
          if (!scene) return;
          scene.name = nextName;
          scene.composition.name = nextName;
          scene.updatedAt = now;
          scene.composition.updatedAt = now;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: activeComposition(videoProject),
        masterFrame:
          sceneMasterStart(videoProject, videoProject.activeSceneId) +
          state.currentFrame,
        saveStatus: "unsaved",
      };
    }),
  reorderScene: (sceneId, targetIndex) =>
    set((state) => {
      const sourceIndex = state.videoProject.scenes.findIndex(
        (scene) => scene.id === sceneId,
      );
      if (sourceIndex < 0) return state;
      const boundedTarget = clamp(
        Math.round(targetIndex),
        0,
        state.videoProject.scenes.length - 1,
      );
      if (sourceIndex === boundedTarget) return state;
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          const [scene] = draft.scenes.splice(sourceIndex, 1);
          draft.scenes.splice(boundedTarget, 0, scene);
          normalizeSceneOrder(draft.scenes);
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: activeComposition(videoProject),
        saveStatus: "unsaved",
      };
    }),
  trimScene: (sceneId, sourceStartFrame, durationInFrames) =>
    set((state) => {
      const scene = state.videoProject.scenes.find(
        (item) => item.id === sceneId,
      );
      if (!scene) return state;
      const sourceDuration = scene.composition.canvas.durationInFrames,
        start = Math.round(clamp(sourceStartFrame, 0, sourceDuration - 1)),
        duration = Math.round(
          clamp(durationInFrames, 1, sourceDuration - start),
        );
      if (
        start === scene.sourceStartFrame &&
        duration === scene.durationInFrames
      )
        return state;
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          const item = draft.scenes.find((value) => value.id === sceneId)!;
          item.sourceStartFrame = start;
          item.durationInFrames = duration;
          item.updatedAt = now;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: activeComposition(videoProject),
        masterFrame:
          sceneMasterStart(videoProject, videoProject.activeSceneId) +
          Math.min(state.currentFrame, duration - 1),
        currentFrame: Math.min(state.currentFrame, duration - 1),
        saveStatus: "unsaved",
      };
    }),
  splitScene: (sceneId, offsetFrame) =>
    set((state) => {
      const sourceIndex = state.videoProject.scenes.findIndex(
          (scene) => scene.id === sceneId,
        ),
        source = state.videoProject.scenes[sourceIndex];
      if (!source) return state;
      const sourceStartFrame = Number.isFinite(source.sourceStartFrame)
          ? source.sourceStartFrame
          : 0,
        sourceDuration = Number.isFinite(source.durationInFrames)
          ? source.durationInFrames
          : source.composition.canvas.durationInFrames,
        split = Math.round(offsetFrame);
      if (!Number.isFinite(split) || split <= 0 || split >= sourceDuration)
        return state;
      const now = new Date().toISOString(),
        secondId = crypto.randomUUID(),
        secondComposition = structuredClone(source.composition),
        videoProject = produce(state.videoProject, (draft) => {
          const first = draft.scenes[sourceIndex];
          secondComposition.id = crypto.randomUUID();
          secondComposition.name = `${first.name} Part 2`;
          secondComposition.createdAt = now;
          secondComposition.updatedAt = now;
          first.sourceStartFrame = sourceStartFrame;
          first.durationInFrames = split;
          first.updatedAt = now;
          draft.scenes.splice(sourceIndex + 1, 0, {
            id: secondId,
            name: secondComposition.name,
            order: sourceIndex + 1,
            sourceStartFrame: sourceStartFrame + split,
            durationInFrames: sourceDuration - split,
            thumbnailDataUrl: first.thumbnailDataUrl,
            composition: secondComposition,
            createdAt: now,
            updatedAt: now,
          });
          normalizeSceneOrder(draft.scenes);
          draft.activeSceneId = secondId;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: activeComposition(videoProject),
        masterFrame: sceneMasterStart(videoProject, secondId),
        currentFrame: 0,
        playing: false,
        selectedLayerId: "phone",
        saveStatus: "unsaved",
      };
    }),
  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        videoProject: previous,
        project: activeComposition(previous),
        past: state.past.slice(0, -1),
        future: [state.videoProject, ...state.future],
        saveStatus: "unsaved",
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        videoProject: next,
        project: activeComposition(next),
        past: [...state.past, state.videoProject],
        future: state.future.slice(1),
        saveStatus: "unsaved",
      };
    }),
  persist: async () => {
    set({ saveStatus: "saving" });
    try {
      await saveProject(get().videoProject);
      set({ saveStatus: "saved" });
    } catch {
      set({ saveStatus: "error" });
    }
  },
}));
