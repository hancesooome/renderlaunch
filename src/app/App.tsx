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
import { clamp, easeOutCubic, formatTimecode } from "../animation/frame";
import { evaluateOverlayFrame } from "../animation/presets";
import type { ProjectLayer, TemplateProject } from "../project/schema";
import { useEditorStore } from "../store/editorStore";
import type { TransformMode } from "../store/editorStore";
import { useEditorRuntime } from "../store/useEditorRuntime";
import { inspectGlb } from "../model/inspectGlb";
import { saveAsset } from "../persistence/database";
import { SceneCanvas } from "../scene/SceneCanvas";
import { useAssetUrl } from "../model/useAssetUrl";

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
  const project = useEditorStore((s) => s.project),
    frame = useEditorStore((s) => s.currentFrame),
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
    setPlaying = useEditorStore((s) => s.setPlaying),
    setSelected = useEditorStore((s) => s.setSelectedLayer),
    setTool = useEditorStore((s) => s.setActiveTool),
    setZoom = useEditorStore((s) => s.setZoom),
    setPreview = useEditorStore((s) => s.setPreview),
    undo = useEditorStore((s) => s.undo),
    redo = useEditorStore((s) => s.redo),
    persist = useEditorStore((s) => s.persist);
  const selected =
    project.layers.find((layer) => layer.id === selectedId) ??
    project.layers[0];
  const transformMode = useEditorStore((s) => s.transformMode),
    setTransformMode = useEditorStore((s) => s.setTransformMode);
  const [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const [frameRequest, setFrameRequest] = useState(0);
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
  if (preview)
    return (
      <Preview
        project={project}
        frame={frame}
        playing={playing}
        onFrame={setFrame}
        onPlay={setPlaying}
        onClose={() => setPreview(false)}
      />
    );
  return (
    <main>
      <header>
        <button className="icon" aria-label="Back">
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
          <button onClick={() => setPreview(true)}>
            <I.Play /> Preview
          </button>
          <button className="primary" onClick={() => void persist()}>
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
          <button className="settings">
            <I.Settings />
            <span>Settings</span>
          </button>
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
        <div
          className={`workspace ${bgClass(project.background.preset)}`}
          style={backgroundStyle(project)}
        >
          <div className="canvasGlow" />
          {isLayerActive(project, "phone", frame) && project.model?.assetId ? (
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
              onTransform={(value) =>
                update((d) => {
                  if (d.model) {
                    d.model.position = value.position;
                    d.model.rotation = value.rotation;
                    d.model.scale = Math.max(0.01, value.scale);
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
                  d.camera.position = position;
                  d.camera.target = target;
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
        <Inspector
          project={project}
          layer={selected}
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
        update={update}
        onFrame={setFrame}
        onPlay={setPlaying}
        onSelect={setSelected}
      />
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
  onToggle: (key: "visible" | "locked") => void;
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

function Inspector({
  project,
  layer,
  update,
  mode,
  setMode,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
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
    return <CameraInspector project={project} update={update} />;
  if (layer.type === "lighting")
    return <LightingInspector project={project} update={update} />;
  if (layer.type === "background")
    return <BackgroundInspector project={project} update={update} />;
  if (layer.type === "text" || layer.type === "image")
    return (
      <OverlayInspectorV2 project={project} layer={layer} update={update} />
    );
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>{layer.name}</h2>
        <I.MoreHorizontal />
      </div>
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
      <Panel title="Preset Timing">
        <div className="triple">
          <Field
            label="Start"
            value={
              project.layers.find((item) => item.type === "device")
                ?.startFrame ?? 0
            }
            onChange={(value) =>
              update((d) => {
                const item = d.layers.find((entry) => entry.type === "device");
                if (item)
                  item.startFrame = Math.round(
                    clamp(value, 0, d.canvas.durationInFrames - 1),
                  );
              })
            }
          />
          <Field
            label="Frames"
            value={project.animation.durationInFrames}
            onChange={(value) =>
              update((d) => {
                d.animation.durationInFrames = Math.max(1, Math.round(value));
              })
            }
          />
        </div>
        <Select
          label="Easing"
          value={project.animation.easing}
          options={["linear", "ease-in", "ease-out", "ease-in-out"]}
          onChange={(value) =>
            update((d) => {
              d.animation.easing =
                value as TemplateProject["animation"]["easing"];
            })
          }
        />
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
      <Panel title="Animation">
        <Select
          label="Preset"
          value={project.animation.preset}
          options={["Flip Reveal", "Float and Focus", "Side Slide"]}
          onChange={(value) =>
            update((d) => {
              d.animation.preset =
                value as TemplateProject["animation"]["preset"];
            })
          }
        />
        <Select
          label="Direction"
          value={project.animation.direction}
          options={["Left", "Right", "Up", "Down"]}
          onChange={(value) =>
            update((d) => {
              d.animation.direction =
                value as TemplateProject["animation"]["direction"];
            })
          }
        />
        <div className="row">
          <label>Duration</label>
          <div className="input">
            {(project.animation.durationInFrames / project.canvas.fps).toFixed(
              1,
            )}{" "}
            <span>s</span>
          </div>
        </div>
        <div className="row">
          <label>Intensity</label>
          <input
            type="range"
            value={project.animation.intensity}
            onChange={(e) =>
              update((d) => {
                d.animation.intensity = Number(e.target.value);
              })
            }
          />
          <div className="smallInput">{project.animation.intensity} %</div>
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
  frame,
  project,
  mini = false,
}: {
  frame: number;
  project: TemplateProject;
  mini?: boolean;
}) {
  const rotation = project.model?.rotation ?? [0, 0, 0],
    progress = easeOutCubic(frame / project.animation.durationInFrames),
    direction = project.animation.direction === "Right" ? 1 : -1,
    reveal =
      project.animation.preset === "Flip Reveal"
        ? (direction * (1 - progress) * 75 * project.animation.intensity) / 100
        : 0,
    rise =
      project.animation.preset === "Float and Focus"
        ? (1 - progress) * 60
        : (1 - progress) * 25;
  return (
    <div
      className={`phone ${mini ? "mini" : ""}`}
      style={{
        transform: `perspective(900px) rotateX(${rotation[0]}deg) rotateY(${rotation[1] + reveal}deg) rotateZ(${rotation[2] - 7}deg) translateY(${rise}px) scale(${project.model?.scale ?? 1})`,
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
  update,
  onFrame,
  onPlay,
  onSelect,
}: {
  project: TemplateProject;
  frame: number;
  playing: boolean;
  selectedId: string;
  update: (recipe: (draft: TemplateProject) => void) => void;
  onFrame: (frame: number) => void;
  onPlay: (playing: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const duration = project.canvas.durationInFrames,
    seconds = duration / project.canvas.fps,
    [zoom, setZoom] = useState(1),
    ticks = useMemo(
      () =>
        Array.from(
          { length: Math.ceil(seconds / (zoom >= 2 ? 1 : 2)) },
          (_, i) => i * (zoom >= 2 ? 1 : 2),
        ),
      [seconds, zoom],
    );
  const scrub = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const target = event.currentTarget;
    const updateFrame = (clientX: number) =>
      onFrame(((clientX - rect.left) / rect.width) * duration);
    const move = (pointerEvent: globalThis.PointerEvent) =>
      updateFrame(pointerEvent.clientX);
    const end = () => {
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
  return (
    <footer>
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
        <div className="timelineSurface" style={{ width: `${zoom * 100}%` }}>
          <div className="ruler" onPointerDown={scrub}>
            {ticks.map((second) => (
              <span
                key={second}
                style={{ left: `${(second / seconds) * 100}%` }}
              >
                00:{String(second).padStart(2, "0")}
              </span>
            ))}
          </div>
          <div
            className="playhead"
            style={{
              left: `calc(295px + ${frame / duration} * (100% - 315px))`,
            }}
          >
            <i />
          </div>
          {project.layers
            .filter((layer) => layer.type !== "background")
            .map((layer) => (
              <TimelineTrack
                key={layer.id}
                layer={layer}
                project={project}
                selected={selectedId === layer.id}
                update={update}
                onFrame={onFrame}
                onSelect={onSelect}
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
  selected,
  update,
  onFrame,
  onSelect,
}: {
  layer: ProjectLayer;
  project: TemplateProject;
  selected: boolean;
  update: (recipe: (draft: TemplateProject) => void) => void;
  onFrame: (frame: number) => void;
  onSelect: (id: string) => void;
}) {
  const Icon = icons[layer.type],
    duration = project.canvas.durationInFrames,
    [preview, setPreview] = useState<{ start: number; length: number }>({
      start: layer.startFrame,
      length: layer.durationInFrames,
    }),
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
      ? `${project.animation.preset} (${project.animation.direction})`
      : layer.type === "screen-media"
        ? "Screen media"
        : layer.type === "text"
          ? layer.content
          : layer.type === "lighting"
            ? "Studio lighting"
            : "Camera Move";
  return (
    <div
      className={`track ${selected ? "sel" : ""}`}
      onClick={() => onSelect(layer.id)}
    >
      <div className="trackLabel">
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
    <div
      className={`preview ${bgClass(project.background.preset)}`}
      style={backgroundStyle(project)}
    >
      <button className="backPreview" onClick={onClose}>
        <I.ChevronLeft /> Back to editor
      </button>
      {project.model?.assetId ? (
        <div className="previewModel">
          <SceneCanvas project={project} frame={frame} autoFrame={false} />
        </div>
      ) : (
        <Phone frame={frame} project={project} />
      )}
      <PreviewOverlays project={project} frame={frame} />
      <div className="previewBar">
        <button onClick={() => onPlay(!playing)}>
          {playing ? <I.Pause /> : <I.Play />}
        </button>
        <input
          type="range"
          min="0"
          max={project.canvas.durationInFrames - 1}
          value={frame}
          onChange={(e) => onFrame(Number(e.target.value))}
        />
        <b>
          {formatTimecode(frame, project.canvas.fps)} /{" "}
          {formatTimecode(project.canvas.durationInFrames, project.canvas.fps)}
        </b>
      </div>
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
  const wrapper = useRef<HTMLDivElement>(null),
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
  const commit = (recipe: (item: ProjectLayer) => void) =>
      update((d) => {
        const item = d.layers.find((layer) => layer.id === selectedId);
        if (item) recipe(item);
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
              commit((item) => {
                item.transform2D.x = clamp(
                  selected.transform2D.x + delta[0] / scale,
                  0,
                  1280 - item.transform2D.width,
                );
                item.transform2D.y = clamp(
                  selected.transform2D.y + delta[1] / scale,
                  0,
                  720 - item.transform2D.height,
                );
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
              commit((item) => {
                const width = Math.max(20, last.width / scale),
                  height = Math.max(20, last.height / scale);
                item.transform2D.width = width;
                item.transform2D.height = height;
                item.transform2D.x = clamp(
                  selected.transform2D.x + last.drag.beforeTranslate[0] / scale,
                  0,
                  1280 - width,
                );
                item.transform2D.y = clamp(
                  selected.transform2D.y + last.drag.beforeTranslate[1] / scale,
                  0,
                  720 - height,
                );
              });
              resetTarget();
            }}
            onRotate={(e) => {
              e.target.style.transform = `rotate(${e.beforeRotation}deg)`;
            }}
            onRotateEnd={(e) => {
              if (e.lastEvent)
                commit((item) => {
                  item.transform2D.rotation = e.lastEvent!.beforeRotation;
                });
              resetTarget();
            }}
          />
        )}
    </div>
  );
}
function OverlayItem({
  layer,
  frame,
  scale,
  selected,
  onSelect,
}: {
  layer: ProjectLayer;
  frame: number;
  scale: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const asset = useAssetUrl(layer.media?.assetId),
    transform = layer.transform2D,
    style = layer.textStyle,
    animation = evaluateOverlayFrame(layer, frame);
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
        opacity: transform.opacity * animation.opacity,
        transform: `translate(${animation.x * scale}px,${animation.y * scale}px) rotate(${transform.rotation + animation.rotation}deg) scale(${animation.scale})`,
        filter: `blur(${animation.blur * scale}px)`,
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
        layer.content
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
              layer.visible &&
              frame >= layer.startFrame &&
              frame < layer.startFrame + layer.durationInFrames,
          )
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((layer) => (
            <OverlayItem
              key={layer.id}
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
  update,
}: {
  project: TemplateProject;
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
  update,
}: {
  project: TemplateProject;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const lighting = project.lighting;
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>Lighting</h2>
        <I.Sun />
      </div>
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
  update,
}: {
  project: TemplateProject;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const background = project.background;
  return (
    <aside className="inspector">
      <div className="inspectorHead">
        <h2>Background</h2>
        <I.PanelTop />
      </div>
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
  update,
}: {
  project: TemplateProject;
  layer: ProjectLayer;
  update: (recipe: (draft: TemplateProject) => void) => void;
}) {
  const setSelected = useEditorStore((s) => s.setSelectedLayer),
    mutate = (recipe: (item: ProjectLayer) => void) =>
      update((d) => {
        const item = d.layers.find((value) => value.id === layer.id);
        if (item) recipe(item);
      }),
    style = layer.textStyle,
    transform = layer.transform2D,
    animationOptions = [
      "None",
      "Fade Up",
      "Slide In",
      "Blur Reveal",
      "Scale Pop",
      "Rotate Reveal",
    ];
  const setAnimation = (kind: "entrance" | "exit", value: string) =>
    mutate((item) => {
      if (value === "None") delete item[kind];
      else
        item[kind] = {
          preset: value as NonNullable<ProjectLayer["entrance"]>["preset"],
          durationInFrames: item[kind]?.durationInFrames ?? 20,
          easing: item[kind]?.easing ?? "ease-out",
        };
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
      <Panel title="Animation">
        <Select
          label="Entrance"
          value={layer.entrance?.preset ?? "None"}
          options={animationOptions}
          onChange={(value) => setAnimation("entrance", value)}
        />
        {layer.entrance && (
          <>
            <div className="triple">
              <Field
                label="Frames"
                value={layer.entrance.durationInFrames}
                onChange={(value) =>
                  mutate((item) => {
                    if (item.entrance)
                      item.entrance.durationInFrames = clamp(
                        Math.round(value),
                        1,
                        item.durationInFrames,
                      );
                  })
                }
              />
            </div>
            <Select
              label="Easing"
              value={layer.entrance.easing}
              options={["linear", "ease-in", "ease-out", "ease-in-out"]}
              onChange={(value) =>
                mutate((item) => {
                  if (item.entrance)
                    item.entrance.easing = value as NonNullable<
                      ProjectLayer["entrance"]
                    >["easing"];
                })
              }
            />
          </>
        )}
        <Select
          label="Exit"
          value={layer.exit?.preset ?? "None"}
          options={animationOptions}
          onChange={(value) => setAnimation("exit", value)}
        />
        {layer.exit && (
          <>
            <div className="triple">
              <Field
                label="Frames"
                value={layer.exit.durationInFrames}
                onChange={(value) =>
                  mutate((item) => {
                    if (item.exit)
                      item.exit.durationInFrames = clamp(
                        Math.round(value),
                        1,
                        item.durationInFrames,
                      );
                  })
                }
              />
            </div>
            <Select
              label="Easing"
              value={layer.exit.easing}
              options={["linear", "ease-in", "ease-out", "ease-in-out"]}
              onChange={(value) =>
                mutate((item) => {
                  if (item.exit)
                    item.exit.easing = value as NonNullable<
                      ProjectLayer["exit"]
                    >["easing"];
                })
              }
            />
          </>
        )}
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
function backgroundStyle(project: TemplateProject) {
  const background = project.background,
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
    zIndex: 10,
    color: "#c0aaff",
    content: preset[0],
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
    entrance: { preset: "Fade Up", durationInFrames: 20, easing: "ease-out" },
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
