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
  if (candidate.schemaVersion === 3)
    return {
      ...candidate,
      scenes: Array.isArray(candidate.scenes)
        ? candidate.scenes.map((scene) => {
            if (!scene || typeof scene !== "object") return scene;
            const item = scene as Record<string, unknown>,
              composition = item.composition as
                Record<string, unknown> | undefined,
              canvas = composition?.canvas as
                Record<string, unknown> | undefined;
            return {
              ...item,
              sourceStartFrame: item.sourceStartFrame ?? 0,
              durationInFrames:
                item.durationInFrames ?? canvas?.durationInFrames ?? 450,
              transitionToNext: item.transitionToNext ?? {
                type: "cut",
                durationInFrames: 15,
              },
            };
          })
        : candidate.scenes,
    };
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
    thumbnailDataUrl: migratedComposition.thumbnailDataUrl,
    createdAt,
    updatedAt,
  };
}

export type TemplateProject = z.infer<typeof projectSchema>;
export type VideoScene = z.infer<typeof videoSceneSchema>;
export type VideoProject = z.infer<typeof videoProjectSchema>;
export type SceneTransitionType = z.infer<typeof sceneTransitionTypeSchema>;
export type ProjectLayer = z.infer<typeof layerSchema>;
export type KeyframeTrack = z.infer<typeof keyframeTrackSchema>;
export type TextAnimationPreset = z.infer<typeof textAnimationPresetSchema>;
export type TextCursorStyle = z.infer<typeof textCursorStyleSchema>;
export type NumericKeyframe = z.infer<typeof numericKeyframeSchema>;
export type ColorKeyframe = z.infer<typeof colorKeyframeSchema>;
