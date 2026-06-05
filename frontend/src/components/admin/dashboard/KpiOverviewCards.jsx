import {
  AlertOutlined,
  BookOutlined,
  CheckCircleOutlined,
  FormOutlined,
  RocketOutlined,
  TeamOutlined,
} from "@ant-design/icons";

function KpiCell({ index, icon, label, value, suffix, footer, alert }) {
  return (
    <div className={`dash-kpi__cell${alert ? " dash-kpi__cell--alert" : ""}`}>
      <span className="dash-kpi__index">{String(index).padStart(2, "0")}</span>
      <div className="dash-kpi__head">
        <span className="dash-kpi__label">
          {icon}
          {label}
        </span>
      </div>
      <div className={`dash-kpi__value${alert ? " dash-kpi__value--alert" : ""}`}>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        {suffix ? <span className="dash-kpi__suffix">{suffix}</span> : null}
      </div>
      {footer ? (
        <div className={`dash-kpi__foot${alert ? " dash-kpi__foot--alert" : ""}`}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export default function KpiOverviewCards({ kpi, pending }) {
  if (!kpi) return null;
  const u = kpi.users || {};
  const t = kpi.training || {};
  const r = kpi.reading || {};
  const p = kpi.papers || {};
  const e = kpi.exams || {};
  const pt = pending || {};

  const cells = [
    {
      icon: <TeamOutlined />,
      label: "在职员工",
      value: u.active || 0,
      suffix: `/ ${u.total || 0} 人`,
      footer: `今日活跃 ${u.today_active || 0} 人`,
    },
    {
      icon: <RocketOutlined />,
      label: "本周 AI 对练",
      value: t.week_count || 0,
      suffix: "次",
      footer: "近 7 天累计训练次数",
    },
    {
      icon: <BookOutlined />,
      label: "本周读书打卡",
      value: r.week_count || 0,
      suffix: "人次",
      footer: "含补卡",
    },
    {
      icon: <CheckCircleOutlined />,
      label: "本周试卷通过率",
      value: Number(p.week_pass_rate || 0).toFixed(1),
      suffix: "%",
      footer: "已批阅试卷的通过比例",
    },
    {
      icon: <FormOutlined />,
      label: "待批阅试卷",
      value: p.pending_review || 0,
      suffix: "份",
      alert: (p.pending_review || 0) > 0,
      footer: "提交后等待复核",
    },
    {
      icon: <FormOutlined />,
      label: "待复核 AI 对练",
      value: e.pending_review || 0,
      suffix: "次",
      alert: (e.pending_review || 0) > 0,
      footer: "AI 通关考试待人工复核",
    },
    {
      icon: <AlertOutlined />,
      label: "已逾期未完成",
      value: pt.paper_overdue || 0,
      suffix: "份",
      alert: (pt.paper_overdue || 0) > 0,
      footer: (pt.paper_overdue || 0) > 0 ? "建议催办" : "无逾期",
    },
    {
      icon: <TeamOutlined />,
      label: "今日覆盖人数",
      value: u.today_active || 0,
      suffix: "人",
      footer: "今天发生过任意学习行为",
    },
  ];

  return (
    <div className="dash-kpi">
      {cells.map((c, idx) => (
        <KpiCell key={idx} index={idx + 1} {...c} />
      ))}
    </div>
  );
}
