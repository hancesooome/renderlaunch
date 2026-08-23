import {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useThree} from '@react-three/fiber';
import {ContactShadows, Environment, OrbitControls, TransformControls, useGLTF} from '@react-three/drei';
import {Box3, Group, MathUtils, PerspectiveCamera, Sphere, Vector3} from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import type {TemplateProject} from '../project/schema';
import type {TransformMode} from '../store/editorStore';
import {easeOutCubic} from '../animation/frame';
import {useAssetUrl} from '../model/useAssetUrl';

type TransformValue={position:[number,number,number];rotation:[number,number,number];scale:number};
type NormalizedBounds={radius:number;height:number};
type Props={project:TemplateProject;frame:number;editable?:boolean;mode?:TransformMode;frameRequest?:number;onTransform?:(value:TransformValue)=>void;onCamera?:(position:[number,number,number],target:[number,number,number])=>void};

export function SceneCanvas({project,frame,editable=false,mode='translate',frameRequest=0,onTransform,onCamera}:Props){
 const asset=useAssetUrl(project.model?.assetId),url=asset.url,[bounds,setBounds]=useState<NormalizedBounds>();
 const camera=project.camera??{position:[0,0.6,4] as [number,number,number],target:[0,0,0] as [number,number,number],fov:35};
 useEffect(()=>setBounds(undefined),[url]);
 if(!url)return <div className="sceneStatus">{asset.status==='loading'?<><span className="sceneSpinner"/>Preparing model…</>:<><strong>Model asset unavailable</strong><small>Use Replace Model to attach the GLB again.</small></>}</div>;
 return <div className="threeCanvas"><Canvas shadows dpr={[1,2]} camera={{position:camera.position,fov:camera.fov}} gl={{antialias:true,preserveDrawingBuffer:true}}>
  <ambientLight intensity={1.2}/><directionalLight castShadow position={[3,5,4]} intensity={2.4}/>
  <Suspense fallback={null}><LoadedModel url={url} project={project} frame={frame} editable={editable} mode={mode} onTransform={onTransform} onBounds={setBounds}/><Environment preset="studio"/><ContactShadows position={[0,0,0]} opacity={.3} scale={10} blur={2.5}/></Suspense>
  <CameraController project={project} bounds={bounds} frameRequest={frameRequest} onCamera={onCamera}/>
 </Canvas></div>
}

function LoadedModel({url,project,frame,editable,mode,onTransform,onBounds}:{url:string;project:TemplateProject;frame:number;editable:boolean;mode:TransformMode;onTransform?:Props['onTransform'];onBounds:(bounds:NormalizedBounds)=>void}){
 const gltf=useGLTF(url),scene=useMemo(()=>clone(gltf.scene),[gltf.scene]),group=useRef<Group>(null),model=project.model!;
 const normalization=useMemo(()=>{
  scene.updateMatrixWorld(true);
  const box=new Box3().setFromObject(scene),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3());
  const largest=Math.max(size.x,size.y,size.z,0.0001),scale=2/largest;
  const sphere=box.getBoundingSphere(new Sphere());
  return {scale,offset:[-center.x,-box.min.y,-center.z] as [number,number,number],radius:Math.max(sphere.radius*scale,.25),height:size.y*scale};
 },[scene]);
 useEffect(()=>onBounds({radius:normalization.radius,height:normalization.height}),[normalization,onBounds]);
 const progress=easeOutCubic(frame/project.animation.durationInFrames),direction=project.animation.direction==='Right'?1:-1;
 const reveal=project.animation.preset==='Flip Reveal'?direction*(1-progress)*Math.PI*.42*project.animation.intensity/100:0;
 const slide=project.animation.preset==='Side Slide'?(1-progress)*direction*1.8:0,rise=project.animation.preset==='Float and Focus'?(1-progress)*.8:0;
 const pivot=model.pivot;
 const content=<group ref={group} position={model.position} rotation={model.rotation.map(MathUtils.degToRad) as [number,number,number]} scale={model.scale}>
  <group position={[pivot[0]+slide,pivot[1]+rise,pivot[2]]} rotation={[0,reveal,0]}><group position={[-pivot[0],-pivot[1],-pivot[2]]} rotation={frontRotation(model.frontAxis)}><group scale={normalization.scale}><primitive object={scene} position={normalization.offset}/></group></group></group>
 </group>;
 if(!editable)return content;
 return <TransformControls mode={mode} size={.8} onMouseUp={()=>{const value=group.current;if(!value)return;onTransform?.({position:value.position.toArray() as [number,number,number],rotation:[MathUtils.radToDeg(value.rotation.x),MathUtils.radToDeg(value.rotation.y),MathUtils.radToDeg(value.rotation.z)],scale:value.scale.x})}}>{content}</TransformControls>
}

function CameraController({project,bounds,frameRequest,onCamera}:{project:TemplateProject;bounds?:NormalizedBounds;frameRequest:number;onCamera?:Props['onCamera']}){
 const controls=useRef<OrbitControlsImpl>(null),{camera}=useThree(),configuration=project.camera,initialFit=useRef(false),lastRequest=useRef(frameRequest);
 useEffect(()=>{if(!configuration||!controls.current||!initialFit.current)return;camera.position.fromArray(configuration.position);(camera as PerspectiveCamera).fov=configuration.fov;controls.current.target.fromArray(configuration.target);(camera as PerspectiveCamera).updateProjectionMatrix();controls.current.update()},[camera,configuration?.position,configuration?.target,configuration?.fov]);
 useEffect(()=>{
  if(!bounds||!controls.current)return;
  if(initialFit.current&&lastRequest.current===frameRequest)return;
  const perspective=camera as PerspectiveCamera,fov=MathUtils.degToRad(perspective.fov),distance=bounds.radius/Math.sin(fov/2)*1.3;
  const modelPosition=project.model?.position??[0,0,0],target=new Vector3(modelPosition[0],modelPosition[1]+bounds.height*(project.model?.scale??1)/2,modelPosition[2]);
  const direction=camera.position.clone().sub(controls.current.target);
  if(direction.lengthSq()<.001)direction.set(.55,.3,1);direction.normalize();
  camera.position.copy(target).addScaledVector(direction,distance*(project.model?.scale??1));controls.current.target.copy(target);perspective.near=Math.max(.001,distance/100);perspective.far=Math.max(100,distance*100);perspective.updateProjectionMatrix();controls.current.update();initialFit.current=true;
  lastRequest.current=frameRequest;onCamera?.(camera.position.toArray() as [number,number,number],target.toArray() as [number,number,number]);
 },[bounds,camera,frameRequest,onCamera,project.model?.assetId]);
 return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.08} onEnd={()=>{if(!controls.current)return;onCamera?.(camera.position.toArray() as [number,number,number],controls.current.target.toArray() as [number,number,number])}}/>
}

function frontRotation(axis:NonNullable<TemplateProject['model']>['frontAxis']):[number,number,number]{const half=Math.PI/2;return axis==='+X'?[0,-half,0]:axis==='-X'?[0,half,0]:axis==='+Y'?[half,0,0]:axis==='-Y'?[-half,0,0]:axis==='-Z'?[0,Math.PI,0]:[0,0,0]}
