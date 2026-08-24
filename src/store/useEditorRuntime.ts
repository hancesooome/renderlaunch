import { useEffect, useRef } from "react";
import { useEditorStore } from "./editorStore";

export function useEditorRuntime() {
  const hydrated = useEditorStore((s) => s.hydrated);
  const playing = useEditorStore((s) => s.playing);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const hydrate = useEditorStore((s) => s.hydrate);
  const advanceFrame = useEditorStore((s) => s.advanceFrame);
  const persist = useEditorStore((s) => s.persist);
  const fps = useEditorStore((s) => s.project.canvas.fps);
  const timer = useRef<number | undefined>(undefined),
    lastTick = useRef(0),
    frameRemainder = useRef(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  useEffect(() => {
    if (!playing) return;
    lastTick.current = performance.now();
    frameRemainder.current = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(250, now - lastTick.current);
      lastTick.current = now;
      frameRemainder.current += (elapsed / 1000) * fps;
      const frames = Math.floor(frameRemainder.current);
      if (frames > 0) {
        frameRemainder.current -= frames;
        for (let index = 0; index < frames; index += 1) {
          if (!useEditorStore.getState().playing) break;
          advanceFrame();
        }
      }
      if (useEditorStore.getState().playing)
        timer.current = requestAnimationFrame(tick);
    };
    timer.current = requestAnimationFrame(tick);
    return () => {
      if (timer.current) cancelAnimationFrame(timer.current);
    };
  }, [advanceFrame, fps, playing]);
  useEffect(() => {
    if (!hydrated || saveStatus !== "unsaved") return;
    const timeout = window.setTimeout(() => void persist(), 700);
    return () => window.clearTimeout(timeout);
  }, [hydrated, persist, saveStatus]);
}
