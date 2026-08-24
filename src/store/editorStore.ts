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
  SceneTransitionType,
  AudioClip,
  GlobalOverlay,
  GlobalOverlayType,
  TimelineClipType,
} from "../project/schema";
import { buildUnifiedTimelineTracks, defaultAudioTracks } from "../project/schema";
import { loadRecentProject, saveProject } from "../persistence/database";
import { clamp } from "../animation/frame";
import {
  orderedScenes,
  resolveMasterFrame,
  sceneMasterStart,
} from "../video/timeline";

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
  setSceneTransition: (
    sceneId: string,
    type: SceneTransitionType,
    durationInFrames: number,
  ) => void;
  addAudioClip: (trackId: string, clip: AudioClip) => void;
  updateAudioClip: (trackId: string, clipId: string, patch: Partial<AudioClip>) => void;
  deleteAudioClip: (trackId: string, clipId: string) => void;
  setAudioTrackMuted: (trackId: string, muted: boolean) => void;
  setAudioTrackVolume: (trackId: string, volume: number) => void;
  addGlobalOverlay: (type: GlobalOverlayType, startFrame: number) => void;
  updateGlobalOverlay: (overlayId: string, patch: Partial<GlobalOverlay>) => void;
  deleteGlobalOverlay: (overlayId: string) => void;
  openVideoProject: (videoProject: VideoProject) => void;
  createVideoProject: () => void;
  addSceneFromTemplate: (composition: TemplateProject) => void;
  insertSceneFromTemplate: (composition: TemplateProject, targetIndex: number) => void;
  addTimelineAssetClip: (type: Extract<TimelineClipType, "image" | "video">, asset: { id: string; name: string }, startFrame: number, durationInFrames: number) => void;
  updateTimelineAssetClip: (clipId: string, patch: { startFrame?: number; durationInFrames?: number; sourceStartFrame?: number; x?: number; y?: number; scale?: number; opacity?: number; crop?: "fit" | "fill" | "stretch" }) => void;
  deleteTimelineAssetClip: (clipId: string, ripple?: boolean) => void;
  splitTimelineAssetClip: (clipId: string, frame: number) => void;
  duplicateTimelineAssetClip: (clipId: string) => void;
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
            transitionToNext: { type: "cut", durationInFrames: 15 },
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
            transitionToNext: source.transitionToNext ?? {
              type: "cut",
              durationInFrames: 15,
            },
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
          const originalTransition = first.transitionToNext ?? {
            type: "cut",
            durationInFrames: 15,
          };
          first.transitionToNext = { type: "cut", durationInFrames: 15 };
          first.updatedAt = now;
          draft.scenes.splice(sourceIndex + 1, 0, {
            id: secondId,
            name: secondComposition.name,
            order: sourceIndex + 1,
            sourceStartFrame: sourceStartFrame + split,
            durationInFrames: sourceDuration - split,
            transitionToNext: originalTransition,
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
  setSceneTransition: (sceneId, type, durationInFrames) =>
    set((state) => {
      const scene = state.videoProject.scenes.find(
        (item) => item.id === sceneId,
      );
      if (!scene) return state;
      const duration = Math.round(clamp(durationInFrames, 1, 90));
      if (
        scene.transitionToNext?.type === type &&
        scene.transitionToNext?.durationInFrames === duration
      )
        return state;
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          const item = draft.scenes.find((value) => value.id === sceneId)!;
          item.transitionToNext = { type, durationInFrames: duration };
          item.updatedAt = now;
          draft.updatedAt = now;
        }),
        resolved = resolveMasterFrame(videoProject, state.masterFrame);
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: resolved.scene.composition,
        currentFrame: resolved.localFrame,
        masterFrame: resolved.masterFrame,
        saveStatus: "unsaved",
      };
    }),
  addAudioClip: (trackId, clip) =>
    set((state) => {
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          if (!draft.audioTracks.length) draft.audioTracks = defaultAudioTracks();
          draft.audioTracks.find((track) => track.id === trackId)?.clips.push(clip);
          draft.updatedAt = now;
        });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  updateAudioClip: (trackId, clipId, patch) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const clip = draft.audioTracks.find((track) => track.id === trackId)?.clips.find((item) => item.id === clipId);
        if (clip) Object.assign(clip, patch);
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  deleteAudioClip: (trackId, clipId) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const track = draft.audioTracks.find((item) => item.id === trackId);
        if (track) track.clips = track.clips.filter((clip) => clip.id !== clipId);
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  setAudioTrackMuted: (trackId, muted) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const track = draft.audioTracks.find((item) => item.id === trackId);
        if (track) track.muted = muted;
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  setAudioTrackVolume: (trackId, volume) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const track = draft.audioTracks.find((item) => item.id === trackId);
        if (track) track.volume = clamp(volume, 0, 2);
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  addGlobalOverlay: (type, startFrame) =>
    set((state) => {
      const labels: Record<GlobalOverlayType, string> = { title: "Opening Title", caption: "Caption", cta: "Call to Action", logo: "Logo", watermark: "Watermark" },
        text: Record<GlobalOverlayType, string> = { title: "Your launch starts here", caption: "A clear supporting message", cta: "Get started today", logo: "", watermark: "" },
        totalFrames = orderedScenes(state.videoProject).reduce((sum, scene) => sum + scene.durationInFrames, 0),
        overlay: GlobalOverlay = {
          id: crypto.randomUUID(), type, name: labels[type], startFrame: Math.round(clamp(startFrame, 0, Math.max(0, totalFrames - 1))),
          durationInFrames: Math.max(1, Math.min(type === "caption" ? 90 : 150, totalFrames - Math.round(clamp(startFrame, 0, Math.max(0, totalFrames - 1))))),
          x: 50, y: type === "caption" || type === "cta" ? 82 : type === "watermark" ? 10 : 50,
          width: type === "logo" || type === "watermark" ? 18 : 70, content: text[type],
          fontSize: type === "title" ? 64 : type === "caption" ? 30 : 36, fontWeight: type === "caption" ? 500 : 700,
          color: "#ffffff", backgroundColor: type === "caption" || type === "cta" ? "#111827cc" : "transparent",
          opacity: type === "watermark" ? 0.55 : 1, textAlign: "center", fontFamily: "Inter, system-ui, sans-serif", animation: "none",
        },
        videoProject = produce(state.videoProject, (draft) => { draft.globalOverlays.push(overlay); draft.updatedAt = new Date().toISOString(); });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  updateGlobalOverlay: (overlayId, patch) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const overlay = draft.globalOverlays.find((item) => item.id === overlayId);
        if (overlay) Object.assign(overlay, patch);
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  deleteGlobalOverlay: (overlayId) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => { draft.globalOverlays = draft.globalOverlays.filter((item) => item.id !== overlayId); draft.updatedAt = new Date().toISOString(); });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  openVideoProject: (videoProject) => {
    const resolved = resolveMasterFrame(videoProject, 0);
    set({ videoProject, project: resolved.scene.composition, currentFrame: resolved.localFrame, masterFrame: 0, playing: false, selectedLayerId: "phone", past: [], future: [], saveStatus: "saved" });
  },
  createVideoProject: () => {
    const videoProject = createDefaultVideoProject(), resolved = resolveMasterFrame(videoProject, 0);
    set({ videoProject, project: resolved.scene.composition, currentFrame: 0, masterFrame: 0, playing: false, selectedLayerId: "phone", past: [], future: [], saveStatus: "unsaved" });
  },
  addSceneFromTemplate: (composition) =>
    set((state) => {
      const now = new Date().toISOString(), sceneId = crypto.randomUUID(), cloned = structuredClone(composition);
      cloned.id = crypto.randomUUID(); cloned.createdAt = now; cloned.updatedAt = now;
      const videoProject = produce(state.videoProject, (draft) => {
        draft.scenes.push({ id: sceneId, name: cloned.name, order: draft.scenes.length, sourceStartFrame: 0, durationInFrames: cloned.canvas.durationInFrames, transitionToNext: { type: "cut", durationInFrames: 15 }, thumbnailDataUrl: cloned.thumbnailDataUrl, composition: cloned, createdAt: now, updatedAt: now });
        draft.activeSceneId = sceneId; draft.updatedAt = now;
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, project: cloned, currentFrame: 0, masterFrame: sceneMasterStart(videoProject, sceneId), playing: false, selectedLayerId: "phone", saveStatus: "unsaved" };
    }),
  insertSceneFromTemplate: (composition, targetIndex) =>
    set((state) => {
      const now = new Date().toISOString(), sceneId = crypto.randomUUID(), cloned = structuredClone(composition), index = Math.round(clamp(targetIndex, 0, state.videoProject.scenes.length));
      cloned.id = crypto.randomUUID(); cloned.createdAt = now; cloned.updatedAt = now;
      const videoProject = produce(state.videoProject, (draft) => {
        draft.scenes.splice(index, 0, { id: sceneId, name: cloned.name, order: index, sourceStartFrame: 0, durationInFrames: cloned.canvas.durationInFrames, transitionToNext: { type: "cut", durationInFrames: 15 }, thumbnailDataUrl: cloned.thumbnailDataUrl, composition: cloned, createdAt: now, updatedAt: now });
        normalizeSceneOrder(draft.scenes); draft.activeSceneId = sceneId; draft.timelineTracks = buildUnifiedTimelineTracks(draft.scenes, draft.audioTracks, draft.globalOverlays, draft.timelineTracks); draft.updatedAt = now;
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, project: cloned, currentFrame: 0, masterFrame: sceneMasterStart(videoProject, sceneId), playing: false, selectedLayerId: "phone", saveStatus: "unsaved" };
    }),
  addTimelineAssetClip: (type, asset, startFrame, durationInFrames) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        draft.timelineTracks = buildUnifiedTimelineTracks(draft.scenes, draft.audioTracks, draft.globalOverlays, draft.timelineTracks);
        const track = draft.timelineTracks.find((item) => item.type === type)!;
        const duration = Math.max(1, Math.round(durationInFrames)), total = resolveMasterFrame(draft, Number.MAX_SAFE_INTEGER).totalFrames;
        let available = Math.round(clamp(startFrame, 0, Math.max(0, total - duration)));
        for (const clip of [...track.clips].sort((a, b) => a.startFrame - b.startFrame)) if (available < clip.startFrame + clip.durationInFrames && available + duration > clip.startFrame) available = clip.startFrame + clip.durationInFrames;
        available = Math.round(clamp(available, 0, Math.max(0, total - duration)));
        track.clips.push({ id: crypto.randomUUID(), type, name: asset.name, startFrame: available, durationInFrames: Math.min(duration, total - available), sourceStartFrame: 0, referenceType: "asset", referenceId: asset.id, assetId: asset.id, x: 50, y: 50, scale: 1, opacity: 1, crop: "fit" });
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  updateTimelineAssetClip: (clipId, patch) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => { const total = resolveMasterFrame(draft, Number.MAX_SAFE_INTEGER).totalFrames, clip = draft.timelineTracks.flatMap((track) => track.clips).find((item) => item.id === clipId && item.referenceType === "asset"); if (clip) { Object.assign(clip, patch); clip.sourceStartFrame = Math.max(0, Math.round(clip.sourceStartFrame)); clip.durationInFrames = Math.max(1, Math.round(clip.durationInFrames)); clip.startFrame = Math.round(clamp(clip.startFrame, 0, Math.max(0, total - clip.durationInFrames))); clip.x = clamp(clip.x, 0, 100); clip.y = clamp(clip.y, 0, 100); clip.scale = clamp(clip.scale, .05, 10); clip.opacity = clamp(clip.opacity, 0, 1); } draft.updatedAt = new Date().toISOString(); });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  deleteTimelineAssetClip: (clipId, ripple = false) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => { draft.timelineTracks.forEach((track) => { const removed = track.clips.find((clip) => clip.id === clipId && clip.referenceType === "asset"); if (!removed) return; track.clips = track.clips.filter((clip) => clip.id !== clipId); if (ripple) track.clips.forEach((clip) => { if (clip.startFrame >= removed.startFrame + removed.durationInFrames) clip.startFrame = Math.max(0, clip.startFrame - removed.durationInFrames); }); }); draft.updatedAt = new Date().toISOString(); });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  splitTimelineAssetClip: (clipId, frame) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => { for (const track of draft.timelineTracks) { const clip = track.clips.find((item) => item.id === clipId && item.referenceType === "asset"); if (!clip) continue; const offset = Math.round(frame - clip.startFrame); if (offset <= 0 || offset >= clip.durationInFrames) break; const originalDuration = clip.durationInFrames; clip.durationInFrames = offset; track.clips.push({ ...clip, id: crypto.randomUUID(), name: `${clip.name} Split`, startFrame: clip.startFrame + offset, sourceStartFrame: clip.sourceStartFrame + offset, durationInFrames: originalDuration - offset }); break; } draft.updatedAt = new Date().toISOString(); });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  duplicateTimelineAssetClip: (clipId) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => { const total = resolveMasterFrame(draft, Number.MAX_SAFE_INTEGER).totalFrames; for (const track of draft.timelineTracks) { const clip = track.clips.find((item) => item.id === clipId && item.referenceType === "asset"); if (!clip) continue; let start = Math.min(total - clip.durationInFrames, clip.startFrame + clip.durationInFrames); while (track.clips.some((item) => start < item.startFrame + item.durationInFrames && start + clip.durationInFrames > item.startFrame) && start < total - clip.durationInFrames) start += 5; track.clips.push({ ...clip, id: crypto.randomUUID(), name: `${clip.name} Copy`, startFrame: Math.max(0, start) }); break; } draft.updatedAt = new Date().toISOString(); });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
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
      const synchronized = produce(get().videoProject, (draft) => {
        draft.timelineTracks = buildUnifiedTimelineTracks(draft.scenes, draft.audioTracks, draft.globalOverlays, draft.timelineTracks);
      });
      await saveProject(synchronized);
      set({ videoProject: synchronized, saveStatus: "saved" });
    } catch {
      set({ saveStatus: "error" });
    }
  },
}));
