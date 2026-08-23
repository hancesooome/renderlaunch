import {Suspense, useMemo} from 'react';
import {Canvas} from '@react-three/fiber';
import {Bounds, Center, ContactShadows, Environment, OrbitControls, useGLTF} from '@react-three/drei';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {TemplateProject} from '../project/schema';
import {easeOutCubic} from '../animation/frame';
import {useAssetUrl} from '../model/useAssetUrl';

export function SceneCanvas({project,frame}:{project:TemplateProject;frame:number}) {
  const url=useAssetUrl(project.model?.assetId);
  if(!url)return null;
  return <div className="threeCanvas"><Canvas shadows dpr={[1,2]} camera={{position:[0,0.6,4],fov:35}} gl={{antialias:true,preserveDrawingBuffer:true}}>
    <ambientLight intensity={1.2}/><directionalLight castShadow position={[3,5,4]} intensity={2.4}/>
    <Suspense fallback={null}><Bounds fit clip observe margin={1.25}><Center bottom><LoadedModel url={url} project={project} frame={frame}/></Center></Bounds><Environment preset="studio"/><ContactShadows position={[0,-1.15,0]} opacity={.3} scale={10} blur={2.5}/></Suspense>
    <OrbitControls makeDefault enableDamping dampingFactor={.08}/>
  </Canvas></div>
}

function LoadedModel({url,project,frame}:{url:string;project:TemplateProject;frame:number}) {
  const gltf=useGLTF(url);
  const scene=useMemo(()=>clone(gltf.scene),[gltf.scene]);
  const model=project.model!;
  const progress=easeOutCubic(frame/project.animation.durationInFrames);
  const direction=project.animation.direction==='Right'?1:-1;
  const reveal=project.animation.preset==='Flip Reveal'?direction*(1-progress)*Math.PI*.42*project.animation.intensity/100:0;
  const slide=project.animation.preset==='Side Slide'?(1-progress)*direction*1.8:0;
  const rise=project.animation.preset==='Float and Focus'?(1-progress)*.8:0;
  return <group position={[model.position[0]+slide,model.position[1]+rise,model.position[2]]} rotation={[degrees(model.rotation[0]),degrees(model.rotation[1])+reveal,degrees(model.rotation[2])]} scale={model.scale}><primitive object={scene}/></group>
}
const degrees=(value:number)=>value*Math.PI/180;
