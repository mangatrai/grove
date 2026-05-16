type GroveMarkProps = {
  size?: number;
  color?: string;
};

export function GroveMark({ size = 20, color = "#f0e9d8" }: GroveMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="18" width="10" height="20" rx="5" fill={color} />
      <rect x="15" y="8" width="10" height="30" rx="5" fill={color} />
      <rect x="28" y="22" width="10" height="16" rx="5" fill={color} />
    </svg>
  );
}
