import { useEffect, useRef, useState } from "react";
import { MotionAnalyzer, watchMotion } from "../services/motionService";
// Pasos y movimiento del acelerómetro mientras `active`. Los pasos se conservan
// durante una pausa y se reinician cuando cambia `resetKey` (otra actividad).
export function useMotion(active: boolean, resetKey: string | undefined) {
  const analyzer = useRef(new MotionAnalyzer());
  const [state, setState] = useState({
    supported: false,
    moving: false,
    steps: 0,
  });
  useEffect(() => {
    analyzer.current = new MotionAnalyzer();
    setState({ supported: false, moving: false, steps: 0 });
  }, [resetKey]);
  useEffect(() => {
    if (!active) return;
    let seenAt = -Infinity;
    let moving = false;
    const stop = watchMotion((t, x, y, z) => {
      seenAt = performance.now();
      moving = analyzer.current.push(t, x, y, z).moving;
    });
    if (!stop) return;
    // Se publica a 4 Hz para no re-renderizar con cada evento del sensor.
    const timer = window.setInterval(() => {
      if (performance.now() - seenAt > 2000) {
        setState((prev) =>
          prev.supported ? { ...prev, supported: false, moving: false } : prev,
        );
        return;
      }
      setState((prev) =>
        prev.supported &&
        prev.moving === moving &&
        prev.steps === analyzer.current.steps
          ? prev
          : { supported: true, moving, steps: analyzer.current.steps },
      );
    }, 250);
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, [active]);
  return active ? state : { ...state, moving: false };
}
