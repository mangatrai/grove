import { useEffect, useMemo, useState } from "react";

export type SparklineMiniProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
};

export function SparklineMini({
  data,
  width = 110,
  height = 32,
  color = "var(--fs-forest)"
}: SparklineMiniProps) {
  const [drawProgress, setDrawProgress] = useState(1);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDrawProgress(1);
      return;
    }
    setDrawProgress(0);
    const start = performance.now();
    const duration = 400;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDrawProgress(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [data]);

  const geometry = useMemo(() => {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const r = max - min || 1;
    const p = 3;
    const w = width - p * 2;
    const h = height - p * 2;
    const pts = data.map(
      (v, i) => `${p + (i / (data.length - 1)) * w},${p + h - ((v - min) / r) * h}`
    );
    const last = pts[pts.length - 1]?.split(",") ?? ["0", "0"];
    const area = `M${pts[0]} ${pts.slice(1).map((q) => `L${q}`).join(" ")} L${last[0]},${p + h} L${p},${p + h} Z`;
    const polyline = pts.join(" ");
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1].split(",").map(Number);
      const [x1, y1] = pts[i].split(",").map(Number);
      length += Math.hypot(x1 - x0, y1 - y0);
    }
    return { area, polyline, last, length };
  }, [data, width, height]);

  if (!geometry) return null;

  const { area, polyline, last, length } = geometry;
  const dashOffset = length * (1 - drawProgress);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      style={{ display: "block" }}
      aria-hidden
    >
      <path d={area} fill={color} fillOpacity={0.1} />
      <polyline
        points={polyline}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={dashOffset}
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} opacity={drawProgress} />
    </svg>
  );
}
