/**
 * Ant Design 主题：专业深蓝（钉钉/飞书同款）
 * 主色 #1677ff，hover #0958d9，背景 #f7f9fc，主文本 #1f2937。
 */
const ACCENT_PRIMARY = "#1677ff";
const ACCENT_DEEP = "#0958d9";
const ACCENT_LIGHT = "#4096ff";
const ACCENT_SOFT_BG = "#f0f5ff";
const TEXT_BASE = "#1f2937";
const TEXT_MUTE = "#4b5563";
const LINE = "rgba(31, 41, 55, 0.10)";
const LINE_SOFT = "rgba(31, 41, 55, 0.06)";
const PANEL_BG = "#ffffff";
const PANEL_BG_SOFT = "#f7f9fc";

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
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,
    boxShadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 14px rgba(31, 41, 55, 0.06)",
    boxShadowSecondary: "0 1px 3px rgba(31, 41, 55, 0.06), 0 6px 20px rgba(31, 41, 55, 0.08)",
    wireframe: false,
    fontFamily:
      '"PingFang SC", "Microsoft YaHei", "Segoe UI", "Noto Sans SC", sans-serif',
  },
  components: {
    Card: {
      borderRadiusLG: 12,
      paddingLG: 18,
      headerBg: "transparent",
      headerFontSize: 15,
      boxShadowTertiary: "none",
    },
    Modal: { borderRadiusLG: 14, paddingContentHorizontalLG: 24 },
    Drawer: { borderRadiusLG: 14 },
    Select: {
      borderRadius: 8,
      controlHeight: 36,
      optionSelectedBg: ACCENT_SOFT_BG,
      optionSelectedColor: ACCENT_DEEP,
      optionSelectedFontWeight: 600,
    },
    Input: {
      borderRadius: 10,
      controlHeight: 36,
      activeShadow: "0 0 0 3px rgba(22, 119, 255, 0.12)",
    },
    Button: {
      borderRadius: 8,
      controlHeight: 36,
      controlHeightLG: 44,
      fontWeight: 500,
      primaryShadow: "0 1px 0 rgba(0, 0, 0, 0)",
      defaultShadow: "0 1px 0 rgba(0, 0, 0, 0)",
    },
    Tag: { borderRadiusSM: 6 },
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
      itemBorderRadius: 6,
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
