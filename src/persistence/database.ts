import Dexie, { type EntityTable } from "dexie";
import {
  migrateVideoProjectData,
  videoProjectSchema,
  buildUnifiedTimelineTracks,
  type VideoProject,
  type TemplateProject,
} from "../project/schema";

type StoredProject = VideoProject & { savedAt: string };
export type StoredAsset = {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: string;
  updatedAt?: string;
  folderId?: string;
};
export type AssetFolder = { id: string; name: string; createdAt: string; updatedAt: string };
export type StoredSceneTemplate = {
  id: string;
  name: string;
  composition: TemplateProject;
  thumbnailDataUrl?: string;
  createdAt: string;
  updatedAt: string;
};

const database = new Dexie("renderlaunch") as Dexie & {
  projects: EntityTable<StoredProject, "id">;
  assets: EntityTable<StoredAsset, "id">;
  sceneTemplates: EntityTable<StoredSceneTemplate, "id">;
  assetFolders: EntityTable<AssetFolder, "id">;
};

database.version(1).stores({ projects: "id, updatedAt, savedAt" });
database
  .version(2)
  .stores({ projects: "id, updatedAt, savedAt", assets: "id, createdAt" });
database.version(3).stores({ projects: "id, updatedAt, savedAt", assets: "id, createdAt", sceneTemplates: "id, updatedAt" });
database.version(4).stores({ projects: "id, updatedAt, savedAt", assets: "id, createdAt, updatedAt, folderId, type", sceneTemplates: "id, updatedAt", assetFolders: "id, updatedAt" });
database.version(5).stores({ projects: "id, updatedAt, savedAt", assets: "id, createdAt, updatedAt, folderId, type", sceneTemplates: "id, updatedAt", assetFolders: "id, name, updatedAt" });

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

export async function listProjects(): Promise<VideoProject[]> {
  const stored = await database.projects.orderBy("updatedAt").reverse().toArray(), projects: VideoProject[] = [];
  for (const record of stored) {
    const { savedAt: _savedAt, ...candidate } = record, result = videoProjectSchema.safeParse(migrateVideoProjectData(candidate));
    if (result.success) projects.push(result.data);
  }
  return projects;
}

export async function deleteProject(projectId: string) {
  await database.projects.delete(projectId);
  if (localStorage.getItem("renderlaunch:recent-project") === projectId) localStorage.removeItem("renderlaunch:recent-project");
}

export async function renameProject(projectId: string, name: string) {
  const project = await database.projects.get(projectId);
  if (!project) return;
  await database.projects.put({ ...project, name, updatedAt: new Date().toISOString(), savedAt: new Date().toISOString() });
}

export async function duplicateStoredProject(projectId: string) {
  const source = await database.projects.get(projectId);
  if (!source) return null;
  const now = new Date().toISOString(), copy = structuredClone(source), id = crypto.randomUUID();
  copy.id = id; copy.name = `${source.name} Copy`; copy.createdAt = now; copy.updatedAt = now; copy.savedAt = now;
  copy.scenes.forEach((scene, index) => { scene.id = crypto.randomUUID(); scene.order = index; scene.createdAt = now; scene.updatedAt = now; scene.composition.id = crypto.randomUUID(); scene.composition.createdAt = now; scene.composition.updatedAt = now; });
  copy.activeSceneId = copy.scenes[0].id;
  copy.timelineTracks = buildUnifiedTimelineTracks(copy.scenes, copy.audioTracks, copy.globalOverlays);
  await database.projects.put(copy);
  return copy as VideoProject;
}

export async function saveSceneTemplate(composition: TemplateProject) {
  const now = new Date().toISOString(), template: StoredSceneTemplate = { id: crypto.randomUUID(), name: composition.name, composition: structuredClone(composition), thumbnailDataUrl: composition.thumbnailDataUrl, createdAt: now, updatedAt: now };
  await database.sceneTemplates.put(template);
  return template;
}

export async function listSceneTemplates() { return database.sceneTemplates.orderBy("updatedAt").reverse().toArray(); }
export async function deleteSceneTemplate(templateId: string) { await database.sceneTemplates.delete(templateId); }

export async function saveAsset(file: File, folderId?: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.assets.put({
    id,
    name: file.name,
    type: file.type || "model/gltf-binary",
    size: file.size,
    blob: file,
    createdAt: now,
    updatedAt: now,
    folderId,
  });
  return id;
}

export async function loadAssetBlob(id: string) {
  return (await database.assets.get(id))?.blob ?? null;
}
export async function deleteAsset(id?: string) {
  if (id) await database.assets.delete(id);
}

export async function listAssets() { return database.assets.orderBy("createdAt").reverse().toArray(); }
export async function listAssetFolders() { return database.assetFolders.orderBy("name").toArray(); }
export async function createAssetFolder(name: string) {
  const now = new Date().toISOString(), folder: AssetFolder = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
  await database.assetFolders.put(folder); return folder;
}
export async function renameAssetFolder(id: string, name: string) { await database.assetFolders.update(id, { name, updatedAt: new Date().toISOString() }); }
export async function deleteAssetFolder(id: string) {
  await database.transaction("rw", database.assetFolders, database.assets, async () => {
    await database.assets.where("folderId").equals(id).modify({ folderId: undefined, updatedAt: new Date().toISOString() });
    await database.assetFolders.delete(id);
  });
}
export async function renameAsset(id: string, name: string) { await database.assets.update(id, { name, updatedAt: new Date().toISOString() }); }
export async function moveAsset(id: string, folderId?: string) { await database.assets.update(id, { folderId, updatedAt: new Date().toISOString() }); }
export async function duplicateAsset(id: string) {
  const source = await database.assets.get(id); if (!source) return null;
  const now = new Date().toISOString(), copy: StoredAsset = { ...source, id: crypto.randomUUID(), name: `${source.name.replace(/(\.[^.]+)?$/, "")} Copy${source.name.match(/\.[^.]+$/)?.[0] ?? ""}`, createdAt: now, updatedAt: now };
  await database.assets.put(copy); return copy;
}
