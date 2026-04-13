import { createTheme, type MantineThemeOverride } from "@mantine/core";

export const appTheme: MantineThemeOverride = createTheme({
  primaryColor: "green",
  primaryShade: { light: 7, dark: 4 },
  defaultRadius: "md",
  fontFamily:
    '"Inter", "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',

  colors: {
    green: [
      "#f0fdf4", // 0 — near-white green tint
      "#dcfce7", // 1
      "#bbf7d0", // 2
      "#86efac", // 3
      "#4ade80", // 4 — bright emerald (dark mode accent)
      "#22c55e", // 5 — vibrant green
      "#16a34a", // 6 — medium green
      "#15803d", // 7 — default primary
      "#166534", // 8
      "#14532d", // 9 — deepest green
    ],
    amber: [
      "#fffbeb", // 0
      "#fef3c7", // 1
      "#fde68a", // 2
      "#fcd34d", // 3
      "#fbbf24", // 4
      "#f59e0b", // 5 — primary amber
      "#d97706", // 6 — dark amber
      "#b45309", // 7
      "#92400e", // 8
      "#78350f", // 9
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
  },
});
