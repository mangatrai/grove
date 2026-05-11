import { createTheme, type MantineThemeOverride } from "@mantine/core";

export const appTheme: MantineThemeOverride = createTheme({
  primaryColor: "forest",
  primaryShade: { light: 7, dark: 4 },
  defaultRadius: "md",
  fontFamily:
    '"Inter", "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',

  headings: {
    fontFamily:
      '"Inter Tight", "Inter", "DM Sans", system-ui, sans-serif',
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "1.625rem", lineHeight: "1.25", fontWeight: "700" },
      h2: { fontSize: "1.25rem", lineHeight: "1.3", fontWeight: "600" },
      h3: { fontSize: "1.0625rem", lineHeight: "1.35", fontWeight: "600" },
    },
  },

  colors: {
    // Earthy, mature forest greens — Pantone Forest family (not the juvenile lime ramp)
    // Each shade is slightly warm-tinted to complement the warm neutral surfaces.
    forest: [
      "#F2F7F4", // 0 — near-white green tint
      "#E2EEE7", // 1
      "#C3DDCA", // 2
      "#97C4A5", // 3
      "#6BA984", // 4 — dark-mode accent (muted, warm emerald)
      "#4A9464", // 5 — vibrant earthy green
      "#3A7D52", // 6 — medium forest
      "#2D6A4F", // 7 — default primary (mature, Pantone Forest)
      "#1F5038", // 8
      "#153828", // 9 — deepest forest
    ],
    // Rich warm gold — replaces the cheap amber ramp
    amber: [
      "#FEF9EE", // 0
      "#FEF0CE", // 1
      "#FDE09A", // 2
      "#FBCF6A", // 3
      "#F9BD3A", // 4
      "#F7AB0A", // 5 — warm gold
      "#C8860A", // 6 — rich gold (primary warm)
      "#9A6108", // 7
      "#6C4205", // 8
      "#3E2403", // 9
    ],
    /** Forest Studio — semantic money colors (Progress, Badge); mirrors `index.css` tokens */
    fsForest: [
      "#F2F7F4",
      "#E2EEE7",
      "#C3DDCA",
      "#97C4A5",
      "#6BA984",
      "#4A9464",
      "#3A7D52",
      "#2D6A4F",
      "#1F5038",
      "#153828",
    ],
    fsTerracotta: [
      "#fdf5f3",
      "#fce9e5",
      "#fad2cb",
      "#f0aea3",
      "#e08575",
      "#cc5c47",
      "#8b3a26",
      "#6d2e1e",
      "#4a1f14",
      "#2d130c",
    ],
    fsGold: [
      "#fefbf3",
      "#fef6e4",
      "#fdecc8",
      "#f5d08a",
      "#e8b855",
      "#d4a020",
      "#c8860a",
      "#9a6108",
      "#6c4205",
      "#3e2403",
    ],
  },

  components: {
    Button: {
      defaultProps: {
        size: "sm",
      },
    },
    ActionIcon: {
      defaultProps: {
        variant: "subtle",
        size: "sm",
      },
    },
    Modal: {
      defaultProps: {
        centered: true,
        overlayProps: { blur: 3 },
      },
    },
    Tooltip: {
      defaultProps: {
        withArrow: true,
        multiline: true,
        maw: 280,
      },
    },
    Card: {
      defaultProps: {
        radius: "md",
      },
    },
  },
});
