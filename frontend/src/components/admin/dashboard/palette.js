/**
 * 看板配色板：贴合站点 editorial 调性。
 * 以 海军蓝 (#426f9f) 为主轴，搭配低饱和暖色（苔藓 / 砂金 / 落日 / 墨青 / 紫鸢），
 * 全部偏哑光，避免 antd 默认的高亮蓝紫。
 *
 * 站点已定义的 CSS 变量（在 styles.css :root 里）：
 *   --accent: #588bc8        主蓝
 *   --accent-deep: #426f9f   深蓝
 *   --accent-light: #7da5d4  浅蓝
 *
 * 本配色板只供 ECharts / 局部样式使用（CSS 变量在 ECharts option 里读不到）。
 */

// 品牌核心色
export const BRAND = {
  navy: "#426f9f",     // 海军蓝（主）
  navyDeep: "#2c4a68", // 深海军（强调）
  sand: "#c89a5e",     // 砂金（暖色对比）
  moss: "#6b8e5a",     // 苔藓绿（活跃 / 正向）
  ember: "#c0426a",    // 落日玫瑰（告警）
  ink: "#3f6b6f",      // 墨青（次要数据）
  iris: "#7c60c4",     // 紫鸢（次次要）
};

// 趋势图：指标 → 主色（按业务语义）
export const TREND_COLORS = {
  training: BRAND.navy,    // AI 对练 — 海军蓝
  video: BRAND.iris,       // 课程视频 — 紫鸢
  reading: BRAND.sand,     // 读书打卡 — 砂金
  paper: BRAND.ink,        // 试卷提交 — 墨青
};

// 部门维度：指标 → 主色
export const DEPARTMENT_COLORS = {
  total_points: BRAND.navy,      // 累计积分 — 海军蓝
  training_count: BRAND.iris,    // 训练次数 — 紫鸢
  reading_count: BRAND.sand,     // 打卡次数 — 砂金
  active_rate: BRAND.moss,       // 活跃率 — 苔藓绿
};

// 积分构成（环形图）：六类一一对应
export const CATEGORY_COLORS = {
  training: BRAND.navy,    // AI 对练
  course: BRAND.iris,      // 课程视频
  reading: BRAND.sand,     // 读书打卡
  paper: BRAND.ink,        // 考试试卷
  exam: BRAND.ember,       // AI 通关
  manual: "#98a2b3",       // 手动调整 — 中性灰
};

// 排行榜：金/银/铜 + 主色
export const LEADERBOARD_MEDAL = ["#c89a5e", "#9aa4b1", "#a07748"]; // 砂金 / 银灰 / 古铜
export const LEADERBOARD_BAR = BRAND.navy;
