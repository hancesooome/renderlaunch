import {LoadingManager, Mesh} from 'three';
import {GLTFLoader, type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ModelStats = {nodes:number;meshes:number;materials:number;animations:number;triangles:number;materialNames:string[]};

export async function inspectGlb(file: File): Promise<ModelStats> {
  if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('Choose a binary .glb file. Other 3D formats are not supported yet.');
  if (file.size === 0) throw new Error('This GLB is empty. Choose a valid model file.');
  if (file.size > 100 * 1024 * 1024) throw new Error('This model is over 100 MB. Optimize it before uploading.');
  const buffer = await file.arrayBuffer();
  const magic = new TextDecoder().decode(buffer.slice(0, 4));
  if (magic !== 'glTF') throw new Error('This file is not a valid binary GLB. Export it again with embedded assets.');
  const loader = new GLTFLoader(new LoadingManager());
  let gltf: GLTF;
  try { gltf = await loader.parseAsync(buffer, ''); }
  catch { throw new Error('We could not prepare this model. Try a GLB with embedded textures and standard PBR materials.'); }
  let nodes=0, meshes=0, triangles=0;
  const materials = new Set<string>();
  gltf.scene.traverse(object => {
    nodes++;
    if (object instanceof Mesh) {
      meshes++;
      const geometry=object.geometry;
      triangles += geometry.index ? geometry.index.count / 3 : (geometry.getAttribute('position')?.count ?? 0) / 3;
      const list=Array.isArray(object.material)?object.material:[object.material];
      list.forEach((material,index)=>materials.add(material.name || `${object.name || 'Mesh'} Material ${index + 1}`));
    }
  });
  if (!meshes) throw new Error('This GLB contains no renderable meshes.');
  return {nodes,meshes,materials:materials.size,animations:gltf.animations.length,triangles:Math.round(triangles),materialNames:[...materials].sort()};
}
