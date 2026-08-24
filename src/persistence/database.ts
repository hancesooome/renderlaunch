import Dexie, { type EntityTable } from "dexie";
import {
  migrateVideoProjectData,
  videoProjectSchema,
  type VideoProject,
} from "../project/schema";

type StoredProject = VideoProject & { savedAt: string };
type StoredAsset = {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: string;
};

const database = new Dexie("renderlaunch") as Dexie & {
  projects: EntityTable<StoredProject, "id">;
  assets: EntityTable<StoredAsset, "id">;
};

database.version(1).stores({ projects: "id, updatedAt, savedAt" });
database
  .version(2)
  .stores({ projects: "id, updatedAt, savedAt", assets: "id, createdAt" });

export async function saveProject(project: VideoProject) {
  const valid = videoProjectSchema.parse(project);
  await database.projects.put({ ...valid, savedAt: new Date().toISOString() });
  localStorage.setItem("renderlaunch:recent-project", valid.id);
}

export async function loadRecentProject(): Promise<VideoProject | null> {
  const id = localStorage.getItem("renderlaunch:recent-project");
  if (!id) return null;
  const stored = await database.projects.get(id);
  if (!stored) return null;
  const { savedAt: _savedAt, ...project } = stored;
  const migrated = migrateVideoProjectData(project),
    result = videoProjectSchema.safeParse(migrated);
  if (!result.success) return null;
  result.data.scenes.sort((a, b) => a.order - b.order);
  result.data.scenes.forEach((scene, order) => {
    scene.order = order;
    const layers = scene.composition.layers,
      needsReplaceableMigration = layers.every(
        (layer) => !Object.prototype.hasOwnProperty.call(layer, "replaceable"),
      );
    if (needsReplaceableMigration)
      layers.forEach((layer) => {
        layer.replaceable = [
          "screen-media",
          "text",
          "image",
          "background",
        ].includes(layer.type);
        if (layer.type === "background") layer.locked = false;
      });
    if (!layers.some((layer) => layer.type === "lighting"))
      layers.splice(1, 0, {
        id: "lighting",
        type: "lighting",
        name: "Lighting",
        startFrame: 0,
        durationInFrames: scene.composition.canvas.durationInFrames,
        visible: true,
        locked: true,
        replaceable: false,
        zIndex: 0,
        color: "#ffd38f",
        is3D: false,
        transform3D: {
          position: [0, 0, 1],
          rotation: [0, 0, 0],
          scale: 1,
        },
        transform2D: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
        },
        textStyle: {
          fontFamily: "Inter",
          fontWeight: 500,
          fontSize: 24,
          color: "#ffffff",
          align: "left",
          lineHeight: 1.2,
          letterSpacing: 0,
        },
        textAnimation: {
          entrance: "none",
          exit: "none",
          durationInFrames: 18,
          typingSpeed: 18,
          cursor: "line",
        },
      });
  });
  if (
    !result.data.scenes.some((scene) => scene.id === result.data.activeSceneId)
  )
    result.data.activeSceneId = result.data.scenes[0].id;
  return result.data;
}

export async function saveAsset(file: File) {
  const id = crypto.randomUUID();
  await database.assets.put({
    id,
    name: file.name,
    type: file.type || "model/gltf-binary",
    size: file.size,
    blob: file,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function loadAssetBlob(id: string) {
  return (await database.assets.get(id))?.blob ?? null;
}
export async function deleteAsset(id?: string) {
  if (id) await database.assets.delete(id);
}
