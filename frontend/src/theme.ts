import { createTheme, type MantineThemeOverride } from "@mantine/core";

export const appTheme: MantineThemeOverride = createTheme({
  primaryColor: "forest",
  primaryShade: { light: 7, dark: 4 },
  defaultRadius: "md",
  fontFamily:
    '"Inter", "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',

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
