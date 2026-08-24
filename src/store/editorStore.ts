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
  sceneStarts,
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
  addTimelineAssetClip: (type: Extract<TimelineClipType, "image" | "video">, asset: { id: string; name: string }, startFrame: number, durationInFrames: number, trackId?: string) => void;
  updateTimelineAssetClip: (clipId: string, patch: { startFrame?: number; durationInFrames?: number; sourceStartFrame?: number; x?: number; y?: number; scale?: number; opacity?: number; crop?: "fit" | "fill" | "stretch" }) => void;
  deleteTimelineAssetClip: (clipId: string, ripple?: boolean) => void;
  splitTimelineAssetClip: (clipId: string, frame: number) => void;
  duplicateTimelineAssetClip: (clipId: string) => void;
  addTimelineTrack: (type: "video" | "audio") => void;
  updateTimelineTrack: (trackId: string, patch: { name?: string; locked?: boolean; visible?: boolean; muted?: boolean; solo?: boolean; volume?: number }) => void;
  reorderTimelineTrack: (trackId: string, direction: -1 | 1) => void;
  duplicateTimelineTrack: (trackId: string) => void;
  deleteTimelineTrack: (trackId: string) => void;
  setCompositionDuration: (durationInFrames: number) => void;
  setWorkArea: (patch: { enabled?: boolean; startFrame?: number; endFrame?: number }) => void;
  fitCompositionToContent: () => void;
  undo: () => void;
  redo: () => void;
  persist: () => Promise<void>;
};

const initialVideoProject = createDefaultVideoProject();
const activeComposition = (video: VideoProject) =>
  video.scenes.find((scene) => scene.id === video.activeSceneId)?.composition ??
  video.scenes[0]?.composition ?? createDefaultProject();
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
      if (!videoProject.scenes.length) { set({ videoProject, masterFrame: 0, currentFrame: 0, playing: false, hydrated: true, saveStatus: "saved" }); return; }
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
      if (!state.videoProject.scenes.length) return { masterFrame: Math.round(clamp(frame, 0, state.videoProject.canvas.durationInFrames - 1)), currentFrame: 0 };
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
      if (!state.videoProject.scenes.length) {
        const rangeEnd = state.videoProject.workArea.enabled ? state.videoProject.workArea.endFrame : state.videoProject.canvas.durationInFrames,
          next = state.masterFrame + 1;
        return next >= rangeEnd ? { masterFrame: state.videoProject.workArea.enabled ? state.videoProject.workArea.startFrame : 0, currentFrame: 0, playing: false } : { masterFrame: next, currentFrame: 0 };
      }
      if (state.playbackScope === "master") {
        const current = resolveMasterFrame(
            state.videoProject,
            state.masterFrame,
          ),
          nextFrame = state.masterFrame + 1;
        const rangeStart = state.videoProject.workArea.enabled ? state.videoProject.workArea.startFrame : 0,
          rangeEnd = state.videoProject.workArea.enabled ? state.videoProject.workArea.endFrame : current.totalFrames;
        if (nextFrame >= rangeEnd) {
          const first = resolveMasterFrame(state.videoProject, rangeStart),
            videoProject = produce(state.videoProject, (draft) => {
              draft.activeSceneId = first.scene.id;
            });
          return {
            masterFrame: rangeStart,
            currentFrame: first.localFrame,
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
      if (!state.videoProject.scenes.length) {
        const start = state.videoProject.workArea.enabled ? state.videoProject.workArea.startFrame : 0, end = state.videoProject.workArea.enabled ? state.videoProject.workArea.endFrame : state.videoProject.canvas.durationInFrames;
        return { playing: true, masterFrame: state.masterFrame < start || state.masterFrame >= end - 1 ? start : state.masterFrame, currentFrame: 0 };
      }
      if (state.playbackScope === "master") {
        const current = resolveMasterFrame(
          state.videoProject,
          state.masterFrame,
        );
        const start = state.videoProject.workArea.enabled ? state.videoProject.workArea.startFrame : 0, end = state.videoProject.workArea.enabled ? state.videoProject.workArea.endFrame : current.totalFrames;
        if (state.masterFrame < start || state.masterFrame >= end - 1) {
          const first = resolveMasterFrame(state.videoProject, start),
            videoProject = produce(state.videoProject, (draft) => {
              draft.activeSceneId = first.scene.id;
            });
          return {
            playing: true,
            masterFrame: start,
            currentFrame: first.localFrame,
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
      const index = state.videoProject.scenes.findIndex(
        (scene) => scene.id === sceneId,
      );
      if (index < 0) return state;
      const now = new Date().toISOString(),
        videoProject = produce(state.videoProject, (draft) => {
          draft.scenes.splice(index, 1);
          normalizeSceneOrder(draft.scenes);
          if (!draft.scenes.length) draft.activeSceneId = "";
          else if (draft.activeSceneId === sceneId)
            draft.activeSceneId =
              draft.scenes[Math.min(index, draft.scenes.length - 1)].id;
          draft.updatedAt = now;
        });
      return {
        past: [...state.past.slice(-49), state.videoProject],
        future: [],
        videoProject,
        project: videoProject.scenes.length ? activeComposition(videoProject) : state.project,
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
          draft.canvas.durationInFrames = Math.max(draft.canvas.durationInFrames, clip.startFrame + clip.durationInFrames);
          draft.updatedAt = now;
        });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  updateAudioClip: (trackId, clipId, patch) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const clip = draft.audioTracks.find((track) => track.id === trackId)?.clips.find((item) => item.id === clipId);
        if (clip) { Object.assign(clip, patch); clip.startFrame = Math.max(0, Math.round(clip.startFrame)); clip.durationInFrames = Math.max(1, Math.round(clip.durationInFrames)); draft.canvas.durationInFrames = Math.max(draft.canvas.durationInFrames, clip.startFrame + clip.durationInFrames); }
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
        totalFrames = state.videoProject.canvas.durationInFrames,
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
        if (overlay) { Object.assign(overlay, patch); overlay.startFrame = Math.max(0, Math.round(overlay.startFrame)); overlay.durationInFrames = Math.max(1, Math.round(overlay.durationInFrames)); draft.canvas.durationInFrames = Math.max(draft.canvas.durationInFrames, overlay.startFrame + overlay.durationInFrames); }
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
    if (!videoProject.scenes.length) { set({ videoProject, masterFrame: 0, currentFrame: 0, playing: false, past: [], future: [], saveStatus: "saved" }); return; }
    const resolved = resolveMasterFrame(videoProject, 0);
    set({ videoProject, project: resolved.scene.composition, currentFrame: resolved.localFrame, masterFrame: 0, playing: false, selectedLayerId: "phone", past: [], future: [], saveStatus: "saved" });
  },
  createVideoProject: () => {
    const videoProject = produce(createDefaultVideoProject(), (draft) => { draft.scenes = []; draft.activeSceneId = ""; draft.timelineTracks = buildUnifiedTimelineTracks([], draft.audioTracks, [], draft.timelineTracks); });
    set({ videoProject, currentFrame: 0, masterFrame: 0, playing: false, selectedLayerId: "phone", past: [], future: [], saveStatus: "unsaved" });
  },
  addSceneFromTemplate: (composition) =>
    set((state) => {
      const now = new Date().toISOString(), sceneId = crypto.randomUUID(), cloned = structuredClone(composition);
      cloned.id = crypto.randomUUID(); cloned.createdAt = now; cloned.updatedAt = now;
      const videoProject = produce(state.videoProject, (draft) => {
        draft.scenes.push({ id: sceneId, name: cloned.name, order: draft.scenes.length, sourceStartFrame: 0, durationInFrames: cloned.canvas.durationInFrames, transitionToNext: { type: "cut", durationInFrames: 15 }, thumbnailDataUrl: cloned.thumbnailDataUrl, composition: cloned, createdAt: now, updatedAt: now });
        draft.activeSceneId = sceneId; draft.timelineTracks = buildUnifiedTimelineTracks(draft.scenes, draft.audioTracks, draft.globalOverlays, draft.timelineTracks); draft.canvas.durationInFrames = Math.max(draft.canvas.durationInFrames, sceneStarts(draft).totalFrames); draft.updatedAt = now;
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, project: cloned, currentFrame: 0, masterFrame: sceneMasterStart(videoProject, sceneId), playing: false, selectedLayerId: "phone", saveStatus: "unsaved" };
    }),
  insertSceneFromTemplate: (composition, targetIndex) =>
    set((state) => {
      const now = new Date().toISOString(), sceneId = crypto.randomUUID(), cloned = structuredClone(composition), index = Math.round(clamp(targetIndex, 0, state.videoProject.scenes.length));
      cloned.id = crypto.randomUUID(); cloned.createdAt = now; cloned.updatedAt = now;
      const videoProject = produce(state.videoProject, (draft) => {
        draft.scenes.splice(index, 0, { id: sceneId, name: cloned.name, order: index, sourceStartFrame: 0, durationInFrames: cloned.canvas.durationInFrames, transitionToNext: { type: "cut", durationInFrames: 15 }, thumbnailDataUrl: cloned.thumbnailDataUrl, composition: cloned, createdAt: now, updatedAt: now });
        normalizeSceneOrder(draft.scenes); draft.activeSceneId = sceneId; draft.timelineTracks = buildUnifiedTimelineTracks(draft.scenes, draft.audioTracks, draft.globalOverlays, draft.timelineTracks); draft.canvas.durationInFrames = Math.max(draft.canvas.durationInFrames, sceneStarts(draft).totalFrames); draft.updatedAt = now;
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, project: cloned, currentFrame: 0, masterFrame: sceneMasterStart(videoProject, sceneId), playing: false, selectedLayerId: "phone", saveStatus: "unsaved" };
    }),
  addTimelineAssetClip: (type, asset, startFrame, durationInFrames, trackId) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        draft.timelineTracks = buildUnifiedTimelineTracks(draft.scenes, draft.audioTracks, draft.globalOverlays, draft.timelineTracks);
        const track = draft.timelineTracks.find((item) => item.id === trackId && item.type === "video") ?? draft.timelineTracks.find((item) => item.type === "video");
        if (!track || track.locked) return;
        const duration = Math.max(1, Math.round(durationInFrames));
        let available = Math.max(0, Math.round(startFrame));
        for (const clip of [...track.clips].sort((a, b) => a.startFrame - b.startFrame)) if (available < clip.startFrame + clip.durationInFrames && available + duration > clip.startFrame) available = clip.startFrame + clip.durationInFrames;
        track.clips.push({ id: crypto.randomUUID(), type, name: asset.name, startFrame: available, durationInFrames: duration, sourceStartFrame: 0, referenceType: "asset", referenceId: asset.id, assetId: asset.id, x: 50, y: 50, scale: 1, opacity: 1, crop: "fit" });
        const oldDuration = draft.canvas.durationInFrames; draft.canvas.durationInFrames = Math.max(oldDuration, available + duration); if (draft.workArea.endFrame === oldDuration) draft.workArea.endFrame = draft.canvas.durationInFrames;
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  updateTimelineAssetClip: (clipId, patch) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => { const clip = draft.timelineTracks.flatMap((track) => track.clips).find((item) => item.id === clipId && item.referenceType === "asset"); if (clip) { Object.assign(clip, patch); clip.sourceStartFrame = Math.max(0, Math.round(clip.sourceStartFrame)); clip.durationInFrames = Math.max(1, Math.round(clip.durationInFrames)); clip.startFrame = Math.max(0, Math.round(clip.startFrame)); clip.x = clamp(clip.x, 0, 100); clip.y = clamp(clip.y, 0, 100); clip.scale = clamp(clip.scale, .05, 10); clip.opacity = clamp(clip.opacity, 0, 1); const oldDuration = draft.canvas.durationInFrames; draft.canvas.durationInFrames = Math.max(oldDuration, clip.startFrame + clip.durationInFrames); if (draft.workArea.endFrame === oldDuration) draft.workArea.endFrame = draft.canvas.durationInFrames; } draft.updatedAt = new Date().toISOString(); });
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
  addTimelineTrack: (type) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        if (type === "audio") {
          const id = crypto.randomUUID(), count = draft.audioTracks.length + 1;
          draft.audioTracks.push({ id, name: `Audio ${count}`, type: "music", muted: false, volume: 1, clips: [] });
          draft.timelineTracks.push({ id: `master-audio:${id}`, type: "audio", name: `Audio ${count}`, order: draft.timelineTracks.length, locked: false, muted: false, visible: true, opacity: 1, solo: false, volume: 1, clips: [] });
          draft.updatedAt = new Date().toISOString();
          return;
        }
        const count = draft.timelineTracks.filter((track) => track.type === type).length + 1;
        draft.timelineTracks.push({ id: crypto.randomUUID(), type, name: `${type === "video" ? "Video" : "Audio"} ${count}`, order: draft.timelineTracks.length, locked: false, muted: false, visible: true, opacity: 1, solo: false, volume: 1, clips: [] });
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  updateTimelineTrack: (trackId, patch) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const track = draft.timelineTracks.find((item) => item.id === trackId);
        if (track) Object.assign(track, patch, { volume: patch.volume === undefined ? track.volume : clamp(patch.volume, 0, 2) });
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  reorderTimelineTrack: (trackId, direction) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const ordered = draft.timelineTracks.sort((a, b) => a.order - b.order), index = ordered.findIndex((track) => track.id === trackId), target = index + direction;
        if (index >= 0 && target >= 0 && target < ordered.length) [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        ordered.forEach((track, order) => { track.order = order; });
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  duplicateTimelineTrack: (trackId) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const source = draft.timelineTracks.find((track) => track.id === trackId);
        if (source) draft.timelineTracks.push({ ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} Copy`, order: draft.timelineTracks.length, clips: source.clips.map((clip) => ({ ...clip, id: crypto.randomUUID() })) });
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  deleteTimelineTrack: (trackId) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        draft.timelineTracks = draft.timelineTracks.filter((track) => track.id !== trackId);
        draft.timelineTracks.forEach((track, order) => { track.order = order; });
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  setCompositionDuration: (durationInFrames) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const contentEnd = Math.max(1, ...draft.timelineTracks.flatMap((track) => track.clips.map((clip) => clip.startFrame + clip.durationInFrames)), ...draft.audioTracks.flatMap((track) => track.clips.map((clip) => clip.startFrame + clip.durationInFrames)), ...draft.globalOverlays.map((overlay) => overlay.startFrame + overlay.durationInFrames));
        draft.canvas.durationInFrames = Math.max(contentEnd, Math.round(durationInFrames), 1);
        draft.workArea.startFrame = Math.min(draft.workArea.startFrame, draft.canvas.durationInFrames - 1);
        draft.workArea.endFrame = Math.min(Math.max(draft.workArea.startFrame + 1, draft.workArea.endFrame), draft.canvas.durationInFrames);
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  setWorkArea: (patch) =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        const start = Math.round(clamp(patch.startFrame ?? draft.workArea.startFrame, 0, draft.canvas.durationInFrames - 1));
        const end = Math.round(clamp(patch.endFrame ?? draft.workArea.endFrame, start + 1, draft.canvas.durationInFrames));
        draft.workArea = { enabled: patch.enabled ?? draft.workArea.enabled, startFrame: start, endFrame: end };
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, saveStatus: "unsaved" };
    }),
  fitCompositionToContent: () =>
    set((state) => {
      const videoProject = produce(state.videoProject, (draft) => {
        draft.canvas.durationInFrames = Math.max(1, ...draft.timelineTracks.flatMap((track) => track.clips.map((clip) => clip.startFrame + clip.durationInFrames)), ...draft.audioTracks.flatMap((track) => track.clips.map((clip) => clip.startFrame + clip.durationInFrames)), ...draft.globalOverlays.map((overlay) => overlay.startFrame + overlay.durationInFrames));
        draft.workArea.startFrame = Math.min(draft.workArea.startFrame, draft.canvas.durationInFrames - 1);
        draft.workArea.endFrame = draft.canvas.durationInFrames;
        draft.updatedAt = new Date().toISOString();
      });
      return { past: [...state.past.slice(-49), state.videoProject], future: [], videoProject, masterFrame: Math.min(state.masterFrame, videoProject.canvas.durationInFrames - 1), saveStatus: "unsaved" };
    }),
  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        videoProject: previous,
        project: previous.scenes.length ? activeComposition(previous) : state.project,
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
        project: next.scenes.length ? activeComposition(next) : state.project,
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
