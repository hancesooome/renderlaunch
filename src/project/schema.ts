import { z } from "zod";

const vector3 = z.tuple([z.number(), z.number(), z.number()]);

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
  media: z
    .object({
      assetId: z.string(),
      fileName: z.string(),
      type: z.literal("image"),
    })
    .optional(),
  entrance: z
    .object({
      preset: z.enum([
        "Fade Up",
        "Slide In",
        "Blur Reveal",
        "Scale Pop",
        "Rotate Reveal",
      ]),
      durationInFrames: z.number().int().positive(),
      easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
    })
    .optional(),
  exit: z
    .object({
      preset: z.enum([
        "Fade Up",
        "Slide In",
        "Blur Reveal",
        "Scale Pop",
        "Rotate Reveal",
      ]),
      durationInFrames: z.number().int().positive(),
      easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
    })
    .optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
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
  animation: z.object({
    preset: z.enum(["Flip Reveal", "Float and Focus", "Side Slide"]),
    direction: z.enum(["Left", "Right", "Up", "Down"]),
    durationInFrames: z.number().int().positive(),
    intensity: z.number().min(0).max(100),
    easing: z
      .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
      .default("ease-out"),
  }),
  background: z.object({
    preset: z.enum(["Soft Blue", "Lilac Glow", "Midnight Studio"]),
    type: z.enum(["solid", "gradient"]).default("gradient"),
    colorA: z.string().default("#d9e8ff"),
    colorB: z.string().default("#f0d9ec"),
    angle: z.number().default(135),
  }),
  layers: z.array(layerSchema),
  thumbnailDataUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TemplateProject = z.infer<typeof projectSchema>;
export type ProjectLayer = z.infer<typeof layerSchema>;
