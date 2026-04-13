import { createTheme, type MantineThemeOverride } from "@mantine/core";

export const appTheme: MantineThemeOverride = createTheme({
  primaryColor: "teal",
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: "md",
  fontFamily:
    '"Inter", "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',

  colors: {
    teal: [
      "#f0fdfa", // 0 — near-white teal tint
      "#ccfbf1", // 1
      "#99f6e4", // 2
      "#5eead4", // 3
      "#2dd4bf", // 4 — bright teal (dark mode accent)
      "#14b8a6", // 5 — primary accent light mode
      "#0d9488", // 6 — default primary
      "#0f766e", // 7 — dark teal (hover)
      "#115e59", // 8
      "#134e4a", // 9 — deepest teal
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
