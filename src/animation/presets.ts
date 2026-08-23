import { clamp } from "./frame";
import type { ProjectLayer, TemplateProject } from "../project/schema";

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type DeviceFrame = {
  x: number;
  y: number;
  rotationY: number;
  scale: number;
};
export type OverlayFrame = {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  blur: number;
};

export function applyEasing(value: number, easing: Easing) {
  const t = clamp(value, 0, 1);
  if (easing === "ease-in") return t * t * t;
  if (easing === "ease-out") return 1 - Math.pow(1 - t, 3);
  if (easing === "ease-in-out")
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return t;
}

export function evaluateDeviceFrame(
  project: TemplateProject,
  frame: number,
): DeviceFrame {
  const layer = project.layers.find((item) => item.type === "device"),
    animation = project.animation;
  const local = frame - (layer?.startFrame ?? 0),
    progress = applyEasing(
      local / animation.durationInFrames,
      animation.easing,
    ),
    remaining = 1 - progress,
    intensity = animation.intensity / 100;
  const horizontal =
      animation.direction === "Right"
        ? 1
        : animation.direction === "Left"
          ? -1
          : 0,
    vertical =
      animation.direction === "Down"
        ? -1
        : animation.direction === "Up"
          ? 1
          : 0;
  if (animation.preset === "Flip Reveal")
    return {
      x: horizontal * remaining * 0.25 * intensity,
      y: vertical * remaining * 0.25 * intensity,
      rotationY: horizontal * remaining * Math.PI * 0.42 * intensity,
      scale: 1,
    };
  if (animation.preset === "Float and Focus")
    return {
      x: horizontal * remaining * 0.35 * intensity,
      y: (vertical || 1) * remaining * 0.8 * intensity,
      rotationY: horizontal * remaining * 0.12 * intensity,
      scale: 1 - remaining * 0.14 * intensity,
    };
  return {
    x: horizontal * remaining * 1.8 * intensity,
    y: vertical * remaining * 1.2 * intensity,
    rotationY: -horizontal * remaining * 0.22 * intensity,
    scale: 1,
  };
}

export function evaluateOverlayFrame(
  layer: ProjectLayer,
  frame: number,
): OverlayFrame {
  const result: OverlayFrame = {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    blur: 0,
  };
  if (layer.entrance) {
    const progress = applyEasing(
      (frame - layer.startFrame) / layer.entrance.durationInFrames,
      layer.entrance.easing,
    );
    applyOverlayPreset(result, layer.entrance.preset, 1 - progress, false);
  }
  if (layer.exit) {
    const exitStart =
        layer.startFrame + layer.durationInFrames - layer.exit.durationInFrames,
      progress = applyEasing(
        (frame - exitStart) / layer.exit.durationInFrames,
        layer.exit.easing,
      );
    if (frame >= exitStart)
      applyOverlayPreset(result, layer.exit.preset, progress, true);
  }
  return result;
}

function applyOverlayPreset(
  result: OverlayFrame,
  preset: NonNullable<ProjectLayer["entrance"]>["preset"],
  amount: number,
  _exit: boolean,
) {
  result.opacity *= 1 - amount;
  if (preset === "Fade Up") result.y += amount * 36;
  else if (preset === "Slide In") result.x -= amount * 70;
  else if (preset === "Blur Reveal") result.blur += amount * 18;
  else if (preset === "Scale Pop") result.scale *= 1 - amount * 0.25;
  else if (preset === "Rotate Reveal") {
    result.rotation -= amount * 8;
    result.y += amount * 16;
  }
}
