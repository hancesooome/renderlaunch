import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  OrbitControls,
  TransformControls,
  useGLTF,
} from "@react-three/drei";
import {
  Box3,
  CanvasTexture,
  ClampToEdgeWrapping,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  ShaderMaterial,
  Sphere,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  VideoTexture,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { TemplateProject } from "../project/schema";
import type { TransformMode } from "../store/editorStore";
import { evaluateDeviceFrame } from "../animation/presets";
import { useAssetUrl } from "../model/useAssetUrl";

type TransformValue = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};
type NormalizedBounds = { radius: number; height: number };
type Props = {
  project: TemplateProject;
  frame: number;
  editable?: boolean;
  mode?: TransformMode;
  frameRequest?: number;
  autoFrame?: boolean;
  onTransform?: (value: TransformValue) => void;
  onCamera?: (
    position: [number, number, number],
    target: [number, number, number],
    reason: "interaction" | "frame",
  ) => void;
};

export function SceneCanvas({
  project,
  frame,
  editable = false,
  mode = "translate",
  frameRequest = 0,
  autoFrame = false,
  onTransform,
  onCamera,
}: Props) {
  const asset = useAssetUrl(project.model?.assetId),
    screenAsset = useAssetUrl(project.screen?.mediaAssetId),
    url = asset.url,
    [bounds, setBounds] = useState<NormalizedBounds>();
  const camera = project.camera ?? {
    position: [0, 0.6, 4] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 35,
  };
  const lightingVisible =
    project.layers.find((layer) => layer.type === "lighting")?.visible ?? true;
  useEffect(() => setBounds(undefined), [url]);
  if (!url)
    return (
      <div className="sceneStatus">
        {asset.status === "loading" ? (
          <>
            <span className="sceneSpinner" />
            Preparing model…
          </>
        ) : (
          <>
            <strong>Model asset unavailable</strong>
            <small>Use Replace Model to attach the GLB again.</small>
          </>
        )}
      </div>
    );
  return (
    <div className="threeCanvas">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: camera.position, fov: camera.fov }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <ambientLight
          intensity={lightingVisible ? project.lighting.fillIntensity : 0}
        />
        <directionalLight
          castShadow
          color={project.lighting.keyColor}
          position={project.lighting.keyPosition}
          intensity={lightingVisible ? project.lighting.keyIntensity : 0}
        />
        <Suspense fallback={null}>
          <LoadedModel
            url={url}
            screenUrl={screenAsset.url}
            project={project}
            frame={frame}
            editable={editable}
            mode={mode}
            onTransform={onTransform}
            onBounds={setBounds}
          />
          {lightingVisible && (
            <>
              <Environment
                preset="studio"
                environmentIntensity={project.lighting.environmentIntensity}
              />
              <ContactShadows
                position={[0, 0, 0]}
                opacity={project.lighting.shadowOpacity}
                scale={10}
                blur={project.lighting.shadowSoftness}
              />
            </>
          )}
        </Suspense>
        <CameraController
          project={project}
          bounds={bounds}
          frameRequest={frameRequest}
          autoFrame={autoFrame}
          onCamera={onCamera}
        />
      </Canvas>
    </div>
  );
}

function LoadedModel({
  url,
  screenUrl,
  project,
  frame,
  editable,
  mode,
  onTransform,
  onBounds,
}: {
  url: string;
  screenUrl?: string;
  project: TemplateProject;
  frame: number;
  editable: boolean;
  mode: TransformMode;
  onTransform?: Props["onTransform"];
  onBounds: (bounds: NormalizedBounds) => void;
}) {
  const gltf = useGLTF(url),
    scene = useMemo(() => {
      const value = clone(gltf.scene);
      value.traverse((object) => {
        if (object instanceof Mesh) {
          const copy = (material: ShaderMaterial, index: number) => {
            const cloned = material.clone();
            if (!cloned.name)
              cloned.name = `${object.name || "Mesh"} Material ${index + 1}`;
            return cloned;
          };
          object.material = Array.isArray(object.material)
            ? object.material.map((material, index) =>
                copy(material as ShaderMaterial, index),
              )
            : copy(object.material as ShaderMaterial, 0);
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      return value;
    }, [gltf.scene]),
    group = useRef<Group>(null),
    dragging = useRef(false),
    pendingTransform = useRef<TransformValue | undefined>(undefined),
    model = project.model!;
  const screenTexture = useScreenTexture(project, screenUrl, frame),
    screenLayer = project.layers.find((layer) => layer.type === "screen-media"),
    screenActive = Boolean(
      screenLayer?.visible &&
      frame >= screenLayer.startFrame &&
      frame < screenLayer.startFrame + screenLayer.durationInFrames,
    ),
    mappedTexture = screenActive ? screenTexture : undefined;
  const normalization = useMemo(() => {
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene),
      size = box.getSize(new Vector3()),
      center = box.getCenter(new Vector3());
    const largest = Math.max(size.x, size.y, size.z, 0.0001),
      scale = 2 / largest;
    const sphere = box.getBoundingSphere(new Sphere());
    return {
      scale,
      offset: [-center.x, -box.min.y, -center.z] as [number, number, number],
      radius: Math.max(sphere.radius * scale, 0.25),
      height: size.y * scale,
    };
  }, [scene]);
  useEffect(
    () =>
      onBounds({ radius: normalization.radius, height: normalization.height }),
    [normalization, onBounds],
  );
  useEffect(() => {
    const screen = project.screen;
    if (!screen || screen.mode !== "material" || !mappedTexture) return;
    const replacements: Array<{
      mesh: Mesh;
      original: Mesh["material"];
      created: ShaderMaterial[];
    }> = [];
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const original = object.material,
        list = Array.isArray(original) ? original : [original],
        created: ShaderMaterial[] = [];
      let matched = false;
      const replacement = list.map((material) => {
        if (material.name !== screen.materialName) return material;
        matched = true;
        const display = createDisplayMaterial(mappedTexture, screen, 9 / 19.5);
        display.name = material.name;
        display.side = material.side;
        created.push(display);
        return display;
      });
      if (matched) {
        replacements.push({ mesh: object, original, created });
        object.material = Array.isArray(original)
          ? replacement
          : replacement[0];
      }
    });
    return () =>
      replacements.forEach(({ mesh, original, created }) => {
        mesh.material = original;
        created.forEach((material) => material.dispose());
      });
  }, [project.screen, scene, mappedTexture]);
  const captureTransform = () => {
    const value = group.current;
    if (!value) return;
    pendingTransform.current = {
      position: value.position.toArray() as [number, number, number],
      rotation: [
        MathUtils.radToDeg(value.rotation.x),
        MathUtils.radToDeg(value.rotation.y),
        MathUtils.radToDeg(value.rotation.z),
      ],
      scale: value.scale.x,
    };
  };
  const finishTransform = () => {
    if (!dragging.current) return;
    captureTransform();
    dragging.current = false;
    if (pendingTransform.current) onTransform?.(pendingTransform.current);
    pendingTransform.current = undefined;
  };
  useEffect(() => {
    window.addEventListener("pointerup", finishTransform);
    window.addEventListener("pointercancel", finishTransform);
    return () => {
      window.removeEventListener("pointerup", finishTransform);
      window.removeEventListener("pointercancel", finishTransform);
    };
  });
  const animation = evaluateDeviceFrame(project, frame);
  const pivot = model.pivot;
  const content = (
    <group
      ref={group}
      position={model.position}
      rotation={
        model.rotation.map(MathUtils.degToRad) as [number, number, number]
      }
      scale={model.scale}
    >
      <group
        position={[pivot[0] + animation.x, pivot[1] + animation.y, pivot[2]]}
        rotation={[0, animation.rotationY, 0]}
        scale={animation.scale}
      >
        <group
          position={[-pivot[0], -pivot[1], -pivot[2]]}
          rotation={frontRotation(model.frontAxis)}
        >
          <group scale={normalization.scale}>
            <primitive object={scene} position={normalization.offset} />
          </group>
          {project.screen?.mode === "plane" && mappedTexture && (
            <ScreenPlane project={project} texture={mappedTexture} />
          )}
        </group>
      </group>
    </group>
  );
  if (!editable) return content;
  return (
    <>
      {content}
      <TransformControls
        object={group as RefObject<Group>}
        mode={mode}
        size={0.8}
        onMouseDown={() => {
          if (dragging.current) return;
          dragging.current = true;
          captureTransform();
        }}
        onObjectChange={() => dragging.current && captureTransform()}
        onMouseUp={finishTransform}
      />
    </>
  );
}

function CameraController({
  project,
  bounds,
  frameRequest,
  autoFrame,
  onCamera,
}: {
  project: TemplateProject;
  bounds?: NormalizedBounds;
  frameRequest: number;
  autoFrame: boolean;
  onCamera?: Props["onCamera"];
}) {
  const controls = useRef<OrbitControlsImpl>(null),
    { camera } = useThree(),
    configuration = project.camera,
    autoFramed = useRef(false),
    lastRequest = useRef(frameRequest);
  useEffect(() => {
    if (!configuration || !controls.current) return;
    camera.position.fromArray(configuration.position);
    (camera as PerspectiveCamera).fov = configuration.fov;
    controls.current.target.fromArray(configuration.target);
    (camera as PerspectiveCamera).updateProjectionMatrix();
    controls.current.update();
  }, [
    camera,
    configuration?.position,
    configuration?.target,
    configuration?.fov,
  ]);
  useEffect(() => {
    if (!bounds || !controls.current) return;
    const explicitRequest = lastRequest.current !== frameRequest;
    const initialAutoFrame = autoFrame && !autoFramed.current;
    if (!explicitRequest && !initialAutoFrame) return;
    const perspective = camera as PerspectiveCamera,
      fov = MathUtils.degToRad(perspective.fov),
      distance = (bounds.radius / Math.sin(fov / 2)) * 1.3;
    const modelPosition = project.model?.position ?? [0, 0, 0],
      target = new Vector3(
        modelPosition[0],
        modelPosition[1] + (bounds.height * (project.model?.scale ?? 1)) / 2,
        modelPosition[2],
      );
    const direction = camera.position.clone().sub(controls.current.target);
    if (direction.lengthSq() < 0.001) direction.set(0.55, 0.3, 1);
    direction.normalize();
    camera.position
      .copy(target)
      .addScaledVector(direction, distance * (project.model?.scale ?? 1));
    controls.current.target.copy(target);
    perspective.near = Math.max(0.001, distance / 100);
    perspective.far = Math.max(100, distance * 100);
    perspective.updateProjectionMatrix();
    controls.current.update();
    autoFramed.current = true;
    lastRequest.current = frameRequest;
    onCamera?.(
      camera.position.toArray() as [number, number, number],
      target.toArray() as [number, number, number],
      "frame",
    );
  }, [
    autoFrame,
    bounds,
    camera,
    frameRequest,
    onCamera,
    project.model?.assetId,
  ]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      onEnd={() => {
        if (!controls.current) return;
        onCamera?.(
          camera.position.toArray() as [number, number, number],
          controls.current.target.toArray() as [number, number, number],
          "interaction",
        );
      }}
    />
  );
}

function frontRotation(
  axis: NonNullable<TemplateProject["model"]>["frontAxis"],
): [number, number, number] {
  const half = Math.PI / 2;
  return axis === "+X"
    ? [0, -half, 0]
    : axis === "-X"
      ? [0, half, 0]
      : axis === "+Y"
        ? [half, 0, 0]
        : axis === "-Y"
          ? [-half, 0, 0]
          : axis === "-Z"
            ? [0, Math.PI, 0]
            : [0, 0, 0];
}

function ScreenPlane({
  project,
  texture,
}: {
  project: TemplateProject;
  texture: Texture;
}) {
  const screen = project.screen!,
    material = useMemo(
      () =>
        createDisplayMaterial(
          texture,
          screen,
          screen.planeSize[0] / screen.planeSize[1],
        ),
      [screen, texture],
    );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      position={screen.planePosition}
      rotation={
        screen.planeRotation.map(MathUtils.degToRad) as [number, number, number]
      }
    >
      <planeGeometry args={screen.planeSize} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function useScreenTexture(
  project: TemplateProject,
  url: string | undefined,
  frame: number,
) {
  const screen = project.screen,
    [texture, setTexture] = useState<Texture>(),
    video = useRef<HTMLVideoElement | undefined>(undefined),
    { gl } = useThree();
  useEffect(() => {
    let active = true,
      next: Texture | undefined,
      element: HTMLVideoElement | undefined;
    if (!screen) {
      setTexture(undefined);
      return;
    }
    if (screen.testPattern) {
      next = createTestPattern();
      configureTexture(next, gl.capabilities.getMaxAnisotropy(), false);
      setTexture(next);
    } else if (url && screen.mediaType === "video") {
      element = document.createElement("video");
      element.src = url;
      element.muted = true;
      element.loop = true;
      element.playsInline = true;
      element.preload = "auto";
      video.current = element;
      element.onloadedmetadata = () => {
        if (!active || !element) return;
        next = new VideoTexture(element);
        configureTexture(next, gl.capabilities.getMaxAnisotropy(), true);
        setTexture(next);
        void element.play().catch(() => {});
      };
      element.load();
    } else if (url) {
      new TextureLoader().load(
        url,
        (loaded) => {
          if (!active) {
            loaded.dispose();
            return;
          }
          next = loaded;
          configureTexture(loaded, gl.capabilities.getMaxAnisotropy(), false);
          setTexture(loaded);
        },
        undefined,
        () => active && setTexture(undefined),
      );
    } else setTexture(undefined);
    return () => {
      active = false;
      if (element) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      if (next) next.dispose();
      video.current = undefined;
    };
  }, [screen?.testPattern, screen?.mediaAssetId, screen?.mediaType, url]);
  useEffect(() => {
    if (
      video.current &&
      Number.isFinite(video.current.duration) &&
      video.current.duration > 0
    ) {
      const time = (frame / project.canvas.fps) % video.current.duration;
      if (Math.abs(video.current.currentTime - time) > 0.12)
        video.current.currentTime = time;
    }
  }, [frame, project.canvas.fps]);
  return texture;
}

function createTestPattern() {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1440;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 720, 1440);
  gradient.addColorStop(0, "#0a84ff");
  gradient.addColorStop(0.52, "#7c4dff");
  gradient.addColorStop(1, "#ff4d8d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 720, 1440);
  context.fillStyle = "#fff";
  context.font = "700 54px Inter, sans-serif";
  context.textAlign = "center";
  context.fillText("TOP", 360, 100);
  context.fillText("RenderLaunch", 360, 665);
  context.font = "32px Inter, sans-serif";
  context.fillText("SCREEN TEST", 360, 720);
  context.font = "700 42px Inter, sans-serif";
  context.fillText("LEFT", 105, 760);
  context.fillText("RIGHT", 610, 760);
  context.fillText("BOTTOM", 360, 1360);
  for (let i = 0; i < 9; i++) {
    context.fillStyle = i % 2 ? "#fff" : "#111";
    context.fillRect(i * 80, 1160, 80, 100);
  }
  const texture = new CanvasTexture(canvas);
  configureTexture(texture, 1, false);
  return texture;
}

function configureTexture(
  texture: Texture,
  anisotropy: number,
  video: boolean,
) {
  texture.flipY = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = video ? LinearFilter : LinearMipmapLinearFilter;
  texture.generateMipmaps = !video;
  texture.anisotropy = Math.max(1, anisotropy);
  texture.needsUpdate = true;
}

function createDisplayMaterial(
  texture: Texture,
  screen: NonNullable<TemplateProject["screen"]>,
  targetAspect: number,
) {
  const image = texture.image as {
      videoWidth?: number;
      videoHeight?: number;
      width?: number;
      height?: number;
    },
    width = image.videoWidth || image.width || 16,
    height = image.videoHeight || image.height || 9;
  return new ShaderMaterial({
    transparent: false,
    depthWrite: true,
    depthTest: true,
    toneMapped: false,
    uniforms: {
      uMap: { value: texture },
      uBrightness: { value: screen.emissionIntensity },
      uSourceAspect: { value: width / height },
      uTargetAspect: { value: targetAspect },
      uFit: { value: screen.fit === "fill" ? 0 : screen.fit === "fit" ? 1 : 2 },
      uBaseFlipY: { value: screen.mode === "plane" },
      uFlipY: { value: screen.flipY },
      uRotation: { value: MathUtils.degToRad(screen.rotation) },
      uScale: {
        value: new Vector2(
          Math.max(0.001, screen.scale[0]),
          Math.max(0.001, screen.scale[1]),
        ),
      },
      uOffset: { value: new Vector2(screen.offset[0], screen.offset[1]) },
    },
    vertexShader:
      "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: SCREEN_FRAGMENT_SHADER,
  });
}

const SCREEN_FRAGMENT_SHADER = `
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
