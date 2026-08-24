import { clamp } from "../animation/frame";
import type { VideoProject, VideoScene } from "../project/schema";

export const clipDuration = (scene: VideoScene) =>
  Number.isFinite(scene.durationInFrames)
    ? scene.durationInFrames
    : scene.composition.canvas.durationInFrames;

export const orderedScenes = (video: VideoProject) =>
  [...video.scenes].sort((a, b) => a.order - b.order);

export function transitionDuration(scene: VideoScene, nextScene?: VideoScene) {
  if (
    !nextScene ||
    !scene.transitionToNext ||
    scene.transitionToNext.type === "cut"
  )
    return 0;
  return Math.round(
    clamp(
      scene.transitionToNext.durationInFrames,
      1,
      Math.max(1, Math.min(clipDuration(scene), clipDuration(nextScene)) - 1),
    ),
  );
}

export function sceneStarts(video: VideoProject) {
  const scenes = orderedScenes(video),
    starts: number[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    starts.push(cursor);
    cursor +=
      clipDuration(scene) - transitionDuration(scene, scenes[index + 1]);
  });
  return { scenes, starts, totalFrames: Math.max(1, cursor) };
}

export const sceneMasterStart = (video: VideoProject, sceneId: string) => {
  const { scenes, starts } = sceneStarts(video),
    index = scenes.findIndex((scene) => scene.id === sceneId);
  return index < 0 ? 0 : starts[index];
};

export function resolveMasterFrame(
  video: VideoProject,
  requestedFrame: number,
) {
  const { scenes, starts, totalFrames } = sceneStarts(video),
    masterFrame = Math.round(
      clamp(requestedFrame, 0, Math.max(0, totalFrames - 1)),
    );
  let sceneIndex = scenes.length - 1;
  for (let index = 0; index < scenes.length; index += 1) {
    if (masterFrame < starts[index] + clipDuration(scenes[index])) {
      sceneIndex = index;
      break;
    }
  }
  const scene = scenes[sceneIndex],
    localFrame = Math.round(
      clamp(masterFrame - starts[sceneIndex], 0, clipDuration(scene) - 1),
    );
  let transition:
    | {
        from: VideoScene;
        to: VideoScene;
        fromFrame: number;
        toFrame: number;
        progress: number;
      }
    | undefined;
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const duration = transitionDuration(scenes[index], scenes[index + 1]),
      transitionStart = starts[index + 1];
    if (
      duration > 0 &&
      masterFrame >= transitionStart &&
      masterFrame < transitionStart + duration
    ) {
      transition = {
        from: scenes[index],
        to: scenes[index + 1],
        fromFrame: masterFrame - starts[index],
        toFrame: masterFrame - transitionStart,
        progress: clamp((masterFrame - transitionStart) / duration, 0, 1),
      };
      break;
    }
  }
  return {
    scene,
    sceneIndex,
    localFrame,
    masterFrame,
    totalFrames,
    transition,
  };
}
