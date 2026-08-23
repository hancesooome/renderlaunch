import Dexie, {type EntityTable} from 'dexie';
import {projectSchema, type TemplateProject} from '../project/schema';

type StoredProject = TemplateProject & {savedAt: string};

const database = new Dexie('renderlaunch') as Dexie & {
  projects: EntityTable<StoredProject, 'id'>;
};

database.version(1).stores({projects: 'id, updatedAt, savedAt'});

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
