/**
 * Ant Design theme: academy deep blue.
 * The goal is to keep the portal, training pages, and learning pages in one brand system.
 */
const ACCENT_PRIMARY = "#1f4b99";
const ACCENT_DEEP = "#163b7a";
const ACCENT_LIGHT = "#4f7cc8";
const ACCENT_SOFT_BG = "#eef4ff";
const TEXT_BASE = "#1e293b";
const TEXT_MUTE = "#64748b";
const LINE = "rgba(30, 41, 59, 0.10)";
const LINE_SOFT = "rgba(30, 41, 59, 0.06)";
const PANEL_BG = "#ffffff";
const PANEL_BG_SOFT = "#f5f7fb";

export const antdTheme = {
  token: {
    colorPrimary: ACCENT_PRIMARY,
    colorInfo: ACCENT_PRIMARY,
    colorLink: ACCENT_DEEP,
    colorSuccess: "#16a34a",
    colorWarning: "#f59e0b",
    colorError: "#dc2626",
    colorTextBase: TEXT_BASE,
    colorTextSecondary: TEXT_MUTE,
    colorBorder: LINE,
    colorBorderSecondary: LINE_SOFT,
    colorBgContainer: PANEL_BG,
    colorBgElevated: PANEL_BG,
    colorBgLayout: PANEL_BG_SOFT,
    borderRadius: 10,
    borderRadiusLG: 16,
    borderRadiusSM: 6,
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.05), 0 16px 32px rgba(15, 23, 42, 0.06)",
    boxShadowSecondary: "0 4px 12px rgba(15, 23, 42, 0.06), 0 20px 40px rgba(15, 23, 42, 0.08)",
    wireframe: false,
    fontFamily:
      '"PingFang SC", "Microsoft YaHei", "Segoe UI", "Noto Sans SC", sans-serif',
  },
  components: {
    Card: {
      borderRadiusLG: 16,
      paddingLG: 20,
      headerBg: "transparent",
      headerFontSize: 15,
      boxShadowTertiary: "none",
    },
    Modal: { borderRadiusLG: 16, paddingContentHorizontalLG: 24 },
    Drawer: { borderRadiusLG: 16 },
    Select: {
      borderRadius: 10,
      controlHeight: 36,
      optionSelectedBg: ACCENT_SOFT_BG,
      optionSelectedColor: ACCENT_DEEP,
      optionSelectedFontWeight: 600,
    },
    Input: {
      borderRadius: 10,
      controlHeight: 36,
      activeShadow: "0 0 0 3px rgba(31, 75, 153, 0.14)",
    },
    Button: {
      borderRadius: 10,
      controlHeight: 36,
      controlHeightLG: 44,
      fontWeight: 500,
      primaryShadow: "0 1px 0 rgba(0, 0, 0, 0)",
      defaultShadow: "0 1px 0 rgba(0, 0, 0, 0)",
    },
    Tag: { borderRadiusSM: 999 },
    Tabs: {
      itemSelectedColor: ACCENT_DEEP,
      itemHoverColor: ACCENT_DEEP,
      inkBarColor: ACCENT_PRIMARY,
    },
    Tooltip: { borderRadius: 8 },
    Message: { borderRadiusLG: 10 },
    Notification: { borderRadiusLG: 12 },
    Dropdown: { borderRadiusLG: 10 },
    Menu: {
      borderRadius: 10,
      itemBorderRadius: 8,
      itemSelectedBg: ACCENT_SOFT_BG,
      itemSelectedColor: ACCENT_DEEP,
    },
    Progress: {
      defaultColor: ACCENT_PRIMARY,
    },
  },
};

export const themeColors = {
  primary: ACCENT_PRIMARY,
  primaryDeep: ACCENT_DEEP,
  primaryLight: ACCENT_LIGHT,
  softBg: ACCENT_SOFT_BG,
};
