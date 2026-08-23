import {z} from 'zod';

const vector3 = z.tuple([z.number(), z.number(), z.number()]);

export const layerSchema = z.object({
  id: z.string(),
  type: z.enum(['camera', 'lighting', 'device', 'screen-media', 'text', 'image', 'background']),
  name: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  visible: z.boolean(),
  locked: z.boolean(),
  zIndex: z.number().int(),
  color: z.string(),
  content: z.string().optional(),
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
  model: z.object({
    assetId: z.string().optional(),
    fileName: z.string(),
    fileSize: z.number().nonnegative().optional(),
    stats: z.object({
      nodes: z.number().int().nonnegative(), meshes: z.number().int().nonnegative(),
      materials: z.number().int().nonnegative(), animations: z.number().int().nonnegative(),
      triangles: z.number().int().nonnegative(), materialNames: z.array(z.string()),
    }).optional(),
    position: vector3,
    rotation: vector3,
    scale: z.number().positive(),
    pivot: vector3,
    frontAxis: z.enum(['+X', '-X', '+Y', '-Y', '+Z', '-Z']),
  }).nullable(),
  screen: z.object({
    materialName: z.string(),
    fit: z.enum(['fill', 'fit', 'stretch']),
    flipY: z.boolean(),
    rotation: z.number(),
    offset: z.tuple([z.number(), z.number()]),
    scale: z.tuple([z.number(), z.number()]),
    emissionIntensity: z.number(),
  }).nullable(),
  animation: z.object({
    preset: z.enum(['Flip Reveal', 'Float and Focus', 'Side Slide']),
    direction: z.enum(['Left', 'Right', 'Up', 'Down']),
    durationInFrames: z.number().int().positive(),
    intensity: z.number().min(0).max(100),
  }),
  background: z.object({preset: z.enum(['Soft Blue', 'Lilac Glow', 'Midnight Studio'])}),
  layers: z.array(layerSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TemplateProject = z.infer<typeof projectSchema>;
export type ProjectLayer = z.infer<typeof layerSchema>;
