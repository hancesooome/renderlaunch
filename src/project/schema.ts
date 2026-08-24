import { z } from "zod";

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
export const textAnimationPresetSchema = z.enum([
  "none",
  "fade",
  "slide-up",
  "scale",
  "typewriter",
]);
export const textCursorStyleSchema = z.enum(["none", "line", "block"]);
export const sceneTransitionTypeSchema = z.enum([
  "cut",
  "crossfade",
  "fade-black",
  "slide",
  "zoom",
  "blur",
]);
export const audioTrackTypeSchema = z.enum(["music", "voiceover", "sfx"]);
export const globalOverlayTypeSchema = z.enum(["title", "caption", "cta", "logo", "watermark"]);

export const keyframeEasingSchema = z.enum([
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "custom-bezier",
]);

export const numericKeyframePropertySchema = z.enum([
  "device.position.x",
  "device.position.y",
  "device.position.z",
  "device.rotation.x",
  "device.rotation.y",
  "device.rotation.z",
  "device.scale",
  "camera.position.x",
  "camera.position.y",
  "camera.position.z",
  "camera.target.x",
  "camera.target.y",
  "camera.target.z",
  "camera.fov",
  "overlay.position.x",
  "overlay.position.y",
  "overlay.width",
  "overlay.height",
  "overlay.rotation",
  "overlay.opacity",
  "text.fontSize",
  "text.letterSpacing",
  "overlay3d.position.x",
  "overlay3d.position.y",
  "overlay3d.position.z",
  "overlay3d.rotation.x",
  "overlay3d.rotation.y",
  "overlay3d.rotation.z",
  "overlay3d.scale",
  "lighting.environmentIntensity",
  "lighting.keyIntensity",
  "lighting.keyPosition.x",
  "lighting.keyPosition.y",
  "lighting.keyPosition.z",
  "lighting.fillIntensity",
  "lighting.shadowOpacity",
  "lighting.shadowSoftness",
  "background.angle",
  "screen.opacity",
  "screen.offset.x",
  "screen.offset.y",
  "screen.scale.x",
  "screen.scale.y",
  "screen.playbackOffset",
]);

export const colorKeyframePropertySchema = z.enum([
  "overlay.color",
  "lighting.keyColor",
  "background.colorA",
  "background.colorB",
]);

const keyframeMetadata = {
  id: z.string().min(1),
  frame: z.number().int().nonnegative(),
  interpolation: z.enum(["linear", "hold", "bezier"]).default("linear"),
  easing: keyframeEasingSchema.default("linear"),
  bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
};

export const numericKeyframeSchema = z.object({
  ...keyframeMetadata,
  value: z.number().finite(),
});

export const colorKeyframeSchema = z.object({
  ...keyframeMetadata,
  value: z.string().min(1),
});

export const keyframeTrackSchema = z.discriminatedUnion("valueType", [
  z.object({
    id: z.string().min(1),
    targetId: z.string().min(1),
    valueType: z.literal("number"),
    property: numericKeyframePropertySchema,
    enabled: z.boolean().default(true),
    keyframes: z.array(numericKeyframeSchema).default([]),
  }),
  z.object({
    id: z.string().min(1),
    targetId: z.string().min(1),
    valueType: z.literal("color"),
    property: colorKeyframePropertySchema,
    enabled: z.boolean().default(true),
    keyframes: z.array(colorKeyframeSchema).default([]),
  }),
]);

export const layerSchema = z.object({
  id: z.string(),
  type: z.enum([
    "camera",
    "lighting",
    "device",
    "screen-media",
    "text",
    "image",
    "background",
  ]),
  name: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  visible: z.boolean(),
  locked: z.boolean(),
  replaceable: z.boolean().default(false),
  zIndex: z.number().int(),
  color: z.string(),
  content: z.string().optional(),
  transform2D: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
      rotation: z.number(),
      opacity: z.number().min(0).max(1),
    })
    .default({
      x: 120,
      y: 110,
      width: 420,
      height: 120,
      rotation: 0,
      opacity: 1,
    }),
  is3D: z.boolean().default(false),
  transform3D: z
    .object({
      position: vector3,
      rotation: vector3,
      scale: z.number().positive(),
    })
    .default({
      position: [0, 0, 1],
      rotation: [0, 0, 0],
      scale: 1,
    }),
  textStyle: z
    .object({
      fontFamily: z.string(),
      fontWeight: z.number(),
      fontSize: z.number().positive(),
      color: z.string(),
      align: z.enum(["left", "center", "right"]),
      lineHeight: z.number().positive(),
      letterSpacing: z.number(),
    })
    .default({
      fontFamily: "Inter",
      fontWeight: 700,
      fontSize: 48,
      color: "#152144",
      align: "left",
      lineHeight: 1.05,
      letterSpacing: -1,
    }),
  textAnimation: z
    .object({
      entrance: textAnimationPresetSchema,
      exit: textAnimationPresetSchema,
      durationInFrames: z.number().int().min(1).max(300),
      typingSpeed: z.number().min(1).max(120).default(18),
      cursor: textCursorStyleSchema.default("line"),
    })
    .default({
      entrance: "none",
      exit: "none",
      durationInFrames: 18,
      typingSpeed: 18,
      cursor: "line",
    }),
  media: z
    .object({
      assetId: z.string(),
      fileName: z.string(),
      type: z.literal("image"),
    })
    .optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  name: z.string().min(1),
  canvas: z.object({
    width: z.literal(1280),
    height: z.literal(720),
    fps: z.literal(30),
    durationInFrames: z.union([z.literal(300), z.literal(450)]),
  }),
  model: z
    .object({
      assetId: z.string().optional(),
      fileName: z.string(),
      fileSize: z.number().nonnegative().optional(),
      stats: z
        .object({
          nodes: z.number().int().nonnegative(),
          meshes: z.number().int().nonnegative(),
          materials: z.number().int().nonnegative(),
          animations: z.number().int().nonnegative(),
          triangles: z.number().int().nonnegative(),
          materialNames: z.array(z.string()),
        })
        .optional(),
      position: vector3,
      rotation: vector3,
      scale: z.number().positive(),
      pivot: vector3,
      frontAxis: z.enum(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]),
      defaultTransform: z
        .object({
          position: vector3,
          rotation: vector3,
          scale: z.number().positive(),
          pivot: vector3,
          frontAxis: z.enum(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]),
        })
        .optional(),
    })
    .nullable(),
  camera: z
    .object({
      position: vector3,
      target: vector3,
      fov: z.number().min(10).max(100),
      defaultPosition: vector3,
      defaultTarget: vector3,
      framedAssetId: z.string().optional(),
    })
    .optional(),
  lighting: z
    .object({
      preset: z.enum(["Soft Studio", "Bright Product", "Dark Cinematic"]),
      environmentIntensity: z.number().min(0).max(5),
      keyColor: z.string(),
      keyIntensity: z.number().min(0).max(10),
      keyPosition: vector3,
      fillIntensity: z.number().min(0).max(5),
      shadowOpacity: z.number().min(0).max(1),
      shadowSoftness: z.number().min(0).max(10),
    })
    .default({
      preset: "Soft Studio",
      environmentIntensity: 1.2,
      keyColor: "#ffffff",
      keyIntensity: 2.4,
      keyPosition: [3, 5, 4],
      fillIntensity: 1.2,
      shadowOpacity: 0.3,
      shadowSoftness: 2.5,
    }),
  screen: z
    .object({
      mode: z.enum(["material", "plane"]).default("material"),
      materialName: z.string(),
      mediaAssetId: z.string().optional(),
      mediaFileName: z.string().optional(),
      mediaType: z.enum(["image", "video"]).optional(),
      testPattern: z.boolean().default(false),
      fit: z.enum(["fill", "fit", "stretch"]),
      flipY: z.boolean(),
      rotation: z.number(),
      offset: z.tuple([z.number(), z.number()]),
      scale: z.tuple([z.number(), z.number()]),
      emissionIntensity: z.number(),
      planePosition: vector3.default([0, 1, 0.02]),
      planeRotation: vector3.default([0, 0, 0]),
      planeSize: z
        .tuple([z.number().positive(), z.number().positive()])
        .default([0.9, 1.8]),
    })
    .nullable(),
  background: z.object({
    preset: z.enum(["Soft Blue", "Lilac Glow", "Midnight Studio"]),
    type: z.enum(["solid", "gradient"]).default("gradient"),
    colorA: z.string().default("#d9e8ff"),
    colorB: z.string().default("#f0d9ec"),
    angle: z.number().default(135),
  }),
  layers: z.array(layerSchema),
  keyframeTracks: z.array(keyframeTrackSchema).default([]),
  thumbnailDataUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const videoSceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().nonnegative(),
  sourceStartFrame: z.number().int().nonnegative().default(0),
  durationInFrames: z.number().int().positive().default(450),
  transitionToNext: z
    .object({
      type: sceneTransitionTypeSchema,
      durationInFrames: z.number().int().min(1).max(90),
    })
    .default({ type: "cut", durationInFrames: 15 }),
  thumbnailDataUrl: z.string().optional(),
  composition: projectSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const audioClipSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  fileName: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  sourceStartFrame: z.number().int().nonnegative().default(0),
  durationInFrames: z.number().int().positive(),
  sourceDurationInFrames: z.number().int().positive(),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  fadeInFrames: z.number().int().nonnegative().default(0),
  fadeOutFrames: z.number().int().nonnegative().default(0),
  waveform: z.array(z.number().min(0).max(1)).max(256).default([]),
});

export const audioTrackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: audioTrackTypeSchema,
  muted: z.boolean().default(false),
  volume: z.number().min(0).max(2).default(1),
  clips: z.array(audioClipSchema).default([]),
});

export const globalOverlaySchema = z.object({
  id: z.string().min(1),
  type: globalOverlayTypeSchema,
  name: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(5).max(100),
  content: z.string().default(""),
  assetId: z.string().optional(),
  fileName: z.string().optional(),
  fontSize: z.number().min(8).max(240).default(52),
  fontWeight: z.number().int().min(100).max(900).default(700),
  color: z.string().default("#ffffff"),
  backgroundColor: z.string().default("transparent"),
  opacity: z.number().min(0).max(1).default(1),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  animation: z.enum(["none", "fade", "slide-up", "typewriter"]).default("none"),
});

export const timelineClipTypeSchema = z.enum(["scene", "video", "image", "text", "audio"]);
export const timelineClipSchema = z.object({
  id: z.string().min(1),
  type: timelineClipTypeSchema,
  name: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  sourceStartFrame: z.number().int().nonnegative().default(0),
  referenceType: z.enum(["scene", "audio-clip", "overlay", "asset"]),
  referenceId: z.string().min(1),
  assetId: z.string().optional(),
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(50),
  scale: z.number().min(0.05).max(10).default(1),
  opacity: z.number().min(0).max(1).default(1),
  crop: z.enum(["fit", "fill", "stretch"]).default("fit"),
});
export const timelineTrackSchema = z.object({
  id: z.string().min(1),
  type: timelineClipTypeSchema,
  name: z.string().min(1),
  order: z.number().int().nonnegative(),
  locked: z.boolean().default(false),
  muted: z.boolean().default(false),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  clips: z.array(timelineClipSchema).default([]),
});

export const defaultAudioTracks = () => [
  { id: "music", name: "Music", type: "music" as const, muted: false, volume: 1, clips: [] },
  { id: "voiceover", name: "Voice-over", type: "voiceover" as const, muted: false, volume: 1, clips: [] },
  { id: "sfx", name: "Sound Effects", type: "sfx" as const, muted: false, volume: 1, clips: [] },
];

export function buildUnifiedTimelineTracks(
  scenes: Array<z.infer<typeof videoSceneSchema>>,
  audioTracks: Array<z.infer<typeof audioTrackSchema>>,
  overlays: Array<z.infer<typeof globalOverlaySchema>>,
  existingTracks: Array<z.infer<typeof timelineTrackSchema>> = [],
) {
  const visual = { x: 50, y: 50, scale: 1, opacity: 1, crop: "fit" as const };
  const trackState = (id: string) => {
    const existing = existingTracks.find((track) => track.id === id);
    return { locked: existing?.locked ?? false, muted: existing?.muted ?? false, visible: existing?.visible ?? true, opacity: existing?.opacity ?? 1, order: existing?.order };
  };
  const standalone = (type: z.infer<typeof timelineClipTypeSchema>) => existingTracks.filter((track) => track.type === type).flatMap((track) => track.clips).filter((clip) => clip.referenceType === "asset");
  const ordered = [...scenes].sort((a, b) => a.order - b.order), starts: number[] = [];
  let cursor = 0;
  ordered.forEach((scene, index) => {
    starts.push(cursor);
    const next = ordered[index + 1], transition = !next || scene.transitionToNext.type === "cut" ? 0 : Math.min(scene.transitionToNext.durationInFrames, scene.durationInFrames - 1, next.durationInFrames - 1);
    cursor += scene.durationInFrames - Math.max(0, transition);
  });
  const tracks: Array<z.infer<typeof timelineTrackSchema>> = [{
    id: "master-scenes", type: "scene", name: "Scenes", ...trackState("master-scenes"), order: trackState("master-scenes").order ?? 0,
    clips: ordered.map((scene, index) => ({ id: `scene-clip:${scene.id}`, type: "scene", name: scene.name, startFrame: starts[index], durationInFrames: scene.durationInFrames, sourceStartFrame: scene.sourceStartFrame, referenceType: "scene", referenceId: scene.id, ...visual })),
  }, {
    id: "master-images", type: "image", name: "Images & logos", ...trackState("master-images"), order: trackState("master-images").order ?? 1,
    clips: [...overlays.filter((overlay) => overlay.type === "logo" || overlay.type === "watermark").map((overlay) => ({ id: `overlay-clip:${overlay.id}`, type: "image" as const, name: overlay.name, startFrame: overlay.startFrame, durationInFrames: overlay.durationInFrames, sourceStartFrame: 0, referenceType: "overlay" as const, referenceId: overlay.id, assetId: overlay.assetId, ...visual })), ...standalone("image")],
  }, {
    id: "master-text", type: "text", name: "Titles & captions", ...trackState("master-text"), order: trackState("master-text").order ?? 2,
    clips: overlays.filter((overlay) => overlay.type !== "logo" && overlay.type !== "watermark").map((overlay) => ({ id: `overlay-clip:${overlay.id}`, type: "text", name: overlay.name, startFrame: overlay.startFrame, durationInFrames: overlay.durationInFrames, sourceStartFrame: 0, referenceType: "overlay", referenceId: overlay.id, ...visual })),
  }, {
    id: "master-video", type: "video", name: "Video", ...trackState("master-video"), order: trackState("master-video").order ?? 3, clips: standalone("video"),
  }];
  audioTracks.forEach((track, index) => { const id = `master-audio:${track.id}`, state = trackState(id); tracks.push({ id, type: "audio", name: track.name, ...state, order: state.order ?? 4 + index, muted: track.muted || state.muted, clips: track.clips.map((clip) => ({ id: `audio-clip:${clip.id}`, type: "audio", name: clip.fileName, startFrame: clip.startFrame, durationInFrames: clip.durationInFrames, sourceStartFrame: clip.sourceStartFrame, referenceType: "audio-clip", referenceId: clip.id, assetId: clip.assetId, ...visual })) }); });
  return tracks;
}

export const videoProjectSchema = z.object({
  schemaVersion: z.literal(3),
  id: z.string().min(1),
  name: z.string().min(1),
  canvas: z.object({
    width: z.literal(1280),
    height: z.literal(720),
    fps: z.literal(30),
  }),
  scenes: z.array(videoSceneSchema).min(1),
  audioTracks: z.array(audioTrackSchema).default([]),
  globalOverlays: z.array(globalOverlaySchema).default([]),
  timelineTracks: z.array(timelineTrackSchema).default([]),
  activeSceneId: z.string().min(1),
  thumbnailDataUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function migrateProjectData(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const project = value as Record<string, unknown>;
  if (project.schemaVersion === 1)
    return { ...project, schemaVersion: 2, keyframeTracks: [] };
  return project;
}

export function migrateVideoProjectData(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 3) {
    const normalizedScenes = Array.isArray(candidate.scenes)
      ? candidate.scenes.map((scene) => {
          if (!scene || typeof scene !== "object") return scene;
          const item = scene as Record<string, unknown>, composition = item.composition as Record<string, unknown> | undefined, canvas = composition?.canvas as Record<string, unknown> | undefined;
          return { ...item, sourceStartFrame: item.sourceStartFrame ?? 0, durationInFrames: item.durationInFrames ?? canvas?.durationInFrames ?? 450, transitionToNext: item.transitionToNext ?? { type: "cut", durationInFrames: 15 } };
        })
      : candidate.scenes;
    const normalizedAudio = Array.isArray(candidate.audioTracks) && candidate.audioTracks.length ? candidate.audioTracks : defaultAudioTracks(),
      normalizedOverlays = candidate.globalOverlays ?? [];
    return {
      ...candidate,
      scenes: normalizedScenes,
      audioTracks: normalizedAudio,
      globalOverlays: normalizedOverlays,
      timelineTracks: Array.isArray(candidate.timelineTracks) && candidate.timelineTracks.length ? candidate.timelineTracks : buildUnifiedTimelineTracks((normalizedScenes ?? []) as Array<z.infer<typeof videoSceneSchema>>, normalizedAudio as Array<z.infer<typeof audioTrackSchema>>, normalizedOverlays as Array<z.infer<typeof globalOverlaySchema>>),
    };
  }
  const migratedComposition = migrateProjectData(value) as Record<
    string,
    unknown
  >;
  if (migratedComposition.schemaVersion !== 2) return value;
  const now = new Date().toISOString(),
    projectId = String(migratedComposition.id ?? crypto.randomUUID()),
    projectName = String(migratedComposition.name ?? "Untitled Launch Video"),
    createdAt = String(migratedComposition.createdAt ?? now),
    updatedAt = String(migratedComposition.updatedAt ?? now),
    sceneId = `${projectId}-scene-1`;
  return {
    schemaVersion: 3,
    id: projectId,
    name: projectName,
    canvas: { width: 1280, height: 720, fps: 30 },
    scenes: [
      {
        id: sceneId,
        name: "Scene 1",
        order: 0,
        sourceStartFrame: 0,
        durationInFrames:
          (migratedComposition.canvas as Record<string, unknown>)
            ?.durationInFrames ?? 450,
        transitionToNext: { type: "cut", durationInFrames: 15 },
        thumbnailDataUrl: migratedComposition.thumbnailDataUrl,
        composition: migratedComposition,
        createdAt,
        updatedAt,
      },
    ],
    activeSceneId: sceneId,
    audioTracks: [
      { id: "music", name: "Music", type: "music", muted: false, volume: 1, clips: [] },
      { id: "voiceover", name: "Voice-over", type: "voiceover", muted: false, volume: 1, clips: [] },
      { id: "sfx", name: "Sound Effects", type: "sfx", muted: false, volume: 1, clips: [] },
    ],
    globalOverlays: [],
    timelineTracks: buildUnifiedTimelineTracks([{ id: sceneId, name: "Scene 1", order: 0, sourceStartFrame: 0, durationInFrames: Number((migratedComposition.canvas as Record<string, unknown>)?.durationInFrames ?? 450), transitionToNext: { type: "cut", durationInFrames: 15 }, composition: migratedComposition as z.infer<typeof projectSchema>, createdAt, updatedAt }], defaultAudioTracks(), []),
    thumbnailDataUrl: migratedComposition.thumbnailDataUrl,
    createdAt,
    updatedAt,
  };
}

export type TemplateProject = z.infer<typeof projectSchema>;
export type VideoScene = z.infer<typeof videoSceneSchema>;
export type VideoProject = z.infer<typeof videoProjectSchema>;
export type SceneTransitionType = z.infer<typeof sceneTransitionTypeSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
export type AudioTrackType = z.infer<typeof audioTrackTypeSchema>;
export type GlobalOverlay = z.infer<typeof globalOverlaySchema>;
export type GlobalOverlayType = z.infer<typeof globalOverlayTypeSchema>;
export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type TimelineTrack = z.infer<typeof timelineTrackSchema>;
export type TimelineClipType = z.infer<typeof timelineClipTypeSchema>;
export type ProjectLayer = z.infer<typeof layerSchema>;
export type KeyframeTrack = z.infer<typeof keyframeTrackSchema>;
export type TextAnimationPreset = z.infer<typeof textAnimationPresetSchema>;
export type TextCursorStyle = z.infer<typeof textCursorStyleSchema>;
export type NumericKeyframe = z.infer<typeof numericKeyframeSchema>;
export type ColorKeyframe = z.infer<typeof colorKeyframeSchema>;
