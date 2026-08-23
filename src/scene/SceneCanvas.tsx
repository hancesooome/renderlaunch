import {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useThree} from '@react-three/fiber';
import {ContactShadows, Environment, OrbitControls, TransformControls, useGLTF} from '@react-three/drei';
import {Box3, CanvasTexture, ClampToEdgeWrapping, Group, LinearFilter, LinearMipmapLinearFilter, MathUtils, Mesh, PerspectiveCamera, ShaderMaterial, Sphere, Texture, TextureLoader, Vector2, Vector3, VideoTexture} from 'three';
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
 const asset=useAssetUrl(project.model?.assetId),screenAsset=useAssetUrl(project.screen?.mediaAssetId),url=asset.url,[bounds,setBounds]=useState<NormalizedBounds>();
 const camera=project.camera??{position:[0,0.6,4] as [number,number,number],target:[0,0,0] as [number,number,number],fov:35};
 const lightingVisible=project.layers.find(layer=>layer.type==='lighting')?.visible??true;
 useEffect(()=>setBounds(undefined),[url]);
 if(!url)return <div className="sceneStatus">{asset.status==='loading'?<><span className="sceneSpinner"/>Preparing model…</>:<><strong>Model asset unavailable</strong><small>Use Replace Model to attach the GLB again.</small></>}</div>;
 return <div className="threeCanvas"><Canvas shadows dpr={[1,2]} camera={{position:camera.position,fov:camera.fov}} gl={{antialias:true,preserveDrawingBuffer:true}}>
  <ambientLight intensity={lightingVisible?project.lighting.fillIntensity:0}/><directionalLight castShadow color={project.lighting.keyColor} position={project.lighting.keyPosition} intensity={lightingVisible?project.lighting.keyIntensity:0}/>
  <Suspense fallback={null}><LoadedModel url={url} screenUrl={screenAsset.url} project={project} frame={frame} editable={editable} mode={mode} onTransform={onTransform} onBounds={setBounds}/>{lightingVisible&&<><Environment preset="studio" environmentIntensity={project.lighting.environmentIntensity}/><ContactShadows position={[0,0,0]} opacity={project.lighting.shadowOpacity} scale={10} blur={project.lighting.shadowSoftness}/></>}</Suspense>
  <CameraController project={project} bounds={bounds} frameRequest={frameRequest} onCamera={onCamera}/>
 </Canvas></div>
}

function LoadedModel({url,screenUrl,project,frame,editable,mode,onTransform,onBounds}:{url:string;screenUrl?:string;project:TemplateProject;frame:number;editable:boolean;mode:TransformMode;onTransform?:Props['onTransform'];onBounds:(bounds:NormalizedBounds)=>void}){
 const gltf=useGLTF(url),scene=useMemo(()=>{const value=clone(gltf.scene);value.traverse(object=>{if(object instanceof Mesh){const copy=(material:ShaderMaterial,index:number)=>{const cloned=material.clone();if(!cloned.name)cloned.name=`${object.name||'Mesh'} Material ${index+1}`;return cloned};object.material=Array.isArray(object.material)?object.material.map((material,index)=>copy(material as ShaderMaterial,index)):copy(object.material as ShaderMaterial,0);object.castShadow=true;object.receiveShadow=true}});return value},[gltf.scene]),group=useRef<Group>(null),model=project.model!;
 const screenTexture=useScreenTexture(project,screenUrl,frame),screenLayer=project.layers.find(layer=>layer.type==='screen-media'),screenActive=Boolean(screenLayer?.visible&&frame>=screenLayer.startFrame&&frame<screenLayer.startFrame+screenLayer.durationInFrames),mappedTexture=screenActive?screenTexture:undefined;
 const normalization=useMemo(()=>{
  scene.updateMatrixWorld(true);
  const box=new Box3().setFromObject(scene),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3());
  const largest=Math.max(size.x,size.y,size.z,0.0001),scale=2/largest;
  const sphere=box.getBoundingSphere(new Sphere());
  return {scale,offset:[-center.x,-box.min.y,-center.z] as [number,number,number],radius:Math.max(sphere.radius*scale,.25),height:size.y*scale};
 },[scene]);
 useEffect(()=>onBounds({radius:normalization.radius,height:normalization.height}),[normalization,onBounds]);
 useEffect(()=>{
  const screen=project.screen;if(!screen||screen.mode!=='material'||!mappedTexture)return;
  const replacements:Array<{mesh:Mesh;original:Mesh['material'];created:ShaderMaterial[]}>=[];
  scene.traverse(object=>{if(!(object instanceof Mesh))return;const original=object.material,list=Array.isArray(original)?original:[original],created:ShaderMaterial[]=[];let matched=false;const replacement=list.map(material=>{if(material.name!==screen.materialName)return material;matched=true;const display=createDisplayMaterial(mappedTexture,screen,9/19.5);display.name=material.name;display.side=material.side;created.push(display);return display});if(matched){replacements.push({mesh:object,original,created});object.material=Array.isArray(original)?replacement:replacement[0]}});
  return()=>replacements.forEach(({mesh,original,created})=>{mesh.material=original;created.forEach(material=>material.dispose())});
 },[project.screen,scene,mappedTexture]);
 const progress=easeOutCubic(frame/project.animation.durationInFrames),direction=project.animation.direction==='Right'?1:-1;
 const reveal=project.animation.preset==='Flip Reveal'?direction*(1-progress)*Math.PI*.42*project.animation.intensity/100:0;
 const slide=project.animation.preset==='Side Slide'?(1-progress)*direction*1.8:0,rise=project.animation.preset==='Float and Focus'?(1-progress)*.8:0;
 const pivot=model.pivot;
 const content=<group ref={group} position={model.position} rotation={model.rotation.map(MathUtils.degToRad) as [number,number,number]} scale={model.scale}>
  <group position={[pivot[0]+slide,pivot[1]+rise,pivot[2]]} rotation={[0,reveal,0]}><group position={[-pivot[0],-pivot[1],-pivot[2]]} rotation={frontRotation(model.frontAxis)}><group scale={normalization.scale}><primitive object={scene} position={normalization.offset}/></group>{project.screen?.mode==='plane'&&mappedTexture&&<ScreenPlane project={project} texture={mappedTexture}/>}</group></group>
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

function ScreenPlane({project,texture}:{project:TemplateProject;texture:Texture}){const screen=project.screen!,material=useMemo(()=>createDisplayMaterial(texture,screen,screen.planeSize[0]/screen.planeSize[1]),[screen,texture]);useEffect(()=>()=>material.dispose(),[material]);return <mesh position={screen.planePosition} rotation={screen.planeRotation.map(MathUtils.degToRad) as [number,number,number]}><planeGeometry args={screen.planeSize}/><primitive object={material} attach="material"/></mesh>}

function useScreenTexture(project:TemplateProject,url:string|undefined,frame:number){
 const screen=project.screen,[texture,setTexture]=useState<Texture>(),video=useRef<HTMLVideoElement|undefined>(undefined),{gl}=useThree();
 useEffect(()=>{
  let active=true,next:Texture|undefined,element:HTMLVideoElement|undefined;
  if(!screen){setTexture(undefined);return}
  if(screen.testPattern){next=createTestPattern();configureTexture(next,gl.capabilities.getMaxAnisotropy(),false);setTexture(next)}
  else if(url&&screen.mediaType==='video'){
   element=document.createElement('video');element.src=url;element.muted=true;element.loop=true;element.playsInline=true;element.preload='auto';video.current=element;element.onloadedmetadata=()=>{if(!active||!element)return;next=new VideoTexture(element);configureTexture(next,gl.capabilities.getMaxAnisotropy(),true);setTexture(next);void element.play().catch(()=>{})};element.load();
  }else if(url){new TextureLoader().load(url,loaded=>{if(!active){loaded.dispose();return}next=loaded;configureTexture(loaded,gl.capabilities.getMaxAnisotropy(),false);setTexture(loaded)},undefined,()=>active&&setTexture(undefined))}
  else setTexture(undefined);
  return()=>{active=false;if(element){element.pause();element.removeAttribute('src');element.load()}if(next)next.dispose();video.current=undefined};
 },[screen?.testPattern,screen?.mediaAssetId,screen?.mediaType,url]);
 useEffect(()=>{if(video.current&&Number.isFinite(video.current.duration)&&video.current.duration>0){const time=(frame/project.canvas.fps)%video.current.duration;if(Math.abs(video.current.currentTime-time)>.12)video.current.currentTime=time}},[frame,project.canvas.fps]);
 return texture;
}

function createTestPattern(){const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1440;const context=canvas.getContext('2d')!;const gradient=context.createLinearGradient(0,0,720,1440);gradient.addColorStop(0,'#0a84ff');gradient.addColorStop(.52,'#7c4dff');gradient.addColorStop(1,'#ff4d8d');context.fillStyle=gradient;context.fillRect(0,0,720,1440);context.fillStyle='#fff';context.font='700 54px Inter, sans-serif';context.textAlign='center';context.fillText('TOP',360,100);context.fillText('RenderLaunch',360,665);context.font='32px Inter, sans-serif';context.fillText('SCREEN TEST',360,720);context.font='700 42px Inter, sans-serif';context.fillText('LEFT',105,760);context.fillText('RIGHT',610,760);context.fillText('BOTTOM',360,1360);for(let i=0;i<9;i++){context.fillStyle=i%2?'#fff':'#111';context.fillRect(i*80,1160,80,100)}const texture=new CanvasTexture(canvas);configureTexture(texture,1,false);return texture}

function configureTexture(texture:Texture,anisotropy:number,video:boolean){texture.flipY=false;texture.wrapS=ClampToEdgeWrapping;texture.wrapT=ClampToEdgeWrapping;texture.magFilter=LinearFilter;texture.minFilter=video?LinearFilter:LinearMipmapLinearFilter;texture.generateMipmaps=!video;texture.anisotropy=Math.max(1,anisotropy);texture.needsUpdate=true}

function createDisplayMaterial(texture:Texture,screen:NonNullable<TemplateProject['screen']>,targetAspect:number){const image=texture.image as {videoWidth?:number;videoHeight?:number;width?:number;height?:number},width=image.videoWidth||image.width||16,height=image.videoHeight||image.height||9;return new ShaderMaterial({transparent:false,depthWrite:true,depthTest:true,toneMapped:false,uniforms:{uMap:{value:texture},uBrightness:{value:screen.emissionIntensity},uSourceAspect:{value:width/height},uTargetAspect:{value:targetAspect},uFit:{value:screen.fit==='fill'?0:screen.fit==='fit'?1:2},uBaseFlipY:{value:screen.mode==='plane'},uFlipY:{value:screen.flipY},uRotation:{value:MathUtils.degToRad(screen.rotation)},uScale:{value:new Vector2(Math.max(.001,screen.scale[0]),Math.max(.001,screen.scale[1]))},uOffset:{value:new Vector2(screen.offset[0],screen.offset[1])}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:SCREEN_FRAGMENT_SHADER})}

const SCREEN_FRAGMENT_SHADER=`
uniform sampler2D uMap; uniform float uBrightness; uniform float uSourceAspect; uniform float uTargetAspect; uniform int uFit; uniform bool uBaseFlipY; uniform bool uFlipY; uniform float uRotation; uniform vec2 uScale; uniform vec2 uOffset; varying vec2 vUv;
void main(){
 vec2 uv=vUv;
 if(uBaseFlipY!=uFlipY)uv.y=1.0-uv.y;
 uv=(uv-0.5)/uScale+0.5+uOffset;
 float ratio=uSourceAspect/uTargetAspect;
 if(uFit==0){if(ratio>1.0)uv.x=(uv.x-0.5)/ratio+0.5;else uv.y=(uv.y-0.5)*ratio+0.5;}
 else if(uFit==1){if(ratio>1.0)uv.y=(uv.y-0.5)*ratio+0.5;else uv.x=(uv.x-0.5)/ratio+0.5;}
 float c=cos(uRotation),s=sin(uRotation);uv=mat2(c,-s,s,c)*(uv-0.5)+0.5;
 if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))){gl_FragColor=vec4(0.0,0.0,0.0,1.0);return;}
 vec4 color=texture2D(uMap,uv);gl_FragColor=vec4(color.rgb*uBrightness,color.a);
}`;
