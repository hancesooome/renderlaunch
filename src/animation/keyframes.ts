import type {
  ColorKeyframe,
  KeyframeTrack,
  NumericKeyframe,
} from "../project/schema";
import {
  colorKeyframePropertySchema,
  numericKeyframePropertySchema,
} from "../project/schema";

type NumericProperty = (typeof numericKeyframePropertySchema)["_output"];
type ColorProperty = (typeof colorKeyframePropertySchema)["_output"];
type NumericTrack = Extract<KeyframeTrack, { valueType: "number" }>;
type ColorTrack = Extract<KeyframeTrack, { valueType: "color" }>;

const createId = () => crypto.randomUUID();

export function createNumericTrack(
  targetId: string,
  property: NumericProperty,
): NumericTrack {
  return {
    id: createId(),
    targetId,
    valueType: "number",
    property,
    enabled: true,
    keyframes: [],
  };
}

export function createColorTrack(
  targetId: string,
  property: ColorProperty,
): ColorTrack {
  return {
    id: createId(),
    targetId,
    valueType: "color",
    property,
    enabled: true,
    keyframes: [],
  };
}

export function upsertNumericKeyframe(
  track: NumericTrack,
  frame: number,
  value: number,
  options: Partial<
    Pick<NumericKeyframe, "interpolation" | "easing" | "bezier">
  > = {},
) {
  const keyframe = track.keyframes.find((item) => item.frame === frame);
  if (keyframe) {
    keyframe.value = value;
    Object.assign(keyframe, options);
  } else {
    track.keyframes.push({
      id: createId(),
      frame,
      value,
      interpolation: options.interpolation ?? "linear",
      easing: options.easing ?? "linear",
      bezier: options.bezier,
    });
  }
  track.keyframes.sort((a, b) => a.frame - b.frame);
}

export function upsertColorKeyframe(
  track: ColorTrack,
  frame: number,
  value: string,
  options: Partial<
    Pick<ColorKeyframe, "interpolation" | "easing" | "bezier">
  > = {},
) {
  const keyframe = track.keyframes.find((item) => item.frame === frame);
  if (keyframe) {
    keyframe.value = value;
    Object.assign(keyframe, options);
  } else {
    track.keyframes.push({
      id: createId(),
      frame,
      value,
      interpolation: options.interpolation ?? "linear",
      easing: options.easing ?? "linear",
      bezier: options.bezier,
    });
  }
  track.keyframes.sort((a, b) => a.frame - b.frame);
}

export function removeKeyframe(track: KeyframeTrack, keyframeId: string) {
  const index = track.keyframes.findIndex((item) => item.id === keyframeId);
  if (index >= 0) track.keyframes.splice(index, 1);
}

export function findKeyframeTrack(
  tracks: KeyframeTrack[],
  targetId: string,
  property: KeyframeTrack["property"],
) {
  return tracks.find(
    (track) => track.targetId === targetId && track.property === property,
  );
}

export function evaluateTrack(track: KeyframeTrack, frame: number) {
  const keyframes = [...track.keyframes].sort((a, b) => a.frame - b.frame);
  if (!track.enabled || !keyframes.length) return undefined;
  if (frame <= keyframes[0].frame) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (frame >= last.frame) return last.value;
  const rightIndex = keyframes.findIndex((keyframe) => keyframe.frame >= frame),
    left = keyframes[rightIndex - 1],
    right = keyframes[rightIndex];
  if (left.interpolation === "hold") return left.value;
  const duration = Math.max(1, right.frame - left.frame),
    progress = applyKeyframeEasing(
      (frame - left.frame) / duration,
      left.easing,
      left.bezier,
    );
  if (track.valueType === "number")
    return (
      (left.value as number) +
      ((right.value as number) - (left.value as number)) * progress
    );
  return interpolateColor(String(left.value), String(right.value), progress);
}

export function evaluateNumericProperty(
  tracks: KeyframeTrack[],
  targetId: string,
  property: NumericProperty,
  frame: number,
  fallback: number,
) {
  const track = findKeyframeTrack(tracks, targetId, property);
  if (!track || track.valueType !== "number") return fallback;
  const value = evaluateTrack(track, frame);
  return typeof value === "number" ? value : fallback;
}

export function evaluateColorProperty(
  tracks: KeyframeTrack[],
  targetId: string,
  property: ColorProperty,
  frame: number,
  fallback: string,
) {
  const track = findKeyframeTrack(tracks, targetId, property);
  if (!track || track.valueType !== "color") return fallback;
  const value = evaluateTrack(track, frame);
  return typeof value === "string" ? value : fallback;
}

export function applyKeyframeEasing(
  value: number,
  easing: NumericKeyframe["easing"],
  bezier?: NumericKeyframe["bezier"],
) {
  const t = Math.min(1, Math.max(0, value));
  if (easing === "ease-in") return t * t * t;
  if (easing === "ease-out") return 1 - Math.pow(1 - t, 3);
  if (easing === "ease-in-out")
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  if (easing === "custom-bezier" && bezier) return cubicBezierAtTime(t, bezier);
  return t;
}

function cubicBezierAtTime(
  time: number,
  [x1, y1, x2, y2]: [number, number, number, number],
) {
  const sample = (t: number, a: number, b: number) => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t ** 3;
  };
  let low = 0,
    high = 1,
    parameter = time;
  for (let index = 0; index < 12; index += 1) {
    parameter = (low + high) / 2;
    if (sample(parameter, x1, x2) < time) low = parameter;
    else high = parameter;
  }
  return sample(parameter, y1, y2);
}

function interpolateColor(from: string, to: string, progress: number) {
  const start = parseColor(from),
    end = parseColor(to);
  if (!start || !end) return progress < 0.5 ? from : to;
  const channel = (index: number) =>
    Math.round(start[index] + (end[index] - start[index]) * progress)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function parseColor(value: string) {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return undefined;
  const hex =
    match[1].length === 3
      ? [...match[1]].map((character) => character + character).join("")
      : match[1];
  return [0, 2, 4].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
}
