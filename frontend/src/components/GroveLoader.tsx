import type { CSSProperties } from "react";

type GroveLoaderSize = "xs" | "sm" | "md" | "lg" | "xl";
type GroveLoaderColor = "forest" | "cream" | "gold" | "muted";
type GroveLoaderSpeed = "slow" | "normal" | "fast";

interface GroveLoaderProps {
  size?:  GroveLoaderSize;
  color?: GroveLoaderColor;
  speed?: GroveLoaderSpeed;
  label?: string;  // aria-label for screen readers
}

/** Bar dimensions: [width, height] in px — mirrors the Stems mark proportions. */
const SIZE_BARS: Record<GroveLoaderSize, [number, number, number, number, number, number]> = {
  xs: [2.5,  9, 1.5, 2.5, 13, 1.5],  // [w, h1, gap, w, h2, gap] for 3 bars
  sm: [4,   14, 2.5, 4,  20, 2.5],
  md: [6,   20, 4,   6,  30, 4  ],
  lg: [9,   32, 6,   9,  48, 6  ],
  xl: [13,  45, 8,   13, 68, 8  ],
};
const SIZE_H3: Record<GroveLoaderSize, number> = { xs:10, sm:16, md:23, lg:36, xl:52 };

const COLOR_HEX: Record<GroveLoaderColor, string> = {
  forest: "#2d6a4f",
  cream:  "#f0e9d8",
  gold:   "#c8860a",
  muted:  "#78716c",
};

const SPEED_MS: Record<GroveLoaderSpeed, number> = { slow:1800, normal:1100, fast:700 };

const KEYFRAMES = `
@keyframes groveWave {
  0%, 100% { transform: scaleY(0.45); opacity: 0.5; }
  50%       { transform: scaleY(1);   opacity: 1;   }
}`;

let _injected = false;
function injectKeyframes() {
  if (_injected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  _injected = true;
}

export function GroveLoader({
  size  = "md",
  color = "forest",
  speed = "normal",
  label = "Loading…",
}: GroveLoaderProps) {
  injectKeyframes();

  const [w, h1, gap, , h2] = SIZE_BARS[size];
  const h3 = SIZE_H3[size];
  const bg = COLOR_HEX[color];
  const ms = SPEED_MS[speed];

  const bar = (height: number, delay: number): CSSProperties => ({
    width: w,
    height,
    borderRadius: 999,
    background: bg,
    transformOrigin: "bottom center",
    animation: `groveWave ${ms}ms ease-in-out ${delay}ms infinite`,
    flexShrink: 0,
  });

  return (
    <div
      role="status"
      aria-label={label}
      style={{ display:"inline-flex", alignItems:"flex-end", gap }}
    >
      <div style={bar(h1, 0)} />
      <div style={bar(h2, ms * 0.16)} />
      <div style={bar(h3, ms * 0.33)} />
    </div>
  );
}

/** Full-page centred loading state — drop in where you'd use Mantine's <Loader>. */
export function GrovePageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div style={{
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      minHeight:"60vh", gap:"1rem",
    }}>
      <GroveLoader size="lg" color="forest" />
      <p style={{ fontSize:"0.85rem", color:"#78716c", margin:0 }}>{label}</p>
    </div>
  );
}