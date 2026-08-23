export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function frameToSeconds(frame: number, fps: number) {
  return frame / fps;
}

export function formatTimecode(frame: number, fps: number) {
  const safeFrame = Math.max(0, Math.round(frame));
  const minutes = Math.floor(safeFrame / fps / 60);
  const seconds = Math.floor(safeFrame / fps) % 60;
  const frames = safeFrame % fps;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function easeOutCubic(progress: number) {
  const p = clamp(progress, 0, 1);
  return 1 - Math.pow(1 - p, 3);
}
