import Dexie, {type EntityTable} from 'dexie';
import {projectSchema, type TemplateProject} from '../project/schema';

type StoredProject = TemplateProject & {savedAt: string};
type StoredAsset = {id: string; name: string; type: string; size: number; blob: Blob; createdAt: string};

const database = new Dexie('renderlaunch') as Dexie & {
  projects: EntityTable<StoredProject, 'id'>;
  assets: EntityTable<StoredAsset, 'id'>;
};

database.version(1).stores({projects: 'id, updatedAt, savedAt'});
database.version(2).stores({projects: 'id, updatedAt, savedAt', assets: 'id, createdAt'});

export async function saveProject(project: TemplateProject) {
  const valid = projectSchema.parse(project);
  await database.projects.put({...valid, savedAt: new Date().toISOString()});
  localStorage.setItem('renderlaunch:recent-project', valid.id);
}

export async function loadRecentProject(): Promise<TemplateProject | null> {
  const id = localStorage.getItem('renderlaunch:recent-project');
  if (!id) return null;
  const stored = await database.projects.get(id);
  if (!stored) return null;
  const {savedAt: _savedAt, ...project} = stored;
  const result = projectSchema.safeParse(project);
  return result.success ? result.data : null;
}

export async function saveAsset(file: File) {
  const id = crypto.randomUUID();
  await database.assets.put({id, name: file.name, type: file.type || 'model/gltf-binary', size: file.size, blob: file, createdAt: new Date().toISOString()});
  return id;
}

export async function loadAssetBlob(id: string) { return (await database.assets.get(id))?.blob ?? null; }
export async function deleteAsset(id?: string) { if (id) await database.assets.delete(id); }
