import {useEffect, useRef} from 'react';
import {useEditorStore} from './editorStore';

export function useEditorRuntime() {
  const hydrated = useEditorStore(s => s.hydrated);
  const playing = useEditorStore(s => s.playing);
  const saveStatus = useEditorStore(s => s.saveStatus);
  const hydrate = useEditorStore(s => s.hydrate);
  const advanceFrame = useEditorStore(s => s.advanceFrame);
  const persist = useEditorStore(s => s.persist);
  const fps = useEditorStore(s => s.project.canvas.fps);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { void hydrate(); }, [hydrate]);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(advanceFrame, 1000 / fps);
    return () => window.clearInterval(timer.current);
  }, [advanceFrame, fps, playing]);
  useEffect(() => {
    if (!hydrated || saveStatus !== 'unsaved') return;
    const timeout = window.setTimeout(() => void persist(), 700);
    return () => window.clearTimeout(timeout);
  }, [hydrated, persist, saveStatus]);
}
