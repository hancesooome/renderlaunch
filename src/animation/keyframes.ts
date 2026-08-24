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
