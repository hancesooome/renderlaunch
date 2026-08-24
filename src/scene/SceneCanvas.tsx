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
import {
  evaluateColorProperty,
  evaluateNumericProperty,
} from "../animation/keyframes";
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
  cameraControls?: boolean;
  onReady?: () => void;
  onMediaFrameReady?: (frame: number) => void;
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
  cameraControls = true,
  onReady,
  onMediaFrameReady,
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
  const lightingId =
      project.layers.find((layer) => layer.type === "lighting")?.id ??
      "lighting",
    animatedLighting = {
      environmentIntensity: evaluateNumericProperty(
        project.keyframeTracks,
        lightingId,
        "lighting.environmentIntensity",
        frame,
        project.lighting.environmentIntensity,
      ),
      keyIntensity: evaluateNumericProperty(
        project.keyframeTracks,
        lightingId,
        "lighting.keyIntensity",
        frame,
        project.lighting.keyIntensity,
      ),
      fillIntensity: evaluateNumericProperty(
        project.keyframeTracks,
        lightingId,
        "lighting.fillIntensity",
        frame,
        project.lighting.fillIntensity,
      ),
      shadowOpacity: evaluateNumericProperty(
        project.keyframeTracks,
        lightingId,
        "lighting.shadowOpacity",
        frame,
        project.lighting.shadowOpacity,
      ),
      shadowSoftness: evaluateNumericProperty(
        project.keyframeTracks,
        lightingId,
        "lighting.shadowSoftness",
        frame,
        project.lighting.shadowSoftness,
      ),
      keyColor: evaluateColorProperty(
        project.keyframeTracks,
        lightingId,
        "lighting.keyColor",
        frame,
        project.lighting.keyColor,
      ),
      keyPosition: project.lighting.keyPosition.map((value, index) =>
        evaluateNumericProperty(
          project.keyframeTracks,
          lightingId,
          `lighting.keyPosition.${["x", "y", "z"][index]}` as
            | "lighting.keyPosition.x"
            | "lighting.keyPosition.y"
            | "lighting.keyPosition.z",
          frame,
          value,
        ),
      ) as [number, number, number],
    };
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
          intensity={lightingVisible ? animatedLighting.fillIntensity : 0}
        />
        <directionalLight
          castShadow
          color={animatedLighting.keyColor}
          position={animatedLighting.keyPosition}
          intensity={lightingVisible ? animatedLighting.keyIntensity : 0}
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
            onReady={onReady}
            onMediaFrameReady={onMediaFrameReady}
          />
          {lightingVisible && (
            <>
              <Environment
                preset="studio"
                environmentIntensity={animatedLighting.environmentIntensity}
              />
              <ContactShadows
                position={[0, 0, 0]}
                opacity={animatedLighting.shadowOpacity}
                scale={10}
                blur={animatedLighting.shadowSoftness}
              />
            </>
          )}
        </Suspense>
        <CameraController
          project={project}
          frame={frame}
          bounds={bounds}
          frameRequest={frameRequest}
          autoFrame={autoFrame}
          enabled={cameraControls}
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
  onReady,
  onMediaFrameReady,
}: {
  url: string;
  screenUrl?: string;
  project: TemplateProject;
  frame: number;
  editable: boolean;
  mode: TransformMode;
  onTransform?: Props["onTransform"];
  onBounds: (bounds: NormalizedBounds) => void;
  onReady?: Props["onReady"];
  onMediaFrameReady?: Props["onMediaFrameReady"];
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
  const screenLayer = project.layers.find(
      (layer) => layer.type === "screen-media",
    ),
    screenId = screenLayer?.id ?? "media",
    animatedScreen = project.screen
      ? {
          ...project.screen,
          offset: project.screen.offset.map((value, index) =>
            evaluateNumericProperty(
              project.keyframeTracks,
              screenId,
              `screen.offset.${index === 0 ? "x" : "y"}` as
                "screen.offset.x" | "screen.offset.y",
              frame,
              value,
            ),
          ) as [number, number],
          scale: project.screen.scale.map((value, index) =>
            evaluateNumericProperty(
              project.keyframeTracks,
              screenId,
              `screen.scale.${index === 0 ? "x" : "y"}` as
                "screen.scale.x" | "screen.scale.y",
              frame,
              value,
            ),
          ) as [number, number],
          emissionIntensity:
            project.screen.emissionIntensity *
            evaluateNumericProperty(
              project.keyframeTracks,
              screenId,
              "screen.opacity",
              frame,
              1,
            ),
        }
      : null,
    animatedProject = { ...project, screen: animatedScreen };
  const screenTexture = useScreenTexture(
      animatedProject,
      screenUrl,
      frame,
      onMediaFrameReady,
    ),
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
  useEffect(() => {
    onBounds({ radius: normalization.radius, height: normalization.height });
    onReady?.();
  }, [normalization, onBounds, onReady]);
  useEffect(() => {
    const screen = animatedScreen;
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
  }, [animatedScreen, scene, mappedTexture]);
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
  const deviceId =
      project.layers.find((layer) => layer.type === "device")?.id ?? "phone",
    animatedPosition = model.position.map((value, index) =>
      evaluateNumericProperty(
        project.keyframeTracks,
        deviceId,
        `device.position.${["x", "y", "z"][index]}` as
          "device.position.x" | "device.position.y" | "device.position.z",
        frame,
        value,
      ),
    ) as [number, number, number],
    animatedRotation = model.rotation.map((value, index) =>
      evaluateNumericProperty(
        project.keyframeTracks,
        deviceId,
        `device.rotation.${["x", "y", "z"][index]}` as
          "device.rotation.x" | "device.rotation.y" | "device.rotation.z",
        frame,
        value,
      ),
    ) as [number, number, number],
    animatedScale = evaluateNumericProperty(
      project.keyframeTracks,
      deviceId,
      "device.scale",
      frame,
      model.scale,
    ),
    pivot = model.pivot;
  const content = (
    <group
      ref={group}
      position={animatedPosition}
      rotation={
        animatedRotation.map(MathUtils.degToRad) as [number, number, number]
      }
      scale={animatedScale}
    >
      <group position={pivot}>
        <group
          position={[-pivot[0], -pivot[1], -pivot[2]]}
          rotation={frontRotation(model.frontAxis)}
        >
          <group scale={normalization.scale}>
            <primitive object={scene} position={normalization.offset} />
          </group>
          {animatedScreen?.mode === "plane" && mappedTexture && (
            <ScreenPlane project={animatedProject} texture={mappedTexture} />
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
  frame,
  bounds,
  frameRequest,
  autoFrame,
  enabled,
  onCamera,
}: {
  project: TemplateProject;
  frame: number;
  bounds?: NormalizedBounds;
  frameRequest: number;
  autoFrame: boolean;
  enabled: boolean;
  onCamera?: Props["onCamera"];
}) {
  const controls = useRef<OrbitControlsImpl>(null),
    { camera } = useThree(),
    configuration = project.camera,
    autoFramed = useRef(false),
    lastRequest = useRef(frameRequest),
    orbiting = useRef(false),
    lastOrbitChange = useRef(0),
    settleFrame = useRef(0),
    onCameraRef = useRef(onCamera);
  onCameraRef.current = onCamera;
  const cameraId =
      project.layers.find((layer) => layer.type === "camera")?.id ?? "camera",
    animatedConfiguration = configuration
      ? {
          position: configuration.position.map((value, index) =>
            evaluateNumericProperty(
              project.keyframeTracks,
              cameraId,
              `camera.position.${["x", "y", "z"][index]}` as
                "camera.position.x" | "camera.position.y" | "camera.position.z",
              frame,
              value,
            ),
          ) as [number, number, number],
          target: configuration.target.map((value, index) =>
            evaluateNumericProperty(
              project.keyframeTracks,
              cameraId,
              `camera.target.${["x", "y", "z"][index]}` as
                "camera.target.x" | "camera.target.y" | "camera.target.z",
              frame,
              value,
            ),
          ) as [number, number, number],
          fov: evaluateNumericProperty(
            project.keyframeTracks,
            cameraId,
            "camera.fov",
            frame,
            configuration.fov,
          ),
        }
      : undefined;
  useEffect(() => {
    if (!animatedConfiguration || !controls.current || orbiting.current) return;
    const perspective = camera as PerspectiveCamera,
      target = controls.current.target,
      positionChanged =
        Math.abs(camera.position.x - animatedConfiguration.position[0]) >
          0.0001 ||
        Math.abs(camera.position.y - animatedConfiguration.position[1]) >
          0.0001 ||
        Math.abs(camera.position.z - animatedConfiguration.position[2]) >
          0.0001,
      targetChanged =
        Math.abs(target.x - animatedConfiguration.target[0]) > 0.0001 ||
        Math.abs(target.y - animatedConfiguration.target[1]) > 0.0001 ||
        Math.abs(target.z - animatedConfiguration.target[2]) > 0.0001,
      fovChanged =
        Math.abs(perspective.fov - animatedConfiguration.fov) > 0.0001;
    if (!positionChanged && !targetChanged && !fovChanged) return;
    camera.position.fromArray(animatedConfiguration.position);
    perspective.fov = animatedConfiguration.fov;
    target.fromArray(animatedConfiguration.target);
    perspective.updateProjectionMatrix();
    controls.current.update();
  }, [
    camera,
    animatedConfiguration?.position[0],
    animatedConfiguration?.position[1],
    animatedConfiguration?.position[2],
    animatedConfiguration?.target[0],
    animatedConfiguration?.target[1],
    animatedConfiguration?.target[2],
    animatedConfiguration?.fov,
  ]);
  useEffect(
    () => () => {
      if (settleFrame.current) cancelAnimationFrame(settleFrame.current);
    },
    [],
  );
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
      enabled={enabled}
      enableDamping
      dampingFactor={0.08}
      onStart={() => {
        if (settleFrame.current) cancelAnimationFrame(settleFrame.current);
        settleFrame.current = 0;
        orbiting.current = true;
        lastOrbitChange.current = performance.now();
      }}
      onChange={() => {
        if (orbiting.current) lastOrbitChange.current = performance.now();
      }}
      onEnd={() => {
        const saveWhenSettled = () => {
          if (performance.now() - lastOrbitChange.current < 100) {
            settleFrame.current = requestAnimationFrame(saveWhenSettled);
            return;
          }
          settleFrame.current = 0;
          orbiting.current = false;
          if (!controls.current) return;
          onCameraRef.current?.(
            camera.position.toArray() as [number, number, number],
            controls.current.target.toArray() as [number, number, number],
            "interaction",
          );
        };
        settleFrame.current = requestAnimationFrame(saveWhenSettled);
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
  onFrameReady?: (frame: number) => void,
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
      element.loop = false;
      element.playsInline = true;
      element.preload = "auto";
      video.current = element;
      element.onloadedmetadata = () => {
        if (!active || !element) return;
        next = new VideoTexture(element);
        configureTexture(next, gl.capabilities.getMaxAnisotropy(), true);
        setTexture(next);
        element.pause();
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
    const element = video.current,
      expectsVideo = screen?.mediaType === "video" && Boolean(url);
    if (
      !element ||
      !texture ||
      !Number.isFinite(element.duration) ||
      element.duration <= 0
    ) {
      if (!expectsVideo) onFrameReady?.(frame);
      return;
    }
    element.pause();
    const screenId =
        project.layers.find((layer) => layer.type === "screen-media")?.id ??
        "media",
      playbackOffset = evaluateNumericProperty(
        project.keyframeTracks,
        screenId,
        "screen.playbackOffset",
        frame,
        0,
      ),
      time =
        (((frame / project.canvas.fps + playbackOffset) % element.duration) +
          element.duration) %
        element.duration,
      tolerance = 1 / project.canvas.fps / 3;
    if (Math.abs(element.currentTime - time) <= tolerance) {
      texture.needsUpdate = true;
      onFrameReady?.(frame);
      return;
    }
    let active = true;
    const ready = () => {
      if (!active) return;
      texture.needsUpdate = true;
      onFrameReady?.(frame);
    };
    element.addEventListener("seeked", ready, { once: true });
    element.currentTime = time;
    return () => {
      active = false;
      element.removeEventListener("seeked", ready);
    };
  }, [
    frame,
    onFrameReady,
    project.canvas.fps,
    screen?.mediaType,
    texture,
    url,
  ]);
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
