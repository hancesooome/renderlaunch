import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as I from "lucide-react";
import Moveable from "react-moveable";
import type { LucideIcon } from "lucide-react";
import { clamp, formatTimecode } from "../animation/frame";
import {
  evaluateAnimatedText,
  evaluateTextAnimation,
} from "../animation/textAnimation";
import {
  createColorTrack,
  createNumericTrack,
  evaluateColorProperty,
  evaluateNumericProperty,
  findKeyframeTrack,
  upsertColorKeyframe,
  upsertNumericKeyframe,
} from "../animation/keyframes";
import type { KeyframeTrack } from "../project/schema";
import type {
  ProjectLayer,
  TemplateProject,
  TextAnimationPreset,
  TextCursorStyle,
  VideoProject,
} from "../project/schema";
import { useEditorStore } from "../store/editorStore";
import type { TransformMode } from "../store/editorStore";
import { useEditorRuntime } from "../store/useEditorRuntime";
import { inspectGlb } from "../model/inspectGlb";
import { loadAssetBlob, saveAsset } from "../persistence/database";
import { SceneCanvas } from "../scene/SceneCanvas";
import { useAssetUrl } from "../model/useAssetUrl";
import { useTheme, type ThemePreference } from "../theme/useTheme";

const icons: Record<ProjectLayer["type"], LucideIcon> = {
  camera: I.Video,
  lighting: I.Sun,
  device: I.Smartphone,
  "screen-media": I.Image,
  text: I.Type,
  image: I.Image,
  background: I.PanelTop,
};
const bgClass = (name: string) => `bg-${name.replace(/ /g, "-").toLowerCase()}`;

export function App() {
  useEditorRuntime();
  const {
    preference: theme,
    setPreference: setTheme,
    resolved: resolvedTheme,
  } = useTheme();
  const project = useEditorStore((s) => s.project),
    videoProject = useEditorStore((s) => s.videoProject),
    frame = useEditorStore((s) => s.currentFrame),
    masterFrame = useEditorStore((s) => s.masterFrame),
    playing = useEditorStore((s) => s.playing),
    selectedId = useEditorStore((s) => s.selectedLayerId),
    tool = useEditorStore((s) => s.activeTool),
    zoom = useEditorStore((s) => s.zoom),
    preview = useEditorStore((s) => s.preview),
    status = useEditorStore((s) => s.saveStatus),
    past = useEditorStore((s) => s.past),
    future = useEditorStore((s) => s.future);
  const update = useEditorStore((s) => s.updateProject),
    setFrame = useEditorStore((s) => s.setFrame),
    setMasterFrame = useEditorStore((s) => s.setMasterFrame),
    setPlaybackScope = useEditorStore((s) => s.setPlaybackScope),
    setPlaying = useEditorStore((s) => s.setPlaying),
    setSelected = useEditorStore((s) => s.setSelectedLayer),
    setTool = useEditorStore((s) => s.setActiveTool),
    setZoom = useEditorStore((s) => s.setZoom),
    setPreview = useEditorStore((s) => s.setPreview),
    undo = useEditorStore((s) => s.undo),
    redo = useEditorStore((s) => s.redo),
    persist = useEditorStore((s) => s.persist),
    addScene = useEditorStore((s) => s.addScene),
    duplicateScene = useEditorStore((s) => s.duplicateScene),
    deleteScene = useEditorStore((s) => s.deleteScene),
    selectScene = useEditorStore((s) => s.selectScene),
    reorderScene = useEditorStore((s) => s.reorderScene),
    trimScene = useEditorStore((s) => s.trimScene),
    splitScene = useEditorStore((s) => s.splitScene);
  const selected =
    project.layers.find((layer) => layer.id === selectedId) ??
    project.layers[0];
  const transformMode = useEditorStore((s) => s.transformMode),
    setTransformMode = useEditorStore((s) => s.setTransformMode),
    autoKey = useEditorStore((s) => s.autoKey),
    setAutoKey = useEditorStore((s) => s.setAutoKey);
  const [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const [frameRequest, setFrameRequest] = useState(0),
    [sceneEditorOpen, setSceneEditorOpen] = useState(false),
    [testingTemplate, setTestingTemplate] = useState(false),
    [exporting, setExporting] = useState(false),
    [themeMenuOpen, setThemeMenuOpen] = useState(false),
    [timelineHeight, setTimelineHeight] = useState(() => {
      const stored = Number(
        localStorage.getItem("renderlaunch-timeline-height"),
      );
      return clamp(
        Number.isFinite(stored) && stored >= 180 ? stored : 266,
        180,
        Math.max(180, Math.floor(window.innerHeight * 0.4)),
      );
    }),
    compositionViewport = useRef<HTMLDivElement>(null),
    [compositionSize, setCompositionSize] = useState({
      width: 640,
      height: 360,
    });
  useLayoutEffect(() => {
    const viewport = compositionViewport.current;
    if (!viewport) return;
    const fitComposition = (width: number, height: number) => {
      const availableWidth = Math.max(1, width - 2),
        availableHeight = Math.max(1, height - 2),
        scale = Math.min(availableWidth / 1280, availableHeight / 720),
        next = {
          width: Math.floor(1280 * scale),
          height: Math.floor(720 * scale),
        };
      setCompositionSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(([entry]) =>
      fitComposition(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(viewport);
    const style = getComputedStyle(viewport);
    fitComposition(
      viewport.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      viewport.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom),
    );
    return () => observer.disconnect();
  }, [sceneEditorOpen]);
  useEffect(() => {
    setPlaybackScope(sceneEditorOpen ? "scene" : "master");
  }, [sceneEditorOpen, setPlaybackScope]);
  useEffect(() => {
    const enforceTimelineLimit = () =>
      setTimelineHeight((height) =>
        Math.min(height, Math.max(180, Math.floor(window.innerHeight * 0.4))),
      );
    window.addEventListener("resize", enforceTimelineLimit);
    return () => window.removeEventListener("resize", enforceTimelineLimit);
  }, []);
  useEffect(() => {
    const togglePlayback = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.getAttribute("role") === "textbox"))
      )
        return;
      event.preventDefault();
      const state = useEditorStore.getState();
      state.setPlaying(!state.playing);
    };
    window.addEventListener("keydown", togglePlayback);
    return () => window.removeEventListener("keydown", togglePlayback);
  }, []);
  useEffect(() => {
    const historyShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const key = event.key.toLowerCase(),
        state = useEditorStore.getState();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (key === "y") {
        event.preventDefault();
        state.redo();
      }
    };
    window.addEventListener("keydown", historyShortcut);
    return () => window.removeEventListener("keydown", historyShortcut);
  }, []);
  const resizeTimeline = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget,
      startY = event.clientY,
      startHeight = timelineHeight,
      pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    document.body.classList.add("resizingTimeline");
    const move = (pointerEvent: globalThis.PointerEvent) =>
      setTimelineHeight(
        clamp(
          startHeight + startY - pointerEvent.clientY,
          180,
          Math.max(180, Math.floor(window.innerHeight * 0.4)),
        ),
      );
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("resizingTimeline");
      setTimelineHeight((height) => {
        localStorage.setItem("renderlaunch-timeline-height", String(height));
        return height;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const replaceModel = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const stats = await inspectGlb(file),
        assetId = await saveAsset(file);
      update((d) => {
        d.model = {
          assetId,
          fileName: file.name,
          fileSize: file.size,
          stats,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: 1,
          pivot: [0, 0, 0],
          frontAxis: "+Z",
          defaultTransform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: 1,
            pivot: [0, 0, 0],
            frontAxis: "+Z",
          },
        };
        d.screen = null;
        if (d.camera) delete d.camera.framedAssetId;
      });
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "The model could not be loaded.",
      );
    } finally {
      setUploading(false);
    }
  };
  if (!sceneEditorOpen)
    return (
      <VideoEditorWorkspace
        videoProject={videoProject}
        project={project}
        frame={frame}
        masterFrame={masterFrame}
        playing={playing}
        onFrame={setFrame}
        onMasterFrame={setMasterFrame}
        onPlay={setPlaying}
        onSelectScene={selectScene}
        onAddScene={() => addScene()}
        onDuplicateScene={() => duplicateScene()}
        onDeleteScene={() => deleteScene(videoProject.activeSceneId)}
        onReorderScene={reorderScene}
        onTrimScene={trimScene}
        onSplitScene={splitScene}
        onOpenScene={() => {
          const active = videoProject.scenes.find(
            (scene) => scene.id === videoProject.activeSceneId,
          );
          setFrame((active?.sourceStartFrame ?? 0) + frame);
          setSceneEditorOpen(true);
        }}
        onSave={() => void persist()}
      />
    );
  return (
    <>
      <main
        aria-hidden={preview || testingTemplate || undefined}
        style={
          { "--timeline-height": `${timelineHeight}px` } as React.CSSProperties
        }
      >
        <header>
          <button
            className="icon"
            aria-label="Back to video editor"
            onClick={() => {
              const active = videoProject.scenes.find(
                (scene) => scene.id === videoProject.activeSceneId,
              );
              setPlaying(false);
              if (active)
                setMasterFrame(
                  videoProject.scenes
                    .filter((scene) => scene.order < active.order)
                    .reduce((sum, scene) => sum + scene.durationInFrames, 0) +
                    clamp(
                      frame - active.sourceStartFrame,
                      0,
                      active.durationInFrames - 1,
                    ),
                );
              setSceneEditorOpen(false);
            }}
          >
            <I.ChevronLeft />
          </button>
          <div className="project">
            <input
              aria-label="Project name"
              value={project.name}
              onChange={(e) =>
                update((d) => {
                  d.name = e.target.value || "Untitled Template";
                })
              }
            />
            <span className={status === "saved" ? "saved" : "saving"} />
            <small>
              {status === "error"
                ? "Save failed"
                : status === "saved"
                  ? "Saved"
                  : status === "saving"
                    ? "Saving…"
                    : "Unsaved"}
            </small>
          </div>
          <div className="history">
            <button aria-label="Undo" disabled={!past.length} onClick={undo}>
              <I.Undo2 />
            </button>
            <button aria-label="Redo" disabled={!future.length} onClick={redo}>
              <I.Redo2 />
            </button>
          </div>
          <button className="ratio">
            16:9 <I.ChevronDown />
          </button>
          <div className="actions">
            <button
              onClick={() => {
                setFrame(0);
                setPlaying(true);
                setPreview(true);
              }}
            >
              <I.Play /> Preview
            </button>
            <button onClick={() => setTestingTemplate(true)}>
              <I.UserRound /> Preview as User
            </button>
            <button onClick={() => setExporting(true)}>
              <I.Download /> Export Preview
            </button>
            <button
              className="primary"
              onClick={() => {
                update((draft) => {
                  draft.thumbnailDataUrl = createTemplateThumbnail(draft);
                });
                void persist();
              }}
            >
              <I.Save /> Save Template
            </button>
          </div>
        </header>
        <section className="editor">
          <nav>
            {(
              [
                ["Model", I.Box],
                ["Media", I.Image],
                ["Text", I.Type],
                ["Scene", I.Layers3],
              ] as const
            ).map(([name, Icon]) => (
              <button
                key={name}
                className={tool === name ? "active" : ""}
                onClick={() => setTool(name)}
              >
                <Icon />
                <span>{name}</span>
              </button>
            ))}
            <button
              className="settings"
              onClick={() => setThemeMenuOpen((value) => !value)}
            >
              <I.Settings />
              <span>Settings</span>
            </button>
            {themeMenuOpen && (
              <ThemeMenu
                preference={theme}
                resolved={resolvedTheme}
                onChange={setTheme}
                onClose={() => setThemeMenuOpen(false)}
              />
            )}
          </nav>
          <aside className="left">
            <h2>{tool === "Model" ? "Layers" : tool}</h2>
            <div className="layerList">
              {project.layers.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  selected={selectedId === layer.id}
                  onSelect={() => setSelected(layer.id)}
                  onToggle={(key) =>
                    update((d) => {
                      const item = d.layers.find((x) => x.id === layer.id)!;
                      item[key] = !item[key];
                    })
                  }
                />
              ))}
            </div>
            <div className="modelCard">
              <div className="cardTitle">
                <h3>Model</h3>
                <I.MoreHorizontal />
              </div>
              <div className="asset">
                <div className="thumb">
                  <Phone mini frame={0} project={project} />
                </div>
                <div>
                  <b>{project.model?.fileName ?? "No model"}</b>
                  <small>
                    {project.model?.fileSize
                      ? `${(project.model.fileSize / 1024 / 1024).toFixed(1)} MB`
                      : "Upload a GLB"}
                  </small>
                  {project.model?.assetId && (
                    <span>
                      <I.CircleCheck /> Model ready
                    </span>
                  )}
                </div>
              </div>
              {project.model?.stats && (
                <div className="modelStats">
                  <span>{project.model.stats.nodes} nodes</span>
                  <span>{project.model.stats.meshes} meshes</span>
                  <span>{project.model.stats.materials} materials</span>
                  <span>{project.model.stats.animations} animations</span>
                  <span>
                    {project.model.stats.triangles.toLocaleString()} triangles
                  </span>
                </div>
              )}
              <label className={`replace ${uploading ? "disabled" : ""}`}>
                <I.Upload />
                {uploading
                  ? "Inspecting…"
                  : project.model?.assetId
                    ? "Replace Model"
                    : "Upload Model"}
                <input
                  hidden
                  type="file"
                  accept=".glb,model/gltf-binary"
                  disabled={uploading}
                  onChange={(e) => {
                    void replaceModel(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {uploadError && (
                <div className="modelError">
                  <I.CircleAlert />
                  {uploadError}
                </div>
              )}
            </div>
          </aside>
          <div className="compositionViewport" ref={compositionViewport}>
            <div
              className={`workspace ${bgClass(project.background.preset)}`}
              style={{
                ...backgroundStyle(project, frame),
                width: compositionSize.width,
                height: compositionSize.height,
              }}
            >
              <div className="canvasGlow" />
              {isLayerActive(project, "phone", frame) &&
              project.model?.assetId ? (
                <SceneCanvas
                  project={project}
                  frame={frame}
                  frameRequest={frameRequest}
                  autoFrame={
                    Boolean(project.model?.assetId) &&
                    project.camera?.framedAssetId !== project.model?.assetId
                  }
                  editable={selectedId === "phone" && !selected.locked}
                  mode={transformMode}
                  selected3DLayerId={
                    selected.type === "text" && selected.is3D
                      ? selected.id
                      : undefined
                  }
                  onTransform={(value) =>
                    update((d) => {
                      if (d.model && autoKey) {
                        const deviceId =
                          d.layers.find((layer) => layer.type === "device")
                            ?.id ?? "phone";
                        if (transformMode === "translate")
                          value.position.forEach((axisValue, index) =>
                            setNumericKeyframe(
                              d,
                              deviceId,
                              `device.position.${["x", "y", "z"][index]}` as
                                | "device.position.x"
                                | "device.position.y"
                                | "device.position.z",
                              frame,
                              axisValue,
                            ),
                          );
                        else if (transformMode === "rotate")
                          value.rotation.forEach((axisValue, index) =>
                            setNumericKeyframe(
                              d,
                              deviceId,
                              `device.rotation.${["x", "y", "z"][index]}` as
                                | "device.rotation.x"
                                | "device.rotation.y"
                                | "device.rotation.z",
                              frame,
                              axisValue,
                            ),
                          );
                        else
                          setNumericKeyframe(
                            d,
                            deviceId,
                            "device.scale",
                            frame,
                            Math.max(0.01, value.scale),
                          );
                      } else if (d.model) {
                        d.model.position = value.position;
                        d.model.rotation = value.rotation;
                        d.model.scale = Math.max(0.01, value.scale);
                      }
                    })
                  }
                  on3DLayerTransform={(layerId, value) =>
                    update((draft) => {
                      const layer = draft.layers.find(
                        (item) => item.id === layerId,
                      );
                      if (!layer) return;
                      if (autoKey) {
                        value.position.forEach((axisValue, index) =>
                          setNumericKeyframe(
                            draft,
                            layerId,
                            `overlay3d.position.${["x", "y", "z"][index]}` as
                              | "overlay3d.position.x"
                              | "overlay3d.position.y"
                              | "overlay3d.position.z",
                            frame,
                            axisValue,
                          ),
                        );
                        value.rotation.forEach((axisValue, index) =>
                          setNumericKeyframe(
                            draft,
                            layerId,
                            `overlay3d.rotation.${["x", "y", "z"][index]}` as
                              | "overlay3d.rotation.x"
                              | "overlay3d.rotation.y"
                              | "overlay3d.rotation.z",
                            frame,
                            axisValue,
                          ),
                        );
                        setNumericKeyframe(
                          draft,
                          layerId,
                          "overlay3d.scale",
                          frame,
                          value.scale,
                        );
                      } else {
                        layer.transform3D.position = value.position;
                        layer.transform3D.rotation = value.rotation;
                        layer.transform3D.scale = value.scale;
                      }
                    })
                  }
                  onCamera={(position, target, reason) =>
                    update((d) => {
                      d.camera ??= {
                        position: [0, 0.6, 4],
                        target: [0, 0, 0],
                        fov: 35,
                        defaultPosition: [0, 0.6, 4],
                        defaultTarget: [0, 0, 0],
                      };
                      if (autoKey && reason === "interaction") {
                        position.forEach((value, axis) =>
                          setNumericKeyframe(
                            d,
                            "camera",
                            `camera.position.${(["x", "y", "z"] as const)[axis]}`,
                            frame,
                            value,
                          ),
                        );
                        target.forEach((value, axis) =>
                          setNumericKeyframe(
                            d,
                            "camera",
                            `camera.target.${(["x", "y", "z"] as const)[axis]}`,
                            frame,
                            value,
                          ),
                        );
                      } else {
                        d.camera.position = position;
                        d.camera.target = target;
                      }
                      if (reason === "frame" && d.model?.assetId) {
                        d.camera.framedAssetId = d.model.assetId;
                      }
                    })
                  }
                />
              ) : (
                isLayerActive(project, "phone", frame) && (
                  <div className={selectedId === "phone" ? "selectionBox" : ""}>
                    <Phone frame={frame} project={project} />
                    {selectedId === "phone" &&
                      [0, 1, 2, 3].map((i) => (
                        <i className={`handle h${i}`} key={i} />
                      ))}
                  </div>
                )
              )}
              <OverlayStage
                project={project}
                frame={frame}
                selectedId={selectedId}
                update={update}
                onSelect={setSelected}
              />
              <CompositionTools
                tool={tool}
                project={project}
                update={update}
                onSelect={setSelected}
              />
              <div className="canvasControls">
                <button onClick={() => setZoom(zoom - 5)}>
                  <I.Minus />
                </button>
                <b>{zoom}%</b>
                <button onClick={() => setZoom(zoom + 5)}>
                  <I.Plus />
                </button>
                <em />
                <button>
                  <I.Hand />
                </button>
                <em />
                <button onClick={() => setPlaying(!playing)}>
                  {playing ? <I.Pause /> : <I.Play />}
                </button>
                <button
                  title="Frame model"
                  onClick={() => setFrameRequest((value) => value + 1)}
                >
                  <I.Scan />
                </button>
              </div>
            </div>
          </div>
          <Inspector
            project={project}
            layer={selected}
            frame={frame}
            update={update}
            mode={transformMode}
            setMode={setTransformMode}
          />
        </section>
        <Timeline
          project={project}
          frame={frame}
          playing={playing}
          selectedId={selectedId}
          autoKey={autoKey}
          update={update}
          onFrame={setFrame}
          onPlay={setPlaying}
          onSelect={setSelected}
          onAutoKey={setAutoKey}
          onResizeStart={resizeTimeline}
        />
        {exporting && (
          <ExportDialog project={project} onClose={() => setExporting(false)} />
        )}
      </main>
      {testingTemplate && (
        <UserPreview
          template={project}
          frame={frame}
          playing={playing}
          onFrame={setFrame}
          onPlay={setPlaying}
          onClose={() => {
            setPlaying(false);
            setTestingTemplate(false);
          }}
        />
      )}
      {preview && (
        <Preview
          project={project}
          frame={frame}
          playing={playing}
          onFrame={setFrame}
          onPlay={setPlaying}
          onClose={() => {
            setPlaying(false);
            setPreview(false);
          }}
        />
      )}
    </>
  );
}

function VideoEditorWorkspace({
  videoProject,
  project,
  frame,
  masterFrame,
  playing,
  onFrame,
  onMasterFrame,
  onPlay,
  onSelectScene,
  onAddScene,
  onDuplicateScene,
  onDeleteScene,
  onReorderScene,
  onTrimScene,
  onSplitScene,
  onOpenScene,
  onSave,
}: {
  videoProject: VideoProject;
  project: TemplateProject;
  frame: number;
  masterFrame: number;
  playing: boolean;
  onFrame: (frame: number) => void;
  onMasterFrame: (frame: number) => void;
  onPlay: (playing: boolean) => void;
  onSelectScene: (sceneId: string) => void;
  onAddScene: () => void;
  onDuplicateScene: () => void;
  onDeleteScene: () => void;
  onReorderScene: (sceneId: string, targetIndex: number) => void;
  onTrimScene: (
    sceneId: string,
    sourceStartFrame: number,
    durationInFrames: number,
  ) => void;
  onSplitScene: (sceneId: string, offsetFrame: number) => void;
  onOpenScene: () => void;
  onSave: () => void;
}) {
  const [masterZoom, setMasterZoom] = useState(1),
    [draggedSceneId, setDraggedSceneId] = useState<string>(),
    [trimPreview, setTrimPreview] = useState<{
      id: string;
      sourceStartFrame: number;
      durationInFrames: number;
    }>();
  const scenes = [...videoProject.scenes]
      .sort((a, b) => a.order - b.order)
      .map((scene) => ({
        ...scene,
        sourceStartFrame: Number.isFinite(scene.sourceStartFrame)
          ? scene.sourceStartFrame
          : 0,
        durationInFrames: Number.isFinite(scene.durationInFrames)
          ? scene.durationInFrames
          : scene.composition.canvas.durationInFrames,
      })),
    activeScene =
      scenes.find((scene) => scene.id === videoProject.activeSceneId) ??
      scenes[0],
    totalFrames = scenes.reduce(
      (sum, scene) => sum + scene.durationInFrames,
      0,
    ),
    framesBeforeActive = scenes
      .slice(
        0,
        scenes.findIndex((scene) => scene.id === activeScene.id),
      )
      .reduce((sum, scene) => sum + scene.durationInFrames, 0),
    visibleFrame = Math.min(frame, activeScene.durationInFrames - 1),
    renderFrame = activeScene.sourceStartFrame + visibleFrame,
    expectedMasterFrame = framesBeforeActive + visibleFrame,
    shownMasterFrame = Number.isFinite(masterFrame)
      ? masterFrame
      : expectedMasterFrame;
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]"))
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        onDuplicateScene();
      } else if (event.key === "Delete" && scenes.length > 1) {
        event.preventDefault();
        onDeleteScene();
      } else if (
        event.key.toLowerCase() === "s" &&
        !event.ctrlKey &&
        !event.metaKey &&
        visibleFrame > 0
      ) {
        event.preventDefault();
        onSplitScene(activeScene.id, visibleFrame);
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });
  const seekMasterFrame = (nextMasterFrame: number) => {
    let cursor = 0;
    for (const scene of scenes) {
      const end = cursor + scene.durationInFrames;
      if (nextMasterFrame < end || scene === scenes[scenes.length - 1]) {
        onMasterFrame(nextMasterFrame);
        return;
      }
      cursor = end;
    }
  };
  const beginTrim = (
    event: React.PointerEvent<HTMLButtonElement>,
    scene: (typeof scenes)[number],
    edge: "left" | "right",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget,
      timeline = target.closest<HTMLElement>(".masterTimeline")!,
      timelineWidth = timeline.getBoundingClientRect().width,
      startX = event.clientX,
      originalStart = scene.sourceStartFrame,
      originalDuration = scene.durationInFrames;
    target.setPointerCapture(event.pointerId);
    const move = (pointerEvent: globalThis.PointerEvent) => {
      const delta = Math.round(
        ((pointerEvent.clientX - startX) / Math.max(1, timelineWidth)) *
          totalFrames,
      );
      if (edge === "left") {
        const applied = Math.round(
          clamp(delta, -originalStart, originalDuration - 1),
        );
        setTrimPreview({
          id: scene.id,
          sourceStartFrame: originalStart + applied,
          durationInFrames: originalDuration - applied,
        });
      } else {
        setTrimPreview({
          id: scene.id,
          sourceStartFrame: originalStart,
          durationInFrames: Math.round(
            clamp(
              originalDuration + delta,
              1,
              scene.composition.canvas.durationInFrames - originalStart,
            ),
          ),
        });
      }
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setTrimPreview((preview) => {
        if (preview?.id === scene.id)
          onTrimScene(
            scene.id,
            preview.sourceStartFrame,
            preview.durationInFrames,
          );
        return undefined;
      });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };
  return (
    <main className="videoEditorWorkspace">
      <header className="videoEditorHeader">
        <div className="videoProjectIdentity">
          <I.Clapperboard />
          <div>
            <b>{videoProject.name}</b>
            <small>
              {scenes.length} scene{scenes.length === 1 ? "" : "s"} ·{" "}
              {formatTimecode(totalFrames, videoProject.canvas.fps)}
            </small>
          </div>
        </div>
        <div className="actions">
          <button onClick={onOpenScene}>
            <I.SquarePen /> Open Scene Editor
          </button>
          <button className="primary" onClick={onSave}>
            <I.Save /> Save Video Project
          </button>
        </div>
      </header>
      <section className="videoEditorBody">
        <aside className="sceneBin">
          <div className="sceneBinHead">
            <div>
              <h2>Scenes</h2>
              <small>Storyboard</small>
            </div>
            <button title="Add scene" onClick={onAddScene}>
              <I.Plus />
            </button>
          </div>
          <div className="sceneCards">
            {scenes.map((scene, index) => (
              <button
                key={scene.id}
                className={`sceneCard ${scene.id === activeScene.id ? "active" : ""}`}
                onClick={() => onSelectScene(scene.id)}
                onDoubleClick={onOpenScene}
              >
                <div
                  className={`sceneThumbnail ${bgClass(scene.composition.background.preset)}`}
                  style={backgroundStyle(scene.composition, 0)}
                >
                  {scene.thumbnailDataUrl ||
                  scene.composition.thumbnailDataUrl ? (
                    <img
                      src={
                        scene.thumbnailDataUrl ??
                        scene.composition.thumbnailDataUrl
                      }
                      alt=""
                    />
                  ) : (
                    <I.Box />
                  )}
                  <span>{index + 1}</span>
                </div>
                <div className="sceneCardInfo">
                  <b>{scene.name}</b>
                  <small>
                    {formatTimecode(
                      scene.durationInFrames,
                      scene.composition.canvas.fps,
                    )}
                  </small>
                </div>
                <I.ChevronRight />
              </button>
            ))}
          </div>
          <div className="sceneActions">
            <button onClick={onDuplicateScene}>
              <I.Copy /> Duplicate
            </button>
            <button
              className="danger"
              disabled={scenes.length === 1}
              onClick={onDeleteScene}
            >
              <I.Trash2 /> Delete
            </button>
          </div>
        </aside>
        <section className="masterPreviewPanel">
          <div className="masterPreviewHead">
            <div>
              <small>SELECTED SCENE</small>
              <h2>{activeScene.name}</h2>
            </div>
            <button onClick={onOpenScene}>
              <I.SquarePen /> Edit Scene
            </button>
          </div>
          <div
            className={`masterPreviewStage ${bgClass(project.background.preset)}`}
            style={backgroundStyle(project, renderFrame)}
          >
            <div className="canvasGlow" />
            {project.model?.assetId ? (
              isLayerActive(project, "phone", renderFrame) && (
                <SceneCanvas
                  project={project}
                  frame={renderFrame}
                  autoFrame={false}
                  cameraControls={false}
                />
              )
            ) : (
              <Phone frame={renderFrame} project={project} />
            )}
            <PreviewOverlays project={project} frame={renderFrame} />
          </div>
          <div className="masterPreviewControls">
            <button onClick={() => onPlay(!playing)}>
              {playing ? <I.Pause /> : <I.Play />}
            </button>
            <input
              type="range"
              min="0"
              max={activeScene.durationInFrames - 1}
              value={visibleFrame}
              onChange={(event) =>
                onMasterFrame(framesBeforeActive + Number(event.target.value))
              }
            />
            <b>
              {formatTimecode(visibleFrame, project.canvas.fps)} /{" "}
              {formatTimecode(activeScene.durationInFrames, project.canvas.fps)}
            </b>
          </div>
        </section>
      </section>
      <section className="masterTimelinePanel">
        <div className="masterTimelineHead">
          <div>
            <b>Master Timeline</b>
            <small>Scene assembly</small>
          </div>
          <div className="masterTimelineTools">
            <button
              title="Split selected scene at playhead"
              disabled={
                visibleFrame <= 0 ||
                visibleFrame >= activeScene.durationInFrames
              }
              onClick={() => onSplitScene(activeScene.id, visibleFrame)}
            >
              <I.Scissors /> Split
            </button>
            <button
              onClick={() =>
                setMasterZoom((value) => Math.max(1, value - 0.25))
              }
            >
              <I.Minus />
            </button>
            <input
              aria-label="Master timeline zoom"
              type="range"
              min="1"
              max="4"
              step=".25"
              value={masterZoom}
              onChange={(event) => setMasterZoom(Number(event.target.value))}
            />
            <button
              onClick={() =>
                setMasterZoom((value) => Math.min(4, value + 0.25))
              }
            >
              <I.Plus />
            </button>
            <span>
              {formatTimecode(shownMasterFrame, videoProject.canvas.fps)} /{" "}
              {formatTimecode(totalFrames, videoProject.canvas.fps)}
            </span>
          </div>
        </div>
        <div className="masterTimelineViewport">
          <div
            className="masterTimeline"
            style={{ width: `${masterZoom * 100}%` }}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest(".masterSceneClip"))
                return;
              const rect = event.currentTarget.getBoundingClientRect();
              seekMasterFrame(
                clamp(
                  ((event.clientX - rect.left) / rect.width) * totalFrames,
                  0,
                  totalFrames - 1,
                ),
              );
            }}
          >
            <div
              className="masterPlayhead"
              style={{
                left: `${(shownMasterFrame / Math.max(1, totalFrames)) * 100}%`,
              }}
            />
            {scenes.map((scene, index) => {
              const preview =
                trimPreview?.id === scene.id ? trimPreview : scene;
              return (
                <div
                  key={scene.id}
                  draggable
                  className={`masterSceneClip ${scene.id === activeScene.id ? "active" : ""}`}
                  style={{
                    width: `${(preview.durationInFrames / totalFrames) * 100}%`,
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const sceneStart = scenes
                      .slice(0, index)
                      .reduce((sum, item) => sum + item.durationInFrames, 0);
                    onMasterFrame(
                      sceneStart +
                        clamp(
                          ((event.clientX - rect.left) / rect.width) *
                            scene.durationInFrames,
                          0,
                          scene.durationInFrames - 1,
                        ),
                    );
                  }}
                  onDoubleClick={onOpenScene}
                  onDragStart={(event) => {
                    setDraggedSceneId(scene.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedSceneId) onReorderScene(draggedSceneId, index);
                    setDraggedSceneId(undefined);
                  }}
                  onDragEnd={() => setDraggedSceneId(undefined)}
                >
                  <button
                    className="masterTrimHandle left"
                    title="Trim scene start"
                    onPointerDown={(event) => beginTrim(event, scene, "left")}
                  />
                  <span>Scene {index + 1}</span>
                  <b>{scene.name}</b>
                  <small>
                    {formatTimecode(
                      preview.durationInFrames,
                      scene.composition.canvas.fps,
                    )}
                  </small>
                  <button
                    className="masterTrimHandle right"
                    title="Trim scene end"
                    onPointerDown={(event) => beginTrim(event, scene, "right")}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function LayerRow({
  layer,
  selected,
  onSelect,
  onToggle,
}: {
  layer: ProjectLayer;
  selected: boolean;
  onSelect: () => void;
  onToggle: (key: "visible" | "locked" | "replaceable") => void;
}) {
  const Icon = icons[layer.type];
  return (
    <div className={`layer ${selected ? "selected" : ""}`} onClick={onSelect}>
      <I.GripVertical className="grip" />
      <Icon />
      <span>{layer.name}</span>
      <button
        aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle("visible");
        }}
      >
        {layer.visible ? <I.Eye /> : <I.EyeOff />}
      </button>
      <button
        className={layer.replaceable ? "replaceableOn" : ""}
        aria-label={`${layer.replaceable ? "Make fixed" : "Make replaceable"} ${layer.name}`}
        title={layer.replaceable ? "Replaceable in user preview" : "Fixed"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle("replaceable");
        }}
      >
        <I.Tag />
      </button>
      <button
        aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle("locked");
        }}
      >
        {layer.locked ? <I.Lock /> : <I.Unlock />}
      </button>
      <I.MoreVertical />
    </div>
  );
}

function ThemeMenu({
  preference,
  resolved,
  onChange,
  onClose,
}: {
  preference: ThemePreference;
  resolved: "light" | "dark";
  onChange: (theme: ThemePreference) => void;
  onClose: () => void;
}) {
  const options: Array<{
    value: ThemePreference;
    label: string;
    Icon: LucideIcon;
  }> = [
    { value: "light", label: "Light", Icon: I.Sun },
    { value: "dark", label: "Dark", Icon: I.Moon },
    { value: "system", label: "System", Icon: I.Monitor },
  ];
  return (
    <div className="themeMenu" role="dialog" aria-label="Appearance settings">
      <div className="themeMenuHead">
        <div>
          <b>Appearance</b>
          <small>Currently using {resolved} mode</small>
        </div>
        <button aria-label="Close appearance settings" onClick={onClose}>
          <I.X />
        </button>
      </div>
      <div className="themeOptions">
        {options.map(({ value, label, Icon }) => (
          <button
            key={value}
            className={preference === value ? "on" : ""}
            onClick={() => onChange(value)}
          >
            <Icon />
            <span>{label}</span>
            {preference === value && <I.Check />}
          </button>
        ))}
      </div>
      <p>
        Theme changes affect the editor only, not your composition or export.
      </p>
    </div>
  );
}

function Inspector({
  project,
  layer,
  frame,
  update,
  mode,
  setMode,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
  frame: number;
  update: (recipe: (draft: TemplateProject) => void) => void;
  mode: TransformMode;
  setMode: (mode: TransformMode) => void;
}) {
  const rotation = project.model?.rotation ?? [0, 0, 0],
    [mediaUploading, setMediaUploading] = useState(false),
    [mediaError, setMediaError] = useState("");
  const uploadMedia = async (file?: File) => {
    if (!file) return;
    setMediaUploading(true);
    setMediaError("");
    try {
      const mediaType = await validateMedia(file),
        assetId = await saveAsset(file);
      update((d) => {
        const screen = ensureScreen(d);
        screen.mediaAssetId = assetId;
        screen.mediaFileName = file.name;
        screen.mediaType = mediaType;
        screen.testPattern = false;
      });
    } catch (error) {
      setMediaError(
        error instanceof Error
          ? error.message
          : "The media could not be loaded.",
      );
    } finally {
      setMediaUploading(false);
    }
  };
  if (layer.type === "camera")
    return <CameraInspector project={project} frame={frame} update={update} />;
  if (layer.type === "lighting")
    return (
      <LightingInspector project={project} frame={frame} update={update} />
    );
  if (layer.type === "background")
    return (
      <BackgroundInspector project={project} frame={frame} update={update} />
    );
  if (layer.type === "text" || layer.type === "image")
    return (
      <OverlayInspectorV2
        project={project}
        layer={layer}
        frame={frame}
        update={update}
        mode={mode}
        setMode={setMode}
      />
    );
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>{layer.name}</h2>
        <I.MoreHorizontal />
      </div>
      <InspectorKeyframes
        project={project}
        layer={layer}
        frame={frame}
        update={update}
      />
      <Panel title="Direct Controls">
        <div className="transformModes">
          <button
            className={mode === "translate" ? "on" : ""}
            onClick={() => setMode("translate")}
          >
            <I.Move3d /> Move
          </button>
          <button
            className={mode === "rotate" ? "on" : ""}
            onClick={() => setMode("rotate")}
          >
            <I.Rotate3d /> Rotate
          </button>
          <button
            className={mode === "scale" ? "on" : ""}
            onClick={() => setMode("scale")}
          >
            <I.Maximize2 /> Scale
          </button>
        </div>
      </Panel>
      <Panel title="Transform">
        <label>Position</label>
        <div className="triple">
          {["X", "Y", "Z"].map((axis, i) => (
            <Field
              key={axis}
              label={axis}
              value={project.model?.position[i] ?? 0}
              onChange={(value) =>
                update((d) => {
                  if (d.model) d.model.position[i] = value;
                })
              }
            />
          ))}
        </div>
        <label>Rotation</label>
        <div className="triple">
          {["X", "Y", "Z"].map((axis, i) => (
            <Field
              key={axis}
              label={axis}
              value={rotation[i]}
              suffix="°"
              onChange={(value) =>
                update((d) => {
                  if (d.model) d.model.rotation[i] = value;
                })
              }
            />
          ))}
        </div>
        <label>Scale</label>
        <div className="triple">
          <Field
            label="S"
            value={project.model?.scale ?? 1}
            onChange={(value) =>
              update((d) => {
                if (d.model) d.model.scale = Math.max(0.01, value);
              })
            }
          />
        </div>
      </Panel>
      <Panel title="Screen">
        <div className="screenModes">
          <button
            className={
              (project.screen?.mode ?? "material") === "material" ? "on" : ""
            }
            onClick={() =>
              update((d) => {
                ensureScreen(d).mode = "material";
              })
            }
          >
            <I.Layers3 /> Material
          </button>
          <button
            className={project.screen?.mode === "plane" ? "on" : ""}
            onClick={() =>
              update((d) => {
                ensureScreen(d).mode = "plane";
              })
            }
          >
            <I.Square /> Screen Plane
          </button>
        </div>
        {(project.screen?.mode ?? "material") === "material" && (
          <Select
            label="Material"
            value={
              project.screen?.materialName ??
              project.model?.stats?.materialNames[0] ??
              "No materials"
            }
            options={
              project.model?.stats?.materialNames.length
                ? project.model.stats.materialNames
                : ["No materials"]
            }
            onChange={(value) =>
              update((d) => {
                const screen = ensureScreen(d);
                screen.materialName = value;
                screen.testPattern = true;
              })
            }
          />
        )}
        <div className="screenActions">
          <button
            onClick={() =>
              update((d) => {
                const screen = ensureScreen(d);
                screen.testPattern = !screen.testPattern;
              })
            }
          >
            <I.Grid3X3 />{" "}
            {project.screen?.testPattern ? "Hide Test" : "Test Pattern"}
          </button>
          <label>
            <I.Upload />
            {mediaUploading ? "Loading…" : "Upload Media"}
            <input
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
              disabled={mediaUploading}
              onChange={(e) => {
                void uploadMedia(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {project.screen?.mediaFileName && (
          <div className="mappedMedia">
            <I.CircleCheck />
            <span>{project.screen.mediaFileName}</span>
            <small>{project.screen.mediaType}</small>
          </div>
        )}
        {mediaError && (
          <div className="modelError">
            <I.CircleAlert />
            {mediaError}
          </div>
        )}
        <div className="row">
          <label>Fit Mode</label>
          <div className="segments">
            {(["fill", "fit", "stretch"] as const).map((value) => (
              <button
                key={value}
                className={project.screen?.fit === value ? "on" : ""}
                onClick={() =>
                  update((d) => {
                    ensureScreen(d).fit = value;
                  })
                }
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="screenToggle">
          <label>
            <input
              type="checkbox"
              checked={project.screen?.flipY ?? false}
              onChange={(e) =>
                update((d) => {
                  ensureScreen(d).flipY = e.target.checked;
                })
              }
            />{" "}
            Flip vertically
          </label>
        </div>
        <label>Texture Alignment</label>
        <div className="triple">
          <Field
            label="Rot"
            suffix="°"
            value={project.screen?.rotation ?? 0}
            onChange={(value) =>
              update((d) => {
                ensureScreen(d).rotation = value;
              })
            }
          />
          <Field
            label="X"
            value={project.screen?.offset[0] ?? 0}
            onChange={(value) =>
              update((d) => {
                ensureScreen(d).offset[0] = value;
              })
            }
          />
          <Field
            label="Y"
            value={project.screen?.offset[1] ?? 0}
            onChange={(value) =>
              update((d) => {
                ensureScreen(d).offset[1] = value;
              })
            }
          />
        </div>
        <div className="row">
          <label>Brightness</label>
          <input
            type="range"
            min="0"
            max="3"
            step=".05"
            value={project.screen?.emissionIntensity ?? 1}
            onChange={(e) =>
              update((d) => {
                ensureScreen(d).emissionIntensity = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">
            {(project.screen?.emissionIntensity ?? 1).toFixed(1)}
          </div>
        </div>
        {project.screen?.mode === "plane" && (
          <>
            <label>Plane Position</label>
            <div className="triple">
              {["X", "Y", "Z"].map((axis, i) => (
                <Field
                  key={axis}
                  label={axis}
                  value={project.screen?.planePosition[i] ?? [0, 1, 0.02][i]}
                  onChange={(value) =>
                    update((d) => {
                      ensureScreen(d).planePosition[i] = value;
                    })
                  }
                />
              ))}
            </div>
            <label>Plane Rotation</label>
            <div className="triple">
              {["X", "Y", "Z"].map((axis, i) => (
                <Field
                  key={axis}
                  label={axis}
                  suffix="°"
                  value={project.screen?.planeRotation[i] ?? 0}
                  onChange={(value) =>
                    update((d) => {
                      ensureScreen(d).planeRotation[i] = value;
                    })
                  }
                />
              ))}
            </div>
            <label>Plane Size</label>
            <div className="triple">
              <Field
                label="W"
                value={project.screen?.planeSize[0] ?? 0.9}
                onChange={(value) =>
                  update((d) => {
                    ensureScreen(d).planeSize[0] = Math.max(0.01, value);
                  })
                }
              />
              <Field
                label="H"
                value={project.screen?.planeSize[1] ?? 1.8}
                onChange={(value) =>
                  update((d) => {
                    ensureScreen(d).planeSize[1] = Math.max(0.01, value);
                  })
                }
              />
            </div>
          </>
        )}
      </Panel>
      <Panel title="Normalization">
        <Select
          label="Front"
          value={project.model?.frontAxis ?? "+Z"}
          options={["+Z", "-Z", "+X", "-X", "+Y", "-Y"]}
          onChange={(value) =>
            update((d) => {
              if (d.model)
                d.model.frontAxis = value as NonNullable<
                  TemplateProject["model"]
                >["frontAxis"];
            })
          }
        />
        <label>Animation Pivot</label>
        <div className="triple">
          {["X", "Y", "Z"].map((axis, i) => (
            <Field
              key={axis}
              label={axis}
              value={project.model?.pivot[i] ?? 0}
              onChange={(value) =>
                update((d) => {
                  if (d.model) d.model.pivot[i] = value;
                })
              }
            />
          ))}
        </div>
        <div className="normalizationActions">
          <button
            onClick={() =>
              update((d) => {
                if (d.model) d.model.position[1] = 0;
              })
            }
          >
            <I.ArrowDownToLine /> Place on ground
          </button>
          <button
            onClick={() =>
              update((d) => {
                if (!d.model) return;
                d.model.position = [0, 0, 0];
                d.model.rotation = [0, 0, 0];
                d.model.scale = 1;
                d.model.pivot = [0, 0, 0];
              })
            }
          >
            <I.RefreshCcw /> Reset transform
          </button>
          <button
            onClick={() =>
              update((d) => {
                if (!d.model) return;
                d.model.defaultTransform = {
                  position: [...d.model.position],
                  rotation: [...d.model.rotation],
                  scale: d.model.scale,
                  pivot: [...d.model.pivot],
                  frontAxis: d.model.frontAxis,
                };
                if (d.camera) {
                  d.camera.defaultPosition = [...d.camera.position];
                  d.camera.defaultTarget = [...d.camera.target];
                }
              })
            }
          >
            <I.BookmarkCheck /> Save default view
          </button>
          <button
            disabled={!project.model?.defaultTransform}
            onClick={() =>
              update((d) => {
                const saved = d.model?.defaultTransform;
                if (!d.model || !saved) return;
                d.model.position = [...saved.position];
                d.model.rotation = [...saved.rotation];
                d.model.scale = saved.scale;
                d.model.pivot = [...saved.pivot];
                d.model.frontAxis = saved.frontAxis;
                if (d.camera) {
                  d.camera.position = [...d.camera.defaultPosition];
                  d.camera.target = [...d.camera.defaultTarget];
                }
              })
            }
          >
            <I.History /> Restore default
          </button>
        </div>
      </Panel>
      <Panel title="Appearance" collapsed>
        <Select
          label="Background"
          value={project.background.preset}
          options={["Soft Blue", "Lilac Glow", "Midnight Studio"]}
          onChange={(value) =>
            update((d) => {
              d.background.preset =
                value as TemplateProject["background"]["preset"];
            })
          }
        />
      </Panel>
      {project.model?.stats && (
        <MaterialBrowser names={project.model.stats.materialNames} />
      )}
    </aside>
  );
}

function Phone({
  project,
  mini = false,
}: {
  frame: number;
  project: TemplateProject;
  mini?: boolean;
}) {
  const rotation = project.model?.rotation ?? [0, 0, 0];
  return (
    <div
      className={`phone ${mini ? "mini" : ""}`}
      style={{
        transform: `perspective(900px) rotateX(${rotation[0]}deg) rotateY(${rotation[1]}deg) rotateZ(${rotation[2] - 7}deg) scale(${project.model?.scale ?? 1})`,
      }}
    >
      <div className="speaker" />
      <div className="screen">
        <div className="status">
          <b>9:41</b>
          <span>● ◒</span>
        </div>
        <div className="hello">
          <span>Hello, Alex</span>
          <i />
        </div>
        <small>Welcome back</small>
        <div className="balance">
          <small>Total balance</small>
          <strong>
            $24,850<sup>.50</sup>
          </strong>
          <mark>▲ 8.5% vs last month</mark>
        </div>
        <div className="chart">
          <b>Overview</b>
          <svg viewBox="0 0 200 85">
            <path d="M0 70 C20 70 18 48 35 54 S48 31 65 45 S80 60 96 31 S115 21 126 43 S145 51 151 24 S168 37 177 8 S190 12 200 0" />
          </svg>
        </div>
        <b className="cat">Top Categories</b>
        {["Shopping", "Travel", "Food & Drinks", "Entertainment"].map(
          (name, i) => (
            <div className="category" key={name}>
              <i
                style={{
                  background: ["#7c4dff", "#1597ff", "#20c997", "#ef476f"][i],
                }}
              />
              <span>{name}</span>
              <b>${[6420, 4210, 3130, 2450][i]}.40</b>
            </div>
          ),
        )}
        <div className="dock">
          <I.Home />
          <I.CreditCard />
          <I.BarChart3 />
          <I.User />
        </div>
      </div>
    </div>
  );
}

function Timeline({
  project,
  frame,
  playing,
  selectedId,
  autoKey,
  update,
  onFrame,
  onPlay,
  onSelect,
  onAutoKey,
  onResizeStart,
}: {
  project: TemplateProject;
  frame: number;
  playing: boolean;
  selectedId: string;
  autoKey: boolean;
  update: (recipe: (draft: TemplateProject) => void) => void;
  onFrame: (frame: number) => void;
  onPlay: (playing: boolean) => void;
  onSelect: (id: string) => void;
  onAutoKey: (enabled: boolean) => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  type KeyframeSelection = { trackId: string; keyframeId: string };
  const duration = project.canvas.durationInFrames,
    seconds = duration / project.canvas.fps,
    [zoom, setZoom] = useState(1),
    [selectedKeyframes, setSelectedKeyframes] = useState<KeyframeSelection[]>(
      [],
    ),
    [marquee, setMarquee] = useState<{
      left: number;
      top: number;
      width: number;
      height: number;
    }>(),
    ticks = useMemo(
      () =>
        Array.from(
          { length: Math.ceil(seconds / (zoom >= 2 ? 1 : 2)) },
          (_, i) => i * (zoom >= 2 ? 1 : 2),
        ),
      [seconds, zoom],
    );
  const selectedKeyframe = selectedKeyframes[selectedKeyframes.length - 1],
    selectedTrack = project.keyframeTracks.find(
      (track) => track.id === selectedKeyframe?.trackId,
    ),
    selectedKey = selectedTrack?.keyframes.find(
      (keyframe) => keyframe.id === selectedKeyframe?.keyframeId,
    ),
    selectedTrackKeyframes = selectedTrack
      ? [...selectedTrack.keyframes].sort((a, b) => a.frame - b.frame)
      : [],
    selectedTrackIndex = selectedKey
      ? selectedTrackKeyframes.findIndex(
          (keyframe) => keyframe.id === selectedKey.id,
        )
      : -1;
  const scrub = (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const target = event.currentTarget;
    let animationFrame = 0,
      pendingX = event.clientX;
    const updateFrame = (clientX: number) => {
      pendingX = clientX;
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        onFrame(((pendingX - rect.left) / rect.width) * duration);
      });
    };
    const move = (pointerEvent: globalThis.PointerEvent) =>
      updateFrame(pointerEvent.clientX);
    const end = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        onFrame(((pendingX - rect.left) / rect.width) * duration);
      }
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.setPointerCapture(event.pointerId);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
    updateFrame(event.clientX);
  };
  const selectKeyframe = (value: KeyframeSelection, additive = false) =>
    setSelectedKeyframes((current) => {
      const exists = current.some(
        (item) =>
          item.trackId === value.trackId &&
          item.keyframeId === value.keyframeId,
      );
      if (!additive) return [value];
      return exists
        ? current.filter(
            (item) =>
              item.trackId !== value.trackId ||
              item.keyframeId !== value.keyframeId,
          )
        : [...current, value];
    });
  const deleteSelectedKeyframes = () => {
    if (!selectedKeyframes.length) return;
    const selected = new Set(
      selectedKeyframes.map((item) => `${item.trackId}:${item.keyframeId}`),
    );
    update((draft) => {
      draft.keyframeTracks.forEach((track) => {
        track.keyframes = track.keyframes.filter(
          (keyframe) => !selected.has(`${track.id}:${keyframe.id}`),
        ) as typeof track.keyframes;
      });
    });
    setSelectedKeyframes([]);
  };
  useEffect(() => {
    const remove = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]"))
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        const all = project.keyframeTracks.flatMap((track) =>
          track.keyframes.map((keyframe) => ({
            trackId: track.id,
            keyframeId: keyframe.id,
          })),
        );
        event.preventDefault();
        setSelectedKeyframes(all);
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!selectedKeyframes.length) return;
      event.preventDefault();
      deleteSelectedKeyframes();
    };
    window.addEventListener("keydown", remove);
    return () => window.removeEventListener("keydown", remove);
  });
  const beginSurfaceInteraction = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, .clip, .ruler, .trackLabel")) return;
    event.preventDefault();
    const surface = event.currentTarget,
      surfaceRect = surface.getBoundingClientRect(),
      startX = event.clientX,
      startY = event.clientY,
      initialSelection = event.shiftKey ? selectedKeyframes : [];
    let moved = false;
    surface.setPointerCapture(event.pointerId);
    const move = (pointerEvent: globalThis.PointerEvent) => {
      const deltaX = pointerEvent.clientX - startX,
        deltaY = pointerEvent.clientY - startY;
      if (!moved && Math.hypot(deltaX, deltaY) < 4) return;
      moved = true;
      const selectionRect = {
        left: Math.min(startX, pointerEvent.clientX) - surfaceRect.left,
        top: Math.min(startY, pointerEvent.clientY) - surfaceRect.top,
        width: Math.abs(deltaX),
        height: Math.abs(deltaY),
      };
      setMarquee(selectionRect);
      const right = selectionRect.left + selectionRect.width,
        bottom = selectionRect.top + selectionRect.height,
        found = Array.from(
          surface.querySelectorAll<HTMLElement>(".keyframeDiamond"),
        )
          .filter((diamond) => {
            const rect = diamond.getBoundingClientRect(),
              centerX = rect.left + rect.width / 2 - surfaceRect.left,
              centerY = rect.top + rect.height / 2 - surfaceRect.top;
            return (
              centerX >= selectionRect.left &&
              centerX <= right &&
              centerY >= selectionRect.top &&
              centerY <= bottom
            );
          })
          .map((diamond) => ({
            trackId: diamond.dataset.trackId!,
            keyframeId: diamond.dataset.keyframeId!,
          }));
      const combined = [...initialSelection, ...found].filter(
        (item, index, values) =>
          values.findIndex(
            (other) =>
              other.trackId === item.trackId &&
              other.keyframeId === item.keyframeId,
          ) === index,
      );
      setSelectedKeyframes(combined);
    };
    const end = (pointerEvent: globalThis.PointerEvent) => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", end);
      surface.removeEventListener("pointercancel", end);
      setMarquee(undefined);
      if (!moved) {
        if (!event.shiftKey) setSelectedKeyframes([]);
        const lane = surface.querySelector<HTMLElement>(".keyframeLane");
        if (lane) {
          const rect = lane.getBoundingClientRect();
          onFrame(
            clamp(
              ((pointerEvent.clientX - rect.left - 10) /
                Math.max(1, rect.width - 20)) *
                duration,
              0,
              duration - 1,
            ),
          );
        }
      }
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", end);
    surface.addEventListener("pointercancel", end);
  };
  return (
    <footer>
      <div
        className="timelineResizeHandle"
        title="Drag to resize the timeline"
        onPointerDown={onResizeStart}
      >
        <i />
      </div>
      <div className="timeHead">
        <button onClick={() => onPlay(!playing)}>
          {playing ? <I.Pause /> : <I.Play />}
        </button>
        <button
          title="Restart"
          onClick={() => {
            onPlay(false);
            onFrame(0);
          }}
        >
          <I.RotateCcw />
        </button>
        <b>{formatTimecode(frame, project.canvas.fps)}</b>
        <span>/ {formatTimecode(duration, project.canvas.fps)}</span>
        <button
          className={`autoKey ${autoKey ? "on" : ""}`}
          title="Automatically create transform keyframes"
          onClick={() => onAutoKey(!autoKey)}
        >
          <i /> Auto Key
        </button>
        {selectedTrack && selectedKey && (
          <div className="keyframeEditor">
            <button
              title="Previous keyframe"
              disabled={selectedTrackIndex <= 0}
              onClick={() => {
                const keyframe = selectedTrackKeyframes[selectedTrackIndex - 1];
                if (!keyframe) return;
                setSelectedKeyframes([
                  {
                    trackId: selectedTrack.id,
                    keyframeId: keyframe.id,
                  },
                ]);
                onFrame(keyframe.frame);
              }}
            >
              <I.ChevronLeft />
            </button>
            <button
              title="Next keyframe"
              disabled={selectedTrackIndex >= selectedTrackKeyframes.length - 1}
              onClick={() => {
                const keyframe = selectedTrackKeyframes[selectedTrackIndex + 1];
                if (!keyframe) return;
                setSelectedKeyframes([
                  {
                    trackId: selectedTrack.id,
                    keyframeId: keyframe.id,
                  },
                ]);
                onFrame(keyframe.frame);
              }}
            >
              <I.ChevronRight />
            </button>
            <Field
              label="F"
              value={selectedKey.frame}
              onChange={(value) =>
                update((draft) => {
                  const track = draft.keyframeTracks.find(
                    (item) => item.id === selectedTrack.id,
                  );
                  const keyframe = track?.keyframes.find(
                    (item) => item.id === selectedKey.id,
                  );
                  if (keyframe)
                    keyframe.frame = Math.round(clamp(value, 0, duration - 1));
                })
              }
            />
            {selectedTrack.valueType === "number" &&
              typeof selectedKey.value === "number" && (
                <Field
                  label="V"
                  value={selectedKey.value}
                  onChange={(value) =>
                    update((draft) => {
                      const track = draft.keyframeTracks.find(
                        (item) => item.id === selectedTrack.id,
                      );
                      if (track?.valueType !== "number") return;
                      const keyframe = track.keyframes.find(
                        (item) => item.id === selectedKey.id,
                      );
                      if (keyframe) keyframe.value = value;
                    })
                  }
                />
              )}
            {selectedTrack.valueType === "color" &&
              typeof selectedKey.value === "string" && (
                <input
                  aria-label="Keyframe color"
                  type="color"
                  value={selectedKey.value}
                  onChange={(event) =>
                    update((draft) => {
                      const track = draft.keyframeTracks.find(
                        (item) => item.id === selectedTrack.id,
                      );
                      if (track?.valueType !== "color") return;
                      const keyframe = track.keyframes.find(
                        (item) => item.id === selectedKey.id,
                      );
                      if (keyframe) keyframe.value = event.target.value;
                    })
                  }
                />
              )}
            <select
              aria-label="Keyframe easing"
              value={selectedKey.easing}
              onChange={(event) =>
                update((draft) => {
                  const track = draft.keyframeTracks.find(
                    (item) => item.id === selectedTrack.id,
                  );
                  const keyframe = track?.keyframes.find(
                    (item) => item.id === selectedKey.id,
                  );
                  if (keyframe)
                    keyframe.easing = event.target
                      .value as typeof keyframe.easing;
                })
              }
            >
              {[
                "linear",
                "ease-in",
                "ease-out",
                "ease-in-out",
                "custom-bezier",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <button
              title={`Delete ${selectedKeyframes.length} selected keyframe${selectedKeyframes.length === 1 ? "" : "s"}`}
              onClick={deleteSelectedKeyframes}
            >
              <I.Trash2 />
            </button>
          </div>
        )}
        <div className="timelineTools">
          <button onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>
            <I.Minus />
          </button>
          <input
            aria-label="Timeline zoom"
            type="range"
            min="1"
            max="3"
            step=".25"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <button onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
            <I.Plus />
          </button>
          <b>{Math.round(zoom * 100)}%</b>
        </div>
      </div>
      <div className="tracks">
        <div
          className="timelineSurface"
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={beginSurfaceInteraction}
        >
          <div className="ruler" onPointerDown={scrub}>
            {ticks.map((second) => (
              <span
                key={second}
                style={{ left: `${(second / seconds) * 100}%` }}
              >
                00:{String(second).padStart(2, "0")}
              </span>
            ))}
            <i
              className="rulerPlayhead"
              style={{
                left: `calc(10px + ${frame / duration} * (100% - 20px))`,
              }}
            />
          </div>
          <div
            className="playhead"
            style={
              {
                "--timeline-progress": frame / duration,
              } as React.CSSProperties
            }
          >
            <i />
          </div>
          {marquee && <div className="keyframeMarquee" style={marquee} />}
          {project.layers.map((layer) => (
            <TimelineTrack
              key={layer.id}
              layer={layer}
              project={project}
              frame={frame}
              selected={selectedId === layer.id}
              update={update}
              onFrame={onFrame}
              onSelect={onSelect}
              selectedKeyframes={selectedKeyframes}
              onSelectKeyframe={selectKeyframe}
            />
          ))}
        </div>
      </div>
    </footer>
  );
}
function TimelineTrack({
  layer,
  project,
  frame,
  selected,
  update,
  onFrame,
  onSelect,
  selectedKeyframes,
  onSelectKeyframe,
}: {
  layer: ProjectLayer;
  project: TemplateProject;
  frame: number;
  selected: boolean;
  update: (recipe: (draft: TemplateProject) => void) => void;
  onFrame: (frame: number) => void;
  onSelect: (id: string) => void;
  selectedKeyframes: { trackId: string; keyframeId: string }[];
  onSelectKeyframe: (
    value: { trackId: string; keyframeId: string },
    additive?: boolean,
  ) => void;
}) {
  const Icon = icons[layer.type],
    duration = project.canvas.durationInFrames,
    [preview, setPreview] = useState<{ start: number; length: number }>({
      start: layer.startFrame,
      length: layer.durationInFrames,
    }),
    [expanded, setExpanded] = useState(selected),
    drag = useRef<{
      mode: "move" | "left" | "right";
      x: number;
      start: number;
      length: number;
      width: number;
      element: HTMLElement;
      pointerId: number;
    } | null>(null);
  useEffect(() => {
    if (!drag.current)
      setPreview({ start: layer.startFrame, length: layer.durationInFrames });
  }, [layer.durationInFrames, layer.startFrame]);
  useEffect(() => {
    if (selected) setExpanded(true);
  }, [selected]);
  const begin = (
    event: React.PointerEvent<HTMLElement>,
    mode: "move" | "left" | "right",
  ) => {
    event.stopPropagation();
    onSelect(layer.id);
    if (layer.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      x: event.clientX,
      start: layer.startFrame,
      length: layer.durationInFrames,
      width: event.currentTarget.closest(".clipArea")!.getBoundingClientRect()
        .width,
      element: event.currentTarget,
      pointerId: event.pointerId,
    };
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const delta = Math.round(
      ((event.clientX - state.x) / state.width) * duration,
    );
    if (state.mode === "move")
      setPreview({
        start: clamp(state.start + delta, 0, duration - state.length),
        length: state.length,
      });
    else if (state.mode === "left") {
      const start = clamp(
        state.start + delta,
        0,
        state.start + state.length - 1,
      );
      setPreview({ start, length: state.length + (state.start - start) });
    } else
      setPreview({
        start: state.start,
        length: clamp(state.length + delta, 1, duration - state.start),
      });
  };
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = drag.current;
    if (!interaction) return;
    if (interaction.element.hasPointerCapture(interaction.pointerId))
      interaction.element.releasePointerCapture(interaction.pointerId);
    drag.current = null;
    if (
      preview.start !== layer.startFrame ||
      preview.length !== layer.durationInFrames
    )
      update((d) => {
        const item = d.layers.find((value) => value.id === layer.id);
        if (item) {
          item.startFrame = preview.start;
          item.durationInFrames = preview.length;
        }
      });
  };
  const label =
    layer.type === "device"
      ? "Manual keyframes"
      : layer.type === "screen-media"
        ? "Screen media"
        : layer.type === "text"
          ? layer.content
          : layer.type === "lighting"
            ? "Studio lighting"
            : "Camera Move";
  const channels = getKeyframeChannels(project, layer);
  return (
    <>
      <div
        className={`track ${selected ? "sel" : ""}`}
        onClick={() => onSelect(layer.id)}
      >
        <div className="trackLabel">
          <button
            className={`trackExpand ${expanded ? "open" : ""}`}
            title="Show keyframe properties"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
          >
            <I.ChevronRight />
          </button>
          <Icon />
          <span>{layer.name}</span>
          {layer.locked ? <I.Lock /> : <I.Unlock />}
        </div>
        <div
          className="clipArea"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onFrame(((event.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div
            className="clip"
            style={{
              left: `${(preview.start / duration) * 100}%`,
              width: `${(preview.length / duration) * 100}%`,
              background: `linear-gradient(90deg,${layer.color}55,${layer.color}aa)`,
            }}
            onPointerDown={(event) => begin(event, "move")}
            onPointerMove={move}
            onPointerUp={end}
            onClick={(event) => event.stopPropagation()}
          >
            <i
              className="clipHandle left"
              onPointerDown={(event) => begin(event, "left")}
            />
            <span>{label}</span>
            <i
              className="clipHandle right"
              onPointerDown={(event) => begin(event, "right")}
            />
          </div>
        </div>
      </div>
      {expanded &&
        channels.map((channel) => (
          <KeyframePropertyRow
            key={`${layer.id}:${channel.property}`}
            project={project}
            layer={layer}
            channel={channel}
            frame={frame}
            duration={duration}
            update={update}
            onFrame={onFrame}
            selectedKeyframes={selectedKeyframes}
            onSelectKeyframe={onSelectKeyframe}
          />
        ))}
    </>
  );
}

type KeyframeChannel =
  | {
      label: string;
      valueType: "number";
      property: Extract<KeyframeTrack, { valueType: "number" }>["property"];
      value: number;
    }
  | {
      label: string;
      valueType: "color";
      property: Extract<KeyframeTrack, { valueType: "color" }>["property"];
      value: string;
    };

function getKeyframeChannels(
  project: TemplateProject,
  layer: ProjectLayer,
): KeyframeChannel[] {
  if (layer.type === "device" && project.model)
    return [
      ...(["x", "y", "z"] as const).map((axis, index) => ({
        label: `Position ${axis.toUpperCase()}`,
        valueType: "number" as const,
        property: `device.position.${axis}` as const,
        value: project.model!.position[index],
      })),
      ...(["x", "y", "z"] as const).map((axis, index) => ({
        label: `Rotation ${axis.toUpperCase()}`,
        valueType: "number" as const,
        property: `device.rotation.${axis}` as const,
        value: project.model!.rotation[index],
      })),
      {
        label: "Scale",
        valueType: "number",
        property: "device.scale",
        value: project.model.scale,
      },
    ];
  if (layer.type === "camera" && project.camera)
    return [
      ...(["x", "y", "z"] as const).map((axis, index) => ({
        label: `Position ${axis.toUpperCase()}`,
        valueType: "number" as const,
        property: `camera.position.${axis}` as const,
        value: project.camera!.position[index],
      })),
      ...(["x", "y", "z"] as const).map((axis, index) => ({
        label: `Target ${axis.toUpperCase()}`,
        valueType: "number" as const,
        property: `camera.target.${axis}` as const,
        value: project.camera!.target[index],
      })),
      {
        label: "Field of View",
        valueType: "number",
        property: "camera.fov",
        value: project.camera.fov,
      },
    ];
  if (layer.type === "text" && layer.is3D)
    return [
      ...(["x", "y", "z"] as const).map((axis, index) => ({
        label: `3D Position ${axis.toUpperCase()}`,
        valueType: "number" as const,
        property: `overlay3d.position.${axis}` as const,
        value: layer.transform3D.position[index],
      })),
      ...(["x", "y", "z"] as const).map((axis, index) => ({
        label: `3D Rotation ${axis.toUpperCase()}`,
        valueType: "number" as const,
        property: `overlay3d.rotation.${axis}` as const,
        value: layer.transform3D.rotation[index],
      })),
      {
        label: "3D Scale",
        valueType: "number" as const,
        property: "overlay3d.scale" as const,
        value: layer.transform3D.scale,
      },
      {
        label: "Opacity",
        valueType: "number" as const,
        property: "overlay.opacity" as const,
        value: layer.transform2D.opacity,
      },
      {
        label: "Font Size",
        valueType: "number" as const,
        property: "text.fontSize" as const,
        value: layer.textStyle.fontSize,
      },
      {
        label: "Letter Spacing",
        valueType: "number" as const,
        property: "text.letterSpacing" as const,
        value: layer.textStyle.letterSpacing,
      },
      {
        label: "Text Color",
        valueType: "color" as const,
        property: "overlay.color" as const,
        value: layer.textStyle.color,
      },
    ];
  if (layer.type === "text" || layer.type === "image")
    return [
      {
        label: "Position X",
        valueType: "number",
        property: "overlay.position.x",
        value: layer.transform2D.x,
      },
      {
        label: "Position Y",
        valueType: "number",
        property: "overlay.position.y",
        value: layer.transform2D.y,
      },
      {
        label: "Width",
        valueType: "number",
        property: "overlay.width",
        value: layer.transform2D.width,
      },
      {
        label: "Height",
        valueType: "number",
        property: "overlay.height",
        value: layer.transform2D.height,
      },
      {
        label: "Rotation",
        valueType: "number",
        property: "overlay.rotation",
        value: layer.transform2D.rotation,
      },
      {
        label: "Opacity",
        valueType: "number",
        property: "overlay.opacity",
        value: layer.transform2D.opacity,
      },
      ...(layer.type === "text"
        ? [
            {
              label: "Font Size",
              valueType: "number" as const,
              property: "text.fontSize" as const,
              value: layer.textStyle.fontSize,
            },
            {
              label: "Letter Spacing",
              valueType: "number" as const,
              property: "text.letterSpacing" as const,
              value: layer.textStyle.letterSpacing,
            },
            {
              label: "Text Color",
              valueType: "color" as const,
              property: "overlay.color" as const,
              value: layer.textStyle.color,
            },
          ]
        : []),
    ];
  if (layer.type === "lighting")
    return [
      ...[
        [
          "Environment",
          "lighting.environmentIntensity",
          project.lighting.environmentIntensity,
        ],
        [
          "Key Intensity",
          "lighting.keyIntensity",
          project.lighting.keyIntensity,
        ],
        [
          "Fill Intensity",
          "lighting.fillIntensity",
          project.lighting.fillIntensity,
        ],
        [
          "Shadow Opacity",
          "lighting.shadowOpacity",
          project.lighting.shadowOpacity,
        ],
        [
          "Shadow Softness",
          "lighting.shadowSoftness",
          project.lighting.shadowSoftness,
        ],
        ...(["x", "y", "z"] as const).map((axis, index) => [
          `Key Position ${axis.toUpperCase()}`,
          `lighting.keyPosition.${axis}`,
          project.lighting.keyPosition[index],
        ]),
      ].map(([label, property, value]) => ({
        label: String(label),
        valueType: "number" as const,
        property: property as Extract<
          KeyframeTrack,
          { valueType: "number" }
        >["property"],
        value: Number(value),
      })),
      {
        label: "Key Color",
        valueType: "color" as const,
        property: "lighting.keyColor" as const,
        value: project.lighting.keyColor,
      },
    ];
  if (layer.type === "background")
    return [
      {
        label: "Gradient Angle",
        valueType: "number",
        property: "background.angle",
        value: project.background.angle,
      },
      {
        label: "Start Color",
        valueType: "color",
        property: "background.colorA",
        value: project.background.colorA,
      },
      {
        label: "End Color",
        valueType: "color",
        property: "background.colorB",
        value: project.background.colorB,
      },
    ];
  if (layer.type === "screen-media" && project.screen)
    return [
      ["Offset X", "screen.offset.x", project.screen.offset[0]],
      ["Offset Y", "screen.offset.y", project.screen.offset[1]],
      ["Scale X", "screen.scale.x", project.screen.scale[0]],
      ["Scale Y", "screen.scale.y", project.screen.scale[1]],
      ["Opacity", "screen.opacity", 1],
      ["Playback Offset", "screen.playbackOffset", 0],
    ].map(([label, property, value]) => ({
      label: String(label),
      valueType: "number" as const,
      property: property as Extract<
        KeyframeTrack,
        { valueType: "number" }
      >["property"],
      value: Number(value),
    }));
  return [];
}

function InspectorKeyframes({
  project,
  layer,
  frame,
  update,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
  frame: number;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const channels = getKeyframeChannels(project, layer),
    roundedFrame = Math.round(frame);
  if (!channels.length) return null;
  return (
    <Panel title={`Keyframes · Frame ${roundedFrame}`}>
      <p className="keyframeHint">
        Click a diamond to add or remove a keyframe at the playhead.
      </p>
      <div className="inspectorKeyframes">
        {channels.map((channel) => {
          const track = findKeyframeTrack(
              project.keyframeTracks,
              layer.id,
              channel.property,
            ),
            current = track?.keyframes.some(
              (keyframe) => keyframe.frame === roundedFrame,
            );
          return (
            <button
              key={channel.property}
              className={`${track ? "animated" : ""} ${current ? "current" : ""}`}
              title={`${current ? "Remove" : "Add"} keyframe at frame ${roundedFrame}`}
              onClick={() =>
                update((draft) => {
                  const editableTrack = findKeyframeTrack(
                    draft.keyframeTracks,
                    layer.id,
                    channel.property,
                  );
                  const editableCurrent = editableTrack?.keyframes.find(
                    (keyframe) => keyframe.frame === roundedFrame,
                  );
                  if (editableTrack && editableCurrent) {
                    editableTrack.keyframes = editableTrack.keyframes.filter(
                      (keyframe) => keyframe.id !== editableCurrent.id,
                    ) as typeof editableTrack.keyframes;
                  } else if (channel.valueType === "number") {
                    setNumericKeyframe(
                      draft,
                      layer.id,
                      channel.property,
                      roundedFrame,
                      evaluateNumericProperty(
                        draft.keyframeTracks,
                        layer.id,
                        channel.property,
                        roundedFrame,
                        channel.value,
                      ),
                    );
                  } else {
                    setColorKeyframe(
                      draft,
                      layer.id,
                      channel.property,
                      roundedFrame,
                      evaluateColorProperty(
                        draft.keyframeTracks,
                        layer.id,
                        channel.property,
                        roundedFrame,
                        channel.value,
                      ),
                    );
                  }
                })
              }
            >
              <I.Diamond />
              <span>{channel.label}</span>
              {track && <small>{track.keyframes.length}</small>}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function KeyframePropertyRow({
  project,
  layer,
  channel,
  frame,
  duration,
  update,
  onFrame,
  selectedKeyframes,
  onSelectKeyframe,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
  channel: KeyframeChannel;
  frame: number;
  duration: number;
  update: (recipe: (draft: TemplateProject) => void) => void;
  onFrame: (frame: number) => void;
  selectedKeyframes: { trackId: string; keyframeId: string }[];
  onSelectKeyframe: (
    value: { trackId: string; keyframeId: string },
    additive?: boolean,
  ) => void;
}) {
  const track = findKeyframeTrack(
      project.keyframeTracks,
      layer.id,
      channel.property,
    ),
    [drag, setDrag] = useState<{ id: string; frame: number }>();
  const currentKeyframe = track?.keyframes.find(
    (keyframe) => keyframe.frame === Math.round(frame),
  );
  const toggle = () => {
    if (currentKeyframe) {
      update((draft) => {
        const editableTrack = draft.keyframeTracks.find(
          (item) => item.id === track?.id,
        );
        if (editableTrack)
          editableTrack.keyframes = editableTrack.keyframes.filter(
            (keyframe) => keyframe.id !== currentKeyframe.id,
          ) as typeof editableTrack.keyframes;
      });
      return;
    }
    update((draft) => {
      if (channel.valueType === "number")
        setNumericKeyframe(
          draft,
          layer.id,
          channel.property,
          frame,
          evaluateNumericProperty(
            draft.keyframeTracks,
            layer.id,
            channel.property,
            frame,
            channel.value,
          ),
        );
      else
        setColorKeyframe(
          draft,
          layer.id,
          channel.property,
          frame,
          evaluateColorProperty(
            draft.keyframeTracks,
            layer.id,
            channel.property,
            frame,
            channel.value,
          ),
        );
    });
  };
  return (
    <div className="propertyTrack">
      <div className="propertyLabel">
        <span>{channel.label}</span>
        <button
          className={`${track ? "animated" : ""} ${currentKeyframe ? "current" : ""}`}
          title={`${currentKeyframe ? "Remove" : "Add"} ${channel.label} keyframe at frame ${Math.round(frame)}`}
          onClick={toggle}
        >
          <I.Diamond />
        </button>
      </div>
      <div className="keyframeLane" onDoubleClick={toggle}>
        {track?.keyframes.map((keyframe) => {
          const shownFrame =
            drag && drag.id === keyframe.id ? drag.frame : keyframe.frame;
          return (
            <button
              key={keyframe.id}
              className={`keyframeDiamond ${
                selectedKeyframes.some(
                  (item) =>
                    item.trackId === track.id &&
                    item.keyframeId === keyframe.id,
                )
                  ? "selected"
                  : ""
              }`}
              data-track-id={track.id}
              data-keyframe-id={keyframe.id}
              style={{
                left: `calc(10px + ${shownFrame / duration} * (100% - 20px))`,
              }}
              title={`Frame ${shownFrame}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({ id: keyframe.id, frame: keyframe.frame });
                onSelectKeyframe(
                  {
                    trackId: track.id,
                    keyframeId: keyframe.id,
                  },
                  event.shiftKey,
                );
                onFrame(keyframe.frame);
              }}
              onPointerMove={(event) => {
                if (!drag || drag.id !== keyframe.id) return;
                const activeDrag = drag;
                const lane = event.currentTarget.parentElement!;
                const rect = lane.getBoundingClientRect();
                setDrag({
                  id: activeDrag.id,
                  frame: Math.round(
                    clamp(
                      ((event.clientX - rect.left - 10) /
                        Math.max(1, rect.width - 20)) *
                        duration,
                      0,
                      duration - 1,
                    ),
                  ),
                });
              }}
              onPointerUp={() => {
                if (!drag || drag.id !== keyframe.id) return;
                const nextFrame = drag.frame;
                update((draft) => {
                  const editableTrack = draft.keyframeTracks.find(
                    (item) => item.id === track.id,
                  );
                  const editableKeyframe = editableTrack?.keyframes.find(
                    (item) => item.id === keyframe.id,
                  );
                  if (editableKeyframe) editableKeyframe.frame = nextFrame;
                });
                onFrame(nextFrame);
                setDrag(undefined);
              }}
            >
              <I.Diamond />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExportDialog({
  project,
  onClose,
}: {
  project: TemplateProject;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null),
    cancelled = useRef(false),
    [renderFrame, setRenderFrame] = useState(0),
    [renderedOutputFrame, setRenderedOutputFrame] = useState(0),
    [progress, setProgress] = useState(0),
    [status, setStatus] = useState<"idle" | "rendering" | "done" | "error">(
      "idle",
    ),
    [error, setError] = useState(""),
    [downloadUrl, setDownloadUrl] = useState(""),
    [sceneReady, setSceneReady] = useState(!project.model?.assetId),
    [mediaReadyFrame, setMediaReadyFrame] = useState(-1),
    [resolution, setResolution] = useState<"720p" | "1080p">("1080p"),
    [exportFps, setExportFps] = useState<30 | 60>(60);
  const exportWidth = resolution === "1080p" ? 1920 : 1280,
    exportHeight = resolution === "1080p" ? 1080 : 720,
    durationSeconds = project.canvas.durationInFrames / project.canvas.fps,
    totalExportFrames = Math.round(durationSeconds * exportFps);
  useEffect(
    () => () => {
      cancelled.current = true;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );
  const start = async () => {
    if (!stage.current) return;
    cancelled.current = false;
    setStatus("rendering");
    setError("");
    setProgress(0);
    setRenderedOutputFrame(0);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl("");
    try {
      const blob = await renderProjectMp4(
        project,
        stage.current,
        { width: exportWidth, height: exportHeight, fps: exportFps },
        (sourceFrame, outputFrame, totalFrames) => {
          setRenderFrame(sourceFrame);
          setRenderedOutputFrame(outputFrame);
          setProgress((outputFrame / totalFrames) * 100);
        },
        () => cancelled.current,
      );
      if (cancelled.current) throw new Error("Export cancelled.");
      setDownloadUrl(URL.createObjectURL(blob));
      setProgress(100);
      setStatus("done");
    } catch (reason) {
      if (cancelled.current) {
        setStatus("idle");
        return;
      }
      setError(
        reason instanceof Error
          ? reason.message
          : "The MP4 could not be rendered.",
      );
      setStatus("error");
    }
  };
  const fileName = `${project.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "renderlaunch-preview"}.mp4`;
  return (
    <div className="exportBackdrop" role="dialog" aria-modal="true">
      <section className="exportDialog">
        <div className="exportHead">
          <div>
            <small>LOCAL RENDER</small>
            <h2>Export Preview</h2>
          </div>
          <button
            aria-label="Close export"
            disabled={status === "rendering"}
            onClick={onClose}
          >
            <I.X />
          </button>
        </div>
        <div className="renderSettings">
          <label>
            Resolution
            <select
              value={resolution}
              disabled={status === "rendering"}
              onChange={(event) =>
                setResolution(event.target.value as "720p" | "1080p")
              }
            >
              <option value="1080p">1920 × 1080 (Full HD)</option>
              <option value="720p">1280 × 720 (Draft)</option>
            </select>
          </label>
          <label>
            Frame rate
            <select
              value={exportFps}
              disabled={status === "rendering"}
              onChange={(event) =>
                setExportFps(Number(event.target.value) as 30 | 60)
              }
            >
              <option value="60">60 FPS</option>
              <option value="30">30 FPS</option>
            </select>
          </label>
          <span>
            Format <b>H.264 MP4</b>
          </span>
          <span>
            Duration <b>{durationSeconds}s</b>
          </span>
        </div>
        {status === "rendering" && (
          <div className="renderProgress">
            <div>
              <i style={{ width: `${progress}%` }} />
            </div>
            <span>
              Rendering frame{" "}
              {Math.min(renderedOutputFrame + 1, totalExportFrames)} of{" "}
              {totalExportFrames}
            </span>
            <b>{Math.round(progress)}%</b>
          </div>
        )}
        {status === "error" && (
          <div className="renderError">
            <I.CircleAlert />
            <div>
              <b>Export failed</b>
              <span>{error}</span>
            </div>
          </div>
        )}
        {status === "done" && (
          <>
            <div className="renderDone">
              <I.CircleCheck />
              <div>
                <b>Your preview is ready</b>
                <span>{fileName}</span>
              </div>
            </div>
            {downloadUrl && (
              <video
                className="exportVideoPreview"
                src={downloadUrl}
                controls
                playsInline
              />
            )}
          </>
        )}
        <div className="exportActions">
          {status === "rendering" ? (
            <button
              onClick={() => {
                cancelled.current = true;
              }}
            >
              Cancel render
            </button>
          ) : (
            <button onClick={onClose}>Cancel</button>
          )}
          {status === "done" && downloadUrl ? (
            <a className="primary" href={downloadUrl} download={fileName}>
              <I.Download /> Download MP4
            </a>
          ) : (
            <button className="primary" onClick={() => void start()}>
              <I.Clapperboard />{" "}
              {status === "error" ? "Try Again" : "Start Rendering"}
            </button>
          )}
        </div>
      </section>
      <div
        className="renderStage"
        aria-hidden="true"
        style={{ width: exportWidth, height: exportHeight }}
      >
        <div
          ref={stage}
          data-scene-ready={sceneReady}
          data-media-frame={mediaReadyFrame}
          className={`renderComposition ${bgClass(project.background.preset)}`}
          style={{
            ...backgroundStyle(project, renderFrame),
            width: exportWidth,
            height: exportHeight,
          }}
        >
          {project.model?.assetId && (
            <div
              className="previewModel"
              style={{
                visibility: isLayerActive(project, "phone", renderFrame)
                  ? "visible"
                  : "hidden",
              }}
            >
              <SceneCanvas
                project={project}
                frame={renderFrame}
                autoFrame={false}
                cameraControls={false}
                onReady={() => setSceneReady(true)}
                onMediaFrameReady={setMediaReadyFrame}
              />
            </div>
          )}
          <PreviewOverlays project={project} frame={renderFrame} />
        </div>
      </div>
    </div>
  );
}

async function renderProjectMp4(
  project: TemplateProject,
  stage: HTMLDivElement,
  settings: { width: number; height: number; fps: 30 | 60 },
  onFrame: (
    sourceFrame: number,
    outputFrame: number,
    totalFrames: number,
  ) => void,
  isCancelled: () => boolean,
) {
  if (!("VideoEncoder" in window) || !("VideoFrame" in window))
    throw new Error(
      "This browser cannot encode H.264 locally. Use the latest Chrome or Edge with hardware acceleration enabled.",
    );
  await validateExportAssets(project);
  if (project.model?.assetId) await waitForRenderCanvas(stage);
  await document.fonts.ready;
  await Promise.all(
    [...stage.querySelectorAll("img")].map(
      (image) =>
        image.complete ||
        new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener(
            "error",
            () =>
              reject(new Error(`Image ${image.alt || "asset"} did not load.`)),
            { once: true },
          );
        }),
    ),
  );
  const { getFontEmbedCSS, toCanvas } = await import("html-to-image"),
    { ArrayBufferTarget, Muxer } = await import("mp4-muxer"),
    fontEmbedCSS = await getFontEmbedCSS(stage),
    config: VideoEncoderConfig = {
      codec: "avc1.42002a",
      width: settings.width,
      height: settings.height,
      bitrate: settings.width >= 1920 ? 28_000_000 : 10_000_000,
      bitrateMode: "variable",
      framerate: settings.fps,
      avc: { format: "avc" },
    },
    support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported)
    throw new Error(
      "H.264 encoding is unavailable on this device. Enable browser hardware acceleration or try Chrome/Edge.",
    );
  const target = new ArrayBufferTarget(),
    muxer = new Muxer({
      target,
      video: { codec: "avc", width: settings.width, height: settings.height },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
  let encoderFailure: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (reason) => {
      encoderFailure = reason;
    },
  });
  encoder.configure(config);
  const durationSeconds = project.canvas.durationInFrames / project.canvas.fps,
    totalFrames = Math.round(durationSeconds * settings.fps);
  for (let outputFrame = 0; outputFrame < totalFrames; outputFrame += 1) {
    if (isCancelled()) break;
    const sourceFrame = (outputFrame / settings.fps) * project.canvas.fps;
    onFrame(sourceFrame, outputFrame, totalFrames);
    await nextPaint();
    if (project.screen?.mediaType === "video")
      await waitForMediaFrame(stage, sourceFrame, isCancelled);
    const canvas = await toCanvas(stage, {
      width: settings.width,
      height: settings.height,
      canvasWidth: settings.width,
      canvasHeight: settings.height,
      pixelRatio: 1,
      skipFonts: false,
      fontEmbedCSS,
      cacheBust: false,
    });
    if (canvas.width !== settings.width || canvas.height !== settings.height)
      throw new Error(
        `The export frame rendered at ${canvas.width} × ${canvas.height} instead of ${settings.width} × ${settings.height}.`,
      );
    if (outputFrame === 0 && isCapturedFrameBlank(canvas))
      throw new Error(
        "The first rendered frame is blank. The export was stopped before encoding; retry after the scene is fully visible.",
      );
    const videoFrame = new VideoFrame(canvas, {
      timestamp: Math.round((outputFrame / settings.fps) * 1_000_000),
      duration: Math.round(1_000_000 / settings.fps),
    });
    encoder.encode(videoFrame, {
      keyFrame: outputFrame % (settings.fps * 2) === 0,
    });
    videoFrame.close();
    if (encoder.encodeQueueSize > 8) await encoder.flush();
    if (encoderFailure) throw encoderFailure;
  }
  if (isCancelled()) {
    encoder.close();
    throw new Error("Export cancelled.");
  }
  await encoder.flush();
  if (encoderFailure) throw encoderFailure;
  encoder.close();
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}

async function validateExportAssets(project: TemplateProject) {
  const assets: Array<{ id?: string; label: string }> = [
    { id: project.model?.assetId, label: "3D model" },
    { id: project.screen?.mediaAssetId, label: "screen media" },
    ...project.layers
      .filter((layer) => layer.type === "image")
      .map((layer) => ({ id: layer.media?.assetId, label: layer.name })),
  ];
  for (const asset of assets) {
    if (!asset.id) continue;
    if (!(await loadAssetBlob(asset.id)))
      throw new Error(
        `${asset.label} is missing from local storage. Attach it again before exporting.`,
      );
  }
}

async function waitForRenderCanvas(stage: HTMLDivElement) {
  const deadline = performance.now() + 15_000;
  while (
    !stage.querySelector(".threeCanvas canvas") ||
    stage.dataset.sceneReady !== "true"
  ) {
    if (performance.now() > deadline)
      throw new Error(
        "The 3D scene did not become ready. Check the model, then retry the export.",
      );
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  await nextPaint();
}

async function waitForMediaFrame(
  stage: HTMLDivElement,
  frame: number,
  isCancelled: () => boolean,
) {
  const deadline = performance.now() + 8_000;
  while (Number(stage.dataset.mediaFrame) !== frame) {
    if (isCancelled()) throw new Error("Export cancelled.");
    if (performance.now() > deadline)
      throw new Error(
        `Screen video frame ${frame + 1} did not decode in time. Try a shorter or lower-resolution video.`,
      );
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
  await nextPaint();
}

function isCapturedFrameBlank(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let opaque = 0,
    visible = 0;
  for (let index = 0; index < pixels.length; index += 64) {
    const red = pixels[index],
      green = pixels[index + 1],
      blue = pixels[index + 2],
      alpha = pixels[index + 3];
    if (alpha > 16) opaque += 1;
    if (alpha > 16 && red + green + blue > 18) visible += 1;
  }
  return opaque === 0 || visible < opaque * 0.005;
}

function nextPaint() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function UserPreview({
  template,
  frame,
  playing,
  onFrame,
  onPlay,
  onClose,
}: {
  template: TemplateProject;
  frame: number;
  playing: boolean;
  onFrame: (frame: number) => void;
  onPlay: (playing: boolean) => void;
  onClose: () => void;
}) {
  const [project, setProject] = useState<TemplateProject>(() =>
      structuredClone(template),
    ),
    [error, setError] = useState("");
  const mutate = (recipe: (draft: TemplateProject) => void) =>
    setProject((current) => {
      const next = structuredClone(current);
      recipe(next);
      return next;
    });
  const replaceScreen = async (file?: File) => {
    if (!file || !project.screen) return;
    setError("");
    try {
      const type = await validateMedia(file),
        assetId = await saveAsset(file);
      mutate((draft) => {
        if (!draft.screen) return;
        draft.screen.mediaAssetId = assetId;
        draft.screen.mediaFileName = file.name;
        draft.screen.mediaType = type;
        draft.screen.testPattern = false;
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Media upload failed.",
      );
    }
  };
  const replaceImage = async (layerId: string, file?: File) => {
    if (!file) return;
    setError("");
    try {
      if ((await validateMedia(file)) !== "image")
        throw new Error("Logo fields require an image.");
      const assetId = await saveAsset(file);
      mutate((draft) => {
        const layer = draft.layers.find((item) => item.id === layerId);
        if (layer)
          layer.media = { assetId, fileName: file.name, type: "image" };
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Image upload failed.",
      );
    }
  };
  const editableLayers = project.layers.filter(
    (layer) => layer.replaceable && !layer.locked,
  );
  const screenEditable = editableLayers.some(
    (layer) => layer.type === "screen-media",
  );
  const backgroundEditable = editableLayers.some(
    (layer) => layer.type === "background",
  );
  return (
    <div className="preview userPreview">
      <button className="backPreview" onClick={onClose}>
        <I.ChevronLeft /> Back to editor
      </button>
      <aside className="userFields">
        <div className="userTemplateHead">
          {template.thumbnailDataUrl && (
            <img src={template.thumbnailDataUrl} alt="Template thumbnail" />
          )}
          <div>
            <small>USER PREVIEW</small>
            <h2>{template.name}</h2>
          </div>
        </div>
        <p>Only fields marked with the tag icon can be changed here.</p>
        {screenEditable && project.screen && (
          <label className="userUpload">
            <I.Upload /> Replace screen media
            <small>
              {project.screen.mediaFileName ?? "Choose image or video"}
            </small>
            <input
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
              onChange={(event) => {
                void replaceScreen(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        )}
        {editableLayers
          .filter((layer) => layer.type === "text")
          .map((layer) => (
            <label className="userField" key={layer.id}>
              <span>{layer.name}</span>
              <textarea
                value={layer.content ?? ""}
                onChange={(event) =>
                  mutate((draft) => {
                    const item = draft.layers.find(
                      (value) => value.id === layer.id,
                    );
                    if (item) item.content = event.target.value;
                  })
                }
              />
            </label>
          ))}
        {editableLayers
          .filter((layer) => layer.type === "image")
          .map((layer) => (
            <label className="userUpload" key={layer.id}>
              <I.Image /> Replace {layer.name}
              <small>{layer.media?.fileName ?? "Choose image"}</small>
              <input
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  void replaceImage(layer.id, event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          ))}
        {backgroundEditable && (
          <div className="userColors">
            <span>Background colors</span>
            <label>
              <input
                type="color"
                value={project.background.colorA}
                onChange={(event) =>
                  mutate((draft) => {
                    draft.background.colorA = event.target.value;
                  })
                }
              />
              Start
            </label>
            <label>
              <input
                type="color"
                value={project.background.colorB}
                onChange={(event) =>
                  mutate((draft) => {
                    draft.background.colorB = event.target.value;
                  })
                }
              />
              End
            </label>
          </div>
        )}
        {error && <div className="modelError">{error}</div>}
        <button
          className="resetTemplate"
          onClick={() => {
            setProject(structuredClone(template));
            onPlay(false);
            onFrame(0);
            setError("");
          }}
        >
          <I.RotateCcw /> Restore template defaults
        </button>
      </aside>
      <div
        className={`previewStage ${bgClass(project.background.preset)}`}
        style={backgroundStyle(project, frame)}
      >
        <div className="canvasGlow" />
        {project.model?.assetId ? (
          <div
            className="previewModel"
            style={{
              visibility: isLayerActive(project, "phone", frame)
                ? "visible"
                : "hidden",
            }}
          >
            <SceneCanvas
              project={project}
              frame={frame}
              autoFrame={false}
              cameraControls={false}
            />
          </div>
        ) : (
          <Phone frame={frame} project={project} />
        )}
        <PreviewOverlays project={project} frame={frame} />
      </div>
      <PreviewPlayback
        project={project}
        frame={frame}
        playing={playing}
        onFrame={onFrame}
        onPlay={onPlay}
      />
    </div>
  );
}

function Preview({
  project,
  frame,
  playing,
  onFrame,
  onPlay,
  onClose,
}: {
  project: TemplateProject;
  frame: number;
  playing: boolean;
  onFrame: (frame: number) => void;
  onPlay: (playing: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="preview">
      <button className="backPreview" onClick={onClose}>
        <I.ChevronLeft /> Back to editor
      </button>
      <div
        className={`previewStage ${bgClass(project.background.preset)}`}
        style={backgroundStyle(project, frame)}
      >
        <div className="canvasGlow" />
        {project.model?.assetId ? (
          <div
            className="previewModel"
            style={{
              visibility: isLayerActive(project, "phone", frame)
                ? "visible"
                : "hidden",
            }}
          >
            <SceneCanvas
              project={project}
              frame={frame}
              autoFrame={false}
              cameraControls={false}
            />
          </div>
        ) : (
          <Phone frame={frame} project={project} />
        )}
        <PreviewOverlays project={project} frame={frame} />
      </div>
      <PreviewPlayback
        project={project}
        frame={frame}
        playing={playing}
        onFrame={onFrame}
        onPlay={onPlay}
      />
    </div>
  );
}
function PreviewPlayback({
  project,
  frame,
  playing,
  onFrame,
  onPlay,
}: {
  project: TemplateProject;
  frame: number;
  playing: boolean;
  onFrame: (frame: number) => void;
  onPlay: (playing: boolean) => void;
}) {
  return (
    <div className="previewBar">
      <button onClick={() => onPlay(!playing)}>
        {playing ? <I.Pause /> : <I.Play />}
      </button>
      <input
        type="range"
        min="0"
        max={project.canvas.durationInFrames - 1}
        value={frame}
        onChange={(event) => onFrame(Number(event.target.value))}
      />
      <b>
        {formatTimecode(frame, project.canvas.fps)} /{" "}
        {formatTimecode(project.canvas.durationInFrames, project.canvas.fps)}
      </b>
    </div>
  );
}
function isLayerActive(project: TemplateProject, id: string, frame: number) {
  const layer = project.layers.find((item) => item.id === id);
  return Boolean(
    layer?.visible &&
    frame >= layer.startFrame &&
    frame < layer.startFrame + layer.durationInFrames,
  );
}
function Panel({
  title,
  children,
  collapsed = false,
}: {
  title: string;
  children: ReactNode;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="panel">
      <button className="panelTitle" onClick={() => setOpen(!open)}>
        <I.ChevronDown className={!open ? "closed" : ""} />
        <b>{title}</b>
        <I.ChevronUp />
      </button>
      {open && <div className="panelBody">{children}</div>}
    </section>
  );
}
function Field({
  label,
  value,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(`${value}${suffix}`),
    [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(`${value}${suffix}`);
  }, [focused, suffix, value]);
  return (
    <div className="field">
      <span>{label}</span>
      <input
        value={text}
        onFocus={() => {
          setFocused(true);
          setText(String(value));
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = Number.parseFloat(text);
          if (Number.isFinite(parsed)) onChange(parsed);
          setText(`${Number.isFinite(parsed) ? parsed : value}${suffix}`);
        }}
      />
    </div>
  );
}
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="row">
      <label>{label}</label>
      <div className="select">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <I.ChevronDown />
      </div>
    </div>
  );
}
function MaterialBrowser({ names }: { names: string[] }) {
  const [query, setQuery] = useState(""),
    filtered = names.filter((name) =>
      name.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <Panel title={`Materials (${names.length})`} collapsed>
      <div className="materialSearch">
        <I.Search />
        <input
          placeholder="Search materials"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="materialList">
        {filtered.map((name) => (
          <button key={name}>
            <I.Circle />
            <span>{name}</span>
          </button>
        ))}
        {!filtered.length && <small>No matching materials</small>}
      </div>
    </Panel>
  );
}
function OverlayStage({
  project,
  frame,
  selectedId,
  update,
  onSelect,
}: {
  project: TemplateProject;
  frame: number;
  selectedId: string;
  update: (recipe: (draft: TemplateProject) => void) => void;
  onSelect: (id: string) => void;
}) {
  const autoKey = useEditorStore((state) => state.autoKey),
    wrapper = useRef<HTMLDivElement>(null),
    moveable = useRef<Moveable>(null),
    [scale, setScale] = useState(1),
    [target, setTarget] = useState<HTMLElement | null>(null),
    selected = project.layers.find((layer) => layer.id === selectedId),
    selectedActive = Boolean(
      selected?.visible &&
      frame >= (selected?.startFrame ?? 0) &&
      frame < (selected?.startFrame ?? 0) + (selected?.durationInFrames ?? 0),
    );
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setScale(
        Math.max(
          0.01,
          Math.min(
            entry.contentRect.width / 1280,
            entry.contentRect.height / 720,
          ),
        ),
      ),
    );
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () =>
      setTarget(
        selectedActive
          ? (wrapper.current?.querySelector(
              `[data-overlay-id="${selectedId}"]`,
            ) ?? null)
          : null,
      ),
    [project.layers.length, selectedActive, selectedId],
  );
  useLayoutEffect(() => {
    const frameId = requestAnimationFrame(() => moveable.current?.updateRect());
    return () => cancelAnimationFrame(frameId);
  }, [
    scale,
    target,
    selected?.transform2D.x,
    selected?.transform2D.y,
    selected?.transform2D.width,
    selected?.transform2D.height,
    selected?.transform2D.rotation,
  ]);
  const commitTransform = (
      values: Partial<
        Pick<
          ProjectLayer["transform2D"],
          "x" | "y" | "width" | "height" | "rotation"
        >
      >,
    ) =>
      update((d) => {
        const item = d.layers.find((layer) => layer.id === selectedId);
        if (!item) return;
        if (!autoKey) Object.assign(item.transform2D, values);
        else
          Object.entries(values).forEach(([key, value]) => {
            const properties = {
              x: "overlay.position.x",
              y: "overlay.position.y",
              width: "overlay.width",
              height: "overlay.height",
              rotation: "overlay.rotation",
            } as const;
            setNumericKeyframe(
              d,
              item.id,
              properties[key as keyof typeof properties],
              frame,
              value,
            );
          });
      }),
    resetTarget = () => {
      if (!target || !selected) return;
      target.style.width = `${selected.transform2D.width * scale}px`;
      target.style.height = `${selected.transform2D.height * scale}px`;
      target.style.transform = `rotate(${selected.transform2D.rotation}deg)`;
    };
  const visible = project.layers
    .filter(
      (layer) =>
        (layer.type === "text" || layer.type === "image") &&
        !(layer.type === "text" && layer.is3D) &&
        layer.visible &&
        frame >= layer.startFrame &&
        frame < layer.startFrame + layer.durationInFrames,
    )
    .sort((a, b) => a.zIndex - b.zIndex);
  return (
    <div className="overlayViewport" ref={wrapper}>
      <div
        className="designStage"
        style={{ width: 1280 * scale, height: 720 * scale }}
      >
        {visible.map((layer) => (
          <OverlayItem
            key={layer.id}
            project={project}
            layer={layer}
            frame={frame}
            scale={scale}
            selected={layer.id === selectedId}
            onSelect={() => onSelect(layer.id)}
          />
        ))}
      </div>
      {target &&
        selected &&
        !selected.locked &&
        (selected.type === "text" || selected.type === "image") && (
          <Moveable
            ref={moveable}
            target={target}
            draggable
            resizable
            rotatable
            keepRatio={selected.type === "image"}
            onDragStart={(e) => e.set([0, 0])}
            onDrag={(e) => {
              e.target.style.transform = `translate(${e.beforeTranslate[0]}px,${e.beforeTranslate[1]}px) rotate(${selected.transform2D.rotation}deg)`;
            }}
            onDragEnd={(e) => {
              const delta = e.lastEvent?.beforeTranslate;
              if (!delta || Math.hypot(delta[0], delta[1]) < 2) {
                resetTarget();
                requestAnimationFrame(() => moveable.current?.updateRect());
                return;
              }
              commitTransform({
                x: clamp(
                  selected.transform2D.x + delta[0] / scale,
                  0,
                  1280 - selected.transform2D.width,
                ),
                y: clamp(
                  selected.transform2D.y + delta[1] / scale,
                  0,
                  720 - selected.transform2D.height,
                ),
              });
              resetTarget();
            }}
            onResize={(e) => {
              e.target.style.width = `${Math.max(20 * scale, e.width)}px`;
              e.target.style.height = `${Math.max(20 * scale, e.height)}px`;
              e.target.style.transform = `translate(${e.drag.beforeTranslate[0]}px,${e.drag.beforeTranslate[1]}px) rotate(${selected.transform2D.rotation}deg)`;
            }}
            onResizeEnd={(e) => {
              const last = e.lastEvent;
              if (!last) {
                resetTarget();
                requestAnimationFrame(() => moveable.current?.updateRect());
                return;
              }
              const width = Math.max(20, last.width / scale),
                height = Math.max(20, last.height / scale);
              commitTransform({
                width,
                height,
                x: clamp(
                  selected.transform2D.x + last.drag.beforeTranslate[0] / scale,
                  0,
                  1280 - width,
                ),
                y: clamp(
                  selected.transform2D.y + last.drag.beforeTranslate[1] / scale,
                  0,
                  720 - height,
                ),
              });
              resetTarget();
            }}
            onRotate={(e) => {
              e.target.style.transform = `rotate(${e.beforeRotation}deg)`;
            }}
            onRotateEnd={(e) => {
              if (e.lastEvent)
                commitTransform({
                  rotation: e.lastEvent.beforeRotation,
                });
              resetTarget();
            }}
          />
        )}
    </div>
  );
}
function OverlayItem({
  project,
  layer,
  frame,
  scale,
  selected,
  onSelect,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
  frame: number;
  scale: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const asset = useAssetUrl(layer.media?.assetId),
    baseTransform = layer.transform2D,
    transform = {
      x: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "overlay.position.x",
        frame,
        baseTransform.x,
      ),
      y: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "overlay.position.y",
        frame,
        baseTransform.y,
      ),
      width: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "overlay.width",
        frame,
        baseTransform.width,
      ),
      height: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "overlay.height",
        frame,
        baseTransform.height,
      ),
      rotation: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "overlay.rotation",
        frame,
        baseTransform.rotation,
      ),
      opacity: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "overlay.opacity",
        frame,
        baseTransform.opacity,
      ),
    },
    style = {
      ...layer.textStyle,
      fontSize: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "text.fontSize",
        frame,
        layer.textStyle.fontSize,
      ),
      letterSpacing: evaluateNumericProperty(
        project.keyframeTracks,
        layer.id,
        "text.letterSpacing",
        frame,
        layer.textStyle.letterSpacing,
      ),
      color: evaluateColorProperty(
        project.keyframeTracks,
        layer.id,
        "overlay.color",
        frame,
        layer.textStyle.color,
      ),
    },
    textAnimation = evaluateTextAnimation(layer, frame);
  return (
    <div
      data-overlay-id={layer.id}
      className={`overlayItem ${selected ? "selected" : ""}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      style={{
        left: transform.x * scale,
        top: transform.y * scale,
        width: transform.width * scale,
        height: transform.height * scale,
        opacity: transform.opacity * textAnimation.opacity,
        transform: `translateY(${textAnimation.translateY * scale}px) rotate(${transform.rotation}deg) scale(${textAnimation.scale})`,
        zIndex: layer.zIndex,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize * scale,
        color: style.color,
        textAlign: style.align,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing * scale,
      }}
    >
      {layer.type === "image" ? (
        asset.url ? (
          <img src={asset.url} alt={layer.name} />
        ) : (
          <span className="imagePlaceholder">
            <I.Image /> Loading image…
          </span>
        )
      ) : (
        evaluateAnimatedText(layer, frame, project.canvas.fps)
      )}
    </div>
  );
}
function PreviewOverlays({
  project,
  frame,
}: {
  project: TemplateProject;
  frame: number;
}) {
  const wrapper = useRef<HTMLDivElement>(null),
    [scale, setScale] = useState(1);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setScale(
        Math.max(
          0.01,
          Math.min(
            entry.contentRect.width / 1280,
            entry.contentRect.height / 720,
          ),
        ),
      ),
    );
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="overlayViewport previewOverlays" ref={wrapper}>
      <div
        className="designStage"
        style={{ width: 1280 * scale, height: 720 * scale }}
      >
        {project.layers
          .filter(
            (layer) =>
              (layer.type === "text" || layer.type === "image") &&
              !(layer.type === "text" && layer.is3D) &&
              layer.visible &&
              frame >= layer.startFrame &&
              frame < layer.startFrame + layer.durationInFrames,
          )
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((layer) => (
            <OverlayItem
              key={layer.id}
              project={project}
              layer={layer}
              frame={frame}
              scale={scale}
              selected={false}
              onSelect={() => {}}
            />
          ))}
      </div>
    </div>
  );
}
function CompositionTools({
  tool,
  project,
  update,
  onSelect,
}: {
  tool: string;
  project: TemplateProject;
  update: (recipe: (draft: TemplateProject) => void) => void;
  onSelect: (id: string) => void;
}) {
  if (tool !== "Text" && tool !== "Media") return null;
  const addText = (kind: string) => {
    const presets: Record<string, [string, number, number, number]> = {
        Heading: ["Your headline", 64, 120, 120],
        Subtitle: ["A clear supporting message", 34, 140, 220],
        Caption: ["Feature caption", 22, 160, 310],
        CTA: ["Get Started", 26, 170, 390],
      },
      preset = presets[kind],
      id = crypto.randomUUID();
    update((d) =>
      d.layers.push(
        createOverlayLayer(id, kind, preset, d.canvas.durationInFrames),
      ),
    );
    onSelect(id);
  };
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    try {
      const type = await validateMedia(file);
      if (type !== "image") throw new Error("Choose an image for this layer.");
      const assetId = await saveAsset(file),
        id = crypto.randomUUID();
      update((d) => {
        const layer = createOverlayLayer(
          id,
          "Logo",
          ["", 24, 900, 90],
          d.canvas.durationInFrames,
        );
        layer.type = "image";
        layer.transform2D.width = 220;
        layer.transform2D.height = 120;
        layer.media = { assetId, fileName: file.name, type: "image" };
        d.layers.push(layer);
      });
      onSelect(id);
    } catch {}
  };
  return (
    <div className="compositionTools">
      {tool === "Text" ? (
        <>
          {["Heading", "Subtitle", "Caption", "CTA"].map((kind) => (
            <button key={kind} onClick={() => addText(kind)}>
              <I.Type />
              {kind}
            </button>
          ))}
        </>
      ) : (
        <label>
          <I.Image /> Add Logo/Image
          <input
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void uploadLogo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
function CameraInspector({
  project,
  frame,
  update,
}: {
  project: TemplateProject;
  frame: number;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const camera = project.camera ?? {
    position: [0, 0.6, 4] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 35,
    defaultPosition: [0, 0.6, 4] as [number, number, number],
    defaultTarget: [0, 0, 0] as [number, number, number],
  };
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>Camera</h2>
        <I.Video />
      </div>
      <InspectorKeyframes
        project={project}
        layer={project.layers.find((item) => item.type === "camera")!}
        frame={frame}
        update={update}
      />
      <Panel title="Camera View">
        <label>Position</label>
        <div className="triple">
          {["X", "Y", "Z"].map((axis, i) => (
            <Field
              key={axis}
              label={axis}
              value={camera.position[i]}
              onChange={(value) =>
                update((d) => {
                  ensureCamera(d).position[i] = value;
                })
              }
            />
          ))}
        </div>
        <label>Target</label>
        <div className="triple">
          {["X", "Y", "Z"].map((axis, i) => (
            <Field
              key={axis}
              label={axis}
              value={camera.target[i]}
              onChange={(value) =>
                update((d) => {
                  ensureCamera(d).target[i] = value;
                })
              }
            />
          ))}
        </div>
        <div className="row">
          <label>View</label>
          <input
            type="range"
            min="15"
            max="80"
            value={camera.fov}
            onChange={(e) =>
              update((d) => {
                ensureCamera(d).fov = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">{camera.fov}°</div>
        </div>
        <div className="normalizationActions">
          <button
            onClick={() =>
              update((d) => {
                const c = ensureCamera(d);
                c.defaultPosition = [...c.position];
                c.defaultTarget = [...c.target];
              })
            }
          >
            <I.BookmarkCheck /> Save framing
          </button>
          <button
            onClick={() =>
              update((d) => {
                const c = ensureCamera(d);
                c.position = [...c.defaultPosition];
                c.target = [...c.defaultTarget];
              })
            }
          >
            <I.History /> Restore framing
          </button>
        </div>
      </Panel>
    </aside>
  );
}
function LightingInspector({
  project,
  frame,
  update,
}: {
  project: TemplateProject;
  frame: number;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const lighting = project.lighting;
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>Lighting</h2>
        <I.Sun />
      </div>
      <InspectorKeyframes
        project={project}
        layer={project.layers.find((item) => item.type === "lighting")!}
        frame={frame}
        update={update}
      />
      <Panel title="Studio Lighting">
        <Select
          label="Preset"
          value={lighting.preset}
          options={["Soft Studio", "Bright Product", "Dark Cinematic"]}
          onChange={(value) =>
            update((d) =>
              applyLightingPreset(
                d,
                value as TemplateProject["lighting"]["preset"],
              ),
            )
          }
        />
        <div className="row">
          <label>Environment</label>
          <input
            type="range"
            min="0"
            max="3"
            step=".05"
            value={lighting.environmentIntensity}
            onChange={(e) =>
              update((d) => {
                d.lighting.environmentIntensity = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">
            {lighting.environmentIntensity.toFixed(1)}
          </div>
        </div>
        <div className="row">
          <label>Key light</label>
          <input
            type="range"
            min="0"
            max="6"
            step=".1"
            value={lighting.keyIntensity}
            onChange={(e) =>
              update((d) => {
                d.lighting.keyIntensity = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">{lighting.keyIntensity.toFixed(1)}</div>
        </div>
        <div className="row">
          <label>Key color</label>
          <input
            className="colorInput"
            type="color"
            value={lighting.keyColor}
            onChange={(e) =>
              update((d) => {
                d.lighting.keyColor = e.target.value;
              })
            }
          />
        </div>
        <label>Key Position</label>
        <div className="triple">
          {["X", "Y", "Z"].map((axis, i) => (
            <Field
              key={axis}
              label={axis}
              value={lighting.keyPosition[i]}
              onChange={(value) =>
                update((d) => {
                  d.lighting.keyPosition[i] = value;
                })
              }
            />
          ))}
        </div>
        <div className="row">
          <label>Fill</label>
          <input
            type="range"
            min="0"
            max="4"
            step=".05"
            value={lighting.fillIntensity}
            onChange={(e) =>
              update((d) => {
                d.lighting.fillIntensity = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">{lighting.fillIntensity.toFixed(1)}</div>
        </div>
        <div className="row">
          <label>Shadow</label>
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={lighting.shadowOpacity}
            onChange={(e) =>
              update((d) => {
                d.lighting.shadowOpacity = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">
            {Math.round(lighting.shadowOpacity * 100)}%
          </div>
        </div>
      </Panel>
    </aside>
  );
}
function BackgroundInspector({
  project,
  frame,
  update,
}: {
  project: TemplateProject;
  frame: number;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const background = project.background;
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>Background</h2>
        <I.PanelTop />
      </div>
      <InspectorKeyframes
        project={project}
        layer={project.layers.find((item) => item.type === "background")!}
        frame={frame}
        update={update}
      />
      <Panel title="Canvas Background">
        <Select
          label="Preset"
          value={background.preset}
          options={["Soft Blue", "Lilac Glow", "Midnight Studio"]}
          onChange={(value) =>
            update((d) =>
              applyBackgroundPreset(
                d,
                value as TemplateProject["background"]["preset"],
              ),
            )
          }
        />
        <div className="segments backgroundType">
          <button
            className={background.type === "solid" ? "on" : ""}
            onClick={() =>
              update((d) => {
                d.background.type = "solid";
              })
            }
          >
            Solid
          </button>
          <button
            className={background.type === "gradient" ? "on" : ""}
            onClick={() =>
              update((d) => {
                d.background.type = "gradient";
              })
            }
          >
            Gradient
          </button>
        </div>
        <div className="colorRows">
          <label>
            Primary{" "}
            <input
              type="color"
              value={background.colorA}
              onChange={(e) =>
                update((d) => {
                  d.background.colorA = e.target.value;
                })
              }
            />
          </label>
          {background.type === "gradient" && (
            <label>
              Secondary{" "}
              <input
                type="color"
                value={background.colorB}
                onChange={(e) =>
                  update((d) => {
                    d.background.colorB = e.target.value;
                  })
                }
              />
            </label>
          )}
        </div>
        {background.type === "gradient" && (
          <div className="row">
            <label>Direction</label>
            <input
              type="range"
              min="0"
              max="360"
              value={background.angle}
              onChange={(e) =>
                update((d) => {
                  d.background.angle = Number(e.target.value);
                })
              }
            />
            <div className="smallInput">{background.angle}°</div>
          </div>
        )}
      </Panel>
    </aside>
  );
}
function OverlayInspectorV2({
  project,
  layer,
  frame,
  update,
  mode,
  setMode,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
  frame: number;
  update: (recipe: (draft: TemplateProject) => void) => void;
  mode: TransformMode;
  setMode: (mode: TransformMode) => void;
}) {
  const setSelected = useEditorStore((s) => s.setSelectedLayer),
    mutate = (recipe: (item: ProjectLayer) => void) =>
      update((d) => {
        const item = d.layers.find((value) => value.id === layer.id);
        if (item) recipe(item);
      }),
    style = layer.textStyle,
    transform = layer.transform2D;
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>{layer.name}</h2>
        <I.MoreHorizontal />
      </div>
      <InspectorKeyframes
        project={project}
        layer={layer}
        frame={frame}
        update={update}
      />
      {layer.type === "text" && (
        <Panel title="Content">
          <textarea
            className="contentArea"
            value={layer.content ?? ""}
            onChange={(e) =>
              mutate((item) => {
                item.content = e.target.value;
              })
            }
          />
        </Panel>
      )}
      {layer.type === "text" && (
        <Panel title="Typography">
          <Select
            label="Font"
            value={style.fontFamily}
            options={["Inter", "Arial", "Georgia", "Courier New"]}
            onChange={(value) =>
              mutate((item) => {
                item.textStyle.fontFamily = value;
              })
            }
          />
          <div className="triple">
            <Field
              label="Size"
              value={style.fontSize}
              onChange={(value) =>
                mutate((item) => {
                  item.textStyle.fontSize = Math.max(8, value);
                })
              }
            />
            <Field
              label="Weight"
              value={style.fontWeight}
              onChange={(value) =>
                mutate((item) => {
                  item.textStyle.fontWeight = value;
                })
              }
            />
            <Field
              label="Track"
              value={style.letterSpacing}
              onChange={(value) =>
                mutate((item) => {
                  item.textStyle.letterSpacing = value;
                })
              }
            />
          </div>
          <div className="row">
            <label>Color</label>
            <input
              className="colorInput"
              type="color"
              value={style.color}
              onChange={(e) =>
                mutate((item) => {
                  item.textStyle.color = e.target.value;
                })
              }
            />
          </div>
          <div className="segments">
            {(["left", "center", "right"] as const).map((value) => (
              <button
                key={value}
                className={style.align === value ? "on" : ""}
                onClick={() =>
                  mutate((item) => {
                    item.textStyle.align = value;
                  })
                }
              >
                {value}
              </button>
            ))}
          </div>
        </Panel>
      )}
      {layer.type === "text" && (
        <Panel title="Text Animation">
          <Select
            label="Entrance"
            value={layer.textAnimation.entrance}
            options={["none", "fade", "slide-up", "scale", "typewriter"]}
            onChange={(value) =>
              mutate((item) => {
                item.textAnimation.entrance = value as TextAnimationPreset;
              })
            }
          />
          <Select
            label="Exit"
            value={layer.textAnimation.exit}
            options={["none", "fade", "slide-up", "scale"]}
            onChange={(value) =>
              mutate((item) => {
                item.textAnimation.exit = value as TextAnimationPreset;
              })
            }
          />
          <div className="row">
            <label>Duration</label>
            <Field
              label="Frames"
              value={layer.textAnimation.durationInFrames}
              onChange={(value) =>
                mutate((item) => {
                  item.textAnimation.durationInFrames = Math.max(
                    1,
                    Math.round(value),
                  );
                })
              }
            />
          </div>
          {layer.textAnimation.entrance === "typewriter" && (
            <>
              <div className="row">
                <label>Typing Speed</label>
                <Field
                  label="Characters/sec"
                  value={layer.textAnimation.typingSpeed}
                  onChange={(value) =>
                    mutate((item) => {
                      item.textAnimation.typingSpeed = Math.max(1, value);
                    })
                  }
                />
              </div>
              <Select
                label="Cursor"
                value={layer.textAnimation.cursor}
                options={["none", "line", "block"]}
                onChange={(value) =>
                  mutate((item) => {
                    item.textAnimation.cursor = value as TextCursorStyle;
                  })
                }
              />
            </>
          )}
        </Panel>
      )}
      {layer.type === "text" && (
        <Panel title="Layer Mode">
          <button
            className={`threeDLayerToggle ${layer.is3D ? "on" : ""}`}
            onClick={() =>
              mutate((item) => {
                item.is3D = !item.is3D;
                if (item.is3D) {
                  item.transform3D.position = [
                    (item.transform2D.x + item.transform2D.width / 2 - 640) /
                      320,
                    -(item.transform2D.y + item.transform2D.height / 2 - 360) /
                      320,
                    1,
                  ];
                  item.transform3D.rotation[2] = item.transform2D.rotation;
                }
              })
            }
          >
            <I.Box /> {layer.is3D ? "3D Layer Enabled" : "Enable 3D Layer"}
          </button>
        </Panel>
      )}
      {layer.is3D ? (
        <Panel title="3D Transform">
          <div className="transformModes">
            <button
              className={mode === "translate" ? "on" : ""}
              onClick={() => setMode("translate")}
            >
              <I.Move3d /> Move
            </button>
            <button
              className={mode === "rotate" ? "on" : ""}
              onClick={() => setMode("rotate")}
            >
              <I.Rotate3d /> Rotate
            </button>
            <button
              className={mode === "scale" ? "on" : ""}
              onClick={() => setMode("scale")}
            >
              <I.Maximize2 /> Scale
            </button>
          </div>
          <label>Position</label>
          <div className="triple">
            {["X", "Y", "Z"].map((axis, index) => (
              <Field
                key={axis}
                label={axis}
                value={layer.transform3D.position[index]}
                onChange={(value) =>
                  mutate((item) => {
                    item.transform3D.position[index] = value;
                  })
                }
              />
            ))}
          </div>
          <label>Rotation</label>
          <div className="triple">
            {["X", "Y", "Z"].map((axis, index) => (
              <Field
                key={axis}
                label={axis}
                suffix="°"
                value={layer.transform3D.rotation[index]}
                onChange={(value) =>
                  mutate((item) => {
                    item.transform3D.rotation[index] = value;
                  })
                }
              />
            ))}
          </div>
          <div className="triple">
            <Field
              label="Scale"
              value={layer.transform3D.scale}
              onChange={(value) =>
                mutate((item) => {
                  item.transform3D.scale = Math.max(0.01, value);
                })
              }
            />
            <Field
              label="Width"
              value={transform.width}
              onChange={(value) =>
                mutate((item) => {
                  item.transform2D.width = Math.max(20, value);
                })
              }
            />
          </div>
        </Panel>
      ) : (
        <Panel title="Transform">
          <div className="triple">
            <Field
              label="X"
              value={transform.x}
              onChange={(value) =>
                mutate((item) => {
                  item.transform2D.x = value;
                })
              }
            />
            <Field
              label="Y"
              value={transform.y}
              onChange={(value) =>
                mutate((item) => {
                  item.transform2D.y = value;
                })
              }
            />
            <Field
              label="Rot"
              suffix="°"
              value={transform.rotation}
              onChange={(value) =>
                mutate((item) => {
                  item.transform2D.rotation = value;
                })
              }
            />
          </div>
          <div className="triple">
            <Field
              label="W"
              value={transform.width}
              onChange={(value) =>
                mutate((item) => {
                  item.transform2D.width = Math.max(20, value);
                })
              }
            />
            <Field
              label="H"
              value={transform.height}
              onChange={(value) =>
                mutate((item) => {
                  item.transform2D.height = Math.max(20, value);
                })
              }
            />
          </div>
          <div className="row">
            <label>Opacity</label>
            <input
              type="range"
              min="0"
              max="1"
              step=".05"
              value={transform.opacity}
              onChange={(e) =>
                mutate((item) => {
                  item.transform2D.opacity = Number(e.target.value);
                })
              }
            />
            <div className="smallInput">
              {Math.round(transform.opacity * 100)}%
            </div>
          </div>
        </Panel>
      )}
      <Panel title="Timing">
        <div className="triple">
          <Field
            label="Start"
            value={layer.startFrame}
            onChange={(value) =>
              mutate((item) => {
                item.startFrame = Math.round(
                  clamp(value, 0, project.canvas.durationInFrames - 1),
                );
              })
            }
          />
          <Field
            label="Frames"
            value={layer.durationInFrames}
            onChange={(value) =>
              mutate((item) => {
                item.durationInFrames = Math.round(
                  clamp(
                    value,
                    1,
                    project.canvas.durationInFrames - item.startFrame,
                  ),
                );
              })
            }
          />
        </div>
      </Panel>
      <Panel title="Layer">
        <div className="layerActions">
          <button
            onClick={() => {
              const id = crypto.randomUUID();
              update((d) => {
                const source = d.layers.find((value) => value.id === layer.id);
                if (!source) return;
                const copy = structuredClone(source);
                copy.id = id;
                copy.name = `${source.name} Copy`;
                copy.transform2D.x += 24;
                copy.transform2D.y += 24;
                d.layers.push(copy);
              });
              setSelected(id);
            }}
          >
            <I.Copy /> Duplicate
          </button>
          <button
            onClick={() =>
              mutate((item) => {
                item.zIndex++;
              })
            }
          >
            <I.ArrowUp /> Bring forward
          </button>
          <button
            onClick={() =>
              mutate((item) => {
                item.zIndex--;
              })
            }
          >
            <I.ArrowDown /> Send backward
          </button>
          <button
            className="danger"
            onClick={() => {
              update((d) => {
                d.layers = d.layers.filter((value) => value.id !== layer.id);
              });
              setSelected("phone");
            }}
          >
            <I.Trash2 /> Delete
          </button>
        </div>
      </Panel>
    </aside>
  );
}
function OverlayInspector({
  project,
  layer,
  update,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const setSelected = useEditorStore((s) => s.setSelectedLayer),
    style = layer.textStyle,
    transform = layer.transform2D,
    mutate = (recipe: (item: ProjectLayer) => void) =>
      update((d) => {
        const item = d.layers.find((value) => value.id === layer.id);
        if (item) recipe(item);
      });
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>{layer.name}</h2>
        <I.MoreHorizontal />
      </div>
      {layer.type === "text" && (
        <Panel title="Content">
          <textarea
            className="contentArea"
            value={layer.content ?? ""}
            onChange={(e) =>
              mutate((item) => {
                item.content = e.target.value;
              })
            }
          />
        </Panel>
      )}
      {layer.type === "text" && (
        <Panel title="Typography">
          <Select
            label="Font"
            value={style.fontFamily}
            options={["Inter", "Arial", "Georgia", "Courier New"]}
            onChange={(value) =>
              mutate((item) => {
                item.textStyle.fontFamily = value;
              })
            }
          />
          <div className="triple">
            <Field
              label="Size"
              value={style.fontSize}
              onChange={(value) =>
                mutate((item) => {
                  item.textStyle.fontSize = Math.max(8, value);
                })
              }
            />
            <Field
              label="Weight"
              value={style.fontWeight}
              onChange={(value) =>
                mutate((item) => {
                  item.textStyle.fontWeight = value;
                })
              }
            />
            <Field
              label="Track"
              value={style.letterSpacing}
              onChange={(value) =>
                mutate((item) => {
                  item.textStyle.letterSpacing = value;
                })
              }
            />
          </div>
          <div className="row">
            <label>Color</label>
            <input
              className="colorInput"
              type="color"
              value={style.color}
              onChange={(e) =>
                mutate((item) => {
                  item.textStyle.color = e.target.value;
                })
              }
            />
          </div>
          <div className="segments">
            {(["left", "center", "right"] as const).map((value) => (
              <button
                key={value}
                className={style.align === value ? "on" : ""}
                onClick={() =>
                  mutate((item) => {
                    item.textStyle.align = value;
                  })
                }
              >
                {value}
              </button>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="Transform">
        <div className="triple">
          <Field
            label="X"
            value={transform.x}
            onChange={(value) =>
              mutate((item) => {
                item.transform2D.x = value;
              })
            }
          />
          <Field
            label="Y"
            value={transform.y}
            onChange={(value) =>
              mutate((item) => {
                item.transform2D.y = value;
              })
            }
          />
          <Field
            label="Rot"
            suffix="°"
            value={transform.rotation}
            onChange={(value) =>
              mutate((item) => {
                item.transform2D.rotation = value;
              })
            }
          />
        </div>
        <div className="triple">
          <Field
            label="W"
            value={transform.width}
            onChange={(value) =>
              mutate((item) => {
                item.transform2D.width = Math.max(20, value);
              })
            }
          />
          <Field
            label="H"
            value={transform.height}
            onChange={(value) =>
              mutate((item) => {
                item.transform2D.height = Math.max(20, value);
              })
            }
          />
        </div>
        <div className="row">
          <label>Opacity</label>
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={transform.opacity}
            onChange={(e) =>
              mutate((item) => {
                item.transform2D.opacity = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">
            {Math.round(transform.opacity * 100)}%
          </div>
        </div>
      </Panel>
      <Panel title="Layer">
        <div className="layerActions">
          <button
            onClick={() =>
              update((d) => {
                const source = d.layers.find((value) => value.id === layer.id);
                if (!source) return;
                const copy = structuredClone(source);
                copy.id = crypto.randomUUID();
                copy.name = `${source.name} Copy`;
                copy.transform2D.x += 24;
                copy.transform2D.y += 24;
                d.layers.push(copy);
                setSelected(copy.id);
              })
            }
          >
            <I.Copy /> Duplicate
          </button>
          <button
            onClick={() =>
              mutate((item) => {
                item.zIndex++;
              })
            }
          >
            <I.ArrowUp /> Bring forward
          </button>
          <button
            onClick={() =>
              mutate((item) => {
                item.zIndex--;
              })
            }
          >
            <I.ArrowDown /> Send backward
          </button>
          <button
            className="danger"
            onClick={() =>
              update((d) => {
                d.layers = d.layers.filter((value) => value.id !== layer.id);
                setSelected("phone");
              })
            }
          >
            <I.Trash2 /> Delete
          </button>
        </div>
      </Panel>
    </aside>
  );
}
function ensureScreen(
  project: TemplateProject,
): NonNullable<TemplateProject["screen"]> {
  if (!project.screen)
    project.screen = {
      mode: "material",
      materialName: project.model?.stats?.materialNames[0] ?? "",
      testPattern: true,
      fit: "fill",
      flipY: false,
      rotation: 0,
      offset: [0, 0],
      scale: [1, 1],
      emissionIntensity: 1,
      planePosition: [0, 1, 0.02],
      planeRotation: [0, 0, 0],
      planeSize: [0.9, 1.8],
    };
  return project.screen;
}
function ensureCamera(
  project: TemplateProject,
): NonNullable<TemplateProject["camera"]> {
  if (!project.camera)
    project.camera = {
      position: [0, 0.6, 4],
      target: [0, 0, 0],
      fov: 35,
      defaultPosition: [0, 0.6, 4],
      defaultTarget: [0, 0, 0],
    };
  return project.camera;
}
function applyLightingPreset(
  project: TemplateProject,
  preset: TemplateProject["lighting"]["preset"],
) {
  const values =
    preset === "Bright Product"
      ? {
          environmentIntensity: 2,
          keyColor: "#ffffff",
          keyIntensity: 4,
          keyPosition: [4, 6, 3] as [number, number, number],
          fillIntensity: 2,
          shadowOpacity: 0.22,
          shadowSoftness: 3,
        }
      : preset === "Dark Cinematic"
        ? {
            environmentIntensity: 0.35,
            keyColor: "#9db8ff",
            keyIntensity: 3.2,
            keyPosition: [-3, 4, 2] as [number, number, number],
            fillIntensity: 0.3,
            shadowOpacity: 0.6,
            shadowSoftness: 1.6,
          }
        : {
            environmentIntensity: 1.2,
            keyColor: "#ffffff",
            keyIntensity: 2.4,
            keyPosition: [3, 5, 4] as [number, number, number],
            fillIntensity: 1.2,
            shadowOpacity: 0.3,
            shadowSoftness: 2.5,
          };
  project.lighting = { preset, ...values };
}
function applyBackgroundPreset(
  project: TemplateProject,
  preset: TemplateProject["background"]["preset"],
) {
  const colors =
    preset === "Soft Blue"
      ? ["#eaf2ff", "#dde7ff"]
      : preset === "Midnight Studio"
        ? ["#111827", "#312e81"]
        : ["#d9e8ff", "#f0d9ec"];
  project.background = {
    preset,
    type: "gradient",
    colorA: colors[0],
    colorB: colors[1],
    angle: 135,
  };
}
function backgroundStyle(project: TemplateProject, frame = 0) {
  const backgroundId =
      project.layers.find((layer) => layer.type === "background")?.id ??
      "background",
    background = {
      ...project.background,
      colorA: evaluateColorProperty(
        project.keyframeTracks,
        backgroundId,
        "background.colorA",
        frame,
        project.background.colorA,
      ),
      colorB: evaluateColorProperty(
        project.keyframeTracks,
        backgroundId,
        "background.colorB",
        frame,
        project.background.colorB,
      ),
      angle: evaluateNumericProperty(
        project.keyframeTracks,
        backgroundId,
        "background.angle",
        frame,
        project.background.angle,
      ),
    },
    visible =
      project.layers.find((layer) => layer.type === "background")?.visible ??
      true;
  return {
    background: visible
      ? background.type === "solid"
        ? background.colorA
        : `linear-gradient(${background.angle}deg, ${background.colorA}, ${background.colorB})`
      : "#ececef",
  };
}
function setNumericKeyframe(
  project: TemplateProject,
  targetId: string,
  property: Extract<KeyframeTrack, { valueType: "number" }>["property"],
  frame: number,
  value: number,
) {
  let track = findKeyframeTrack(project.keyframeTracks, targetId, property);
  if (!track) {
    track = createNumericTrack(targetId, property);
    project.keyframeTracks.push(track);
  }
  if (track.valueType === "number")
    upsertNumericKeyframe(track, Math.max(0, Math.round(frame)), value, {
      easing: "ease-in-out",
    });
}

function setColorKeyframe(
  project: TemplateProject,
  targetId: string,
  property: Extract<KeyframeTrack, { valueType: "color" }>["property"],
  frame: number,
  value: string,
) {
  let track = findKeyframeTrack(project.keyframeTracks, targetId, property);
  if (!track) {
    track = createColorTrack(targetId, property);
    project.keyframeTracks.push(track);
  }
  if (track.valueType === "color")
    upsertColorKeyframe(track, Math.max(0, Math.round(frame)), value, {
      easing: "ease-in-out",
    });
}
function createTemplateThumbnail(project: TemplateProject) {
  const title =
      project.layers.find((layer) => layer.type === "text")?.content ??
      project.name,
    escape = (value: string) =>
      value.replace(/[&<>"']/g, (character) => {
        const entities: Record<string, string> = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        };
        return entities[character];
      }),
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${project.background.colorA}"/><stop offset="1" stop-color="${project.background.colorB}"/></linearGradient></defs><rect width="640" height="360" rx="20" fill="url(#g)"/><text x="48" y="154" fill="#152144" font-family="Inter,Arial" font-size="34" font-weight="700">${escape(title).slice(0, 34)}</text><text x="48" y="205" fill="#152144" opacity=".65" font-family="Inter,Arial" font-size="18">${escape(project.name).slice(0, 48)}</text><rect x="470" y="55" width="105" height="235" rx="24" fill="#111827" transform="rotate(8 522 172)"/><rect x="480" y="67" width="85" height="211" rx="18" fill="#dbeafe" transform="rotate(8 522 172)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function createOverlayLayer(
  id: string,
  name: string,
  preset: [string, number, number, number],
  duration: number,
): ProjectLayer {
  return {
    id,
    type: "text",
    name,
    startFrame: 0,
    durationInFrames: duration,
    visible: true,
    locked: false,
    replaceable: true,
    zIndex: 10,
    color: "#c0aaff",
    content: preset[0],
    is3D: false,
    transform3D: {
      position: [0, 0, 1],
      rotation: [0, 0, 0],
      scale: 1,
    },
    transform2D: {
      x: preset[2],
      y: preset[3],
      width: 520,
      height: preset[1] * 1.8,
      rotation: 0,
      opacity: 1,
    },
    textStyle: {
      fontFamily: "Inter",
      fontWeight: name === "Caption" ? 500 : 700,
      fontSize: preset[1],
      color: "#152144",
      align: "left",
      lineHeight: 1.05,
      letterSpacing: -1,
    },
    textAnimation: {
      entrance: "none",
      exit: "none",
      durationInFrames: 18,
      typingSpeed: 18,
      cursor: "line",
    },
  };
}
async function validateMedia(file: File): Promise<"image" | "video"> {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("Media must be smaller than 100 MB.");
  if (file.type.startsWith("image/")) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error("Use a PNG, JPEG, or WebP image.");
    return "image";
  }
  if (!["video/mp4", "video/webm"].includes(file.type))
    throw new Error("Use an MP4 or WebM video.");
  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () =>
        reject(new Error("This video could not be decoded."));
      video.src = url;
    });
    if (!Number.isFinite(duration) || duration > 30)
      throw new Error("Video must be 30 seconds or shorter.");
    return "video";
  } finally {
    URL.revokeObjectURL(url);
  }
}
