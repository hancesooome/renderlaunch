import { clamp } from "./frame";
import type { ProjectLayer } from "../project/schema";

export type TextAnimationState = {
  opacity: number;
  translateY: number;
  scale: number;
};

const easeOut = (value: number) => 1 - Math.pow(1 - value, 3);

export function evaluateTextAnimation(
  layer: ProjectLayer,
  frame: number,
): TextAnimationState {
  if (layer.type !== "text") return { opacity: 1, translateY: 0, scale: 1 };
  const animation = layer.textAnimation,
    duration = Math.max(1, animation.durationInFrames),
    endFrame = layer.startFrame + layer.durationInFrames - 1,
    entranceProgress = easeOut(
      clamp((frame - layer.startFrame) / duration, 0, 1),
    ),
    exitProgress = easeOut(clamp((endFrame - frame) / duration, 0, 1));
  let opacity = 1,
    translateY = 0,
    scale = 1;
  if (animation.entrance === "fade") opacity *= entranceProgress;
  if (animation.entrance === "slide-up") {
    opacity *= entranceProgress;
    translateY += (1 - entranceProgress) * 36;
  }
  if (animation.entrance === "scale") {
    opacity *= entranceProgress;
    scale *= 0.82 + entranceProgress * 0.18;
  }
  if (animation.exit === "fade") opacity *= exitProgress;
  if (animation.exit === "slide-up") {
    opacity *= exitProgress;
    translateY -= (1 - exitProgress) * 36;
  }
  if (animation.exit === "scale") {
    opacity *= exitProgress;
    scale *= 0.82 + exitProgress * 0.18;
  }
  return { opacity, translateY, scale };
}
