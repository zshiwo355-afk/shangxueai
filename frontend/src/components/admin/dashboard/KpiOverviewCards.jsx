import {
  AlertOutlined,
  BookOutlined,
  CheckCircleOutlined,
  FormOutlined,
  RocketOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Card, Col, Row } from "antd";

function StatCard({ icon, title, value, suffix, footer, emphasize }) {
  return (
    <Card
      size="small"
      bordered
      style={{
        borderRadius: 8,
        borderColor: "#f0f0f0",
        height: "100%",
      }}
      bodyStyle={{ padding: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "#8c8c8c", fontSize: 13 }}>
        <span style={{ fontSize: 14, color: "#bfbfbf" }}>{icon}</span>
        <span>{title}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: emphasize ? "#cf1322" : "#262626",
            lineHeight: 1.1,
          }}
        >
          {Number(value || 0).toLocaleString()}
        </span>
        {suffix ? (
          <span style={{ fontSize: 13, color: "#8c8c8c" }}>{suffix}</span>
        ) : null}
      </div>
      {footer ? (
        <div style={{ marginTop: 8, color: "#8c8c8c", fontSize: 12, lineHeight: 1.5 }}>
          {footer}
        </div>
      ) : null}
    </Card>
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

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} sm={12} md={6}>
        <StatCard
          icon={<TeamOutlined />}
          title="在职员工"
          value={u.active || 0}
          suffix={`/ ${u.total || 0} 人`}
          footer={<>今日活跃 {u.today_active || 0} 人</>}
        />
      </Col>

      <Col xs={24} sm={12} md={6}>
        <StatCard
          icon={<RocketOutlined />}
          title="本周 AI 对练"
          value={t.week_count || 0}
          suffix="次"
          footer="近 7 天累计训练次数"
        />
      </Col>

      <Col xs={24} sm={12} md={6}>
        <StatCard
          icon={<BookOutlined />}
          title="本周读书打卡"
          value={r.week_count || 0}
          suffix="人次"
          footer="含补卡"
        />
      </Col>

      <Col xs={24} sm={12} md={6}>
        <StatCard
          icon={<CheckCircleOutlined />}
          title="本周试卷通过率"
          value={Number(p.week_pass_rate || 0).toFixed(1)}
          suffix="%"
          footer="已批阅试卷的通过比例"
        />
      </Col>

      <Col xs={24} sm={12} md={6}>
        <StatCard
          icon={<FormOutlined />}
          title="待批阅试卷"
          value={p.pending_review || 0}
          suffix="份"
          emphasize={(p.pending_review || 0) > 0}
          footer="提交后等待复核"
        />
      </Col>

      <Col xs={24} sm={12} md={6}>
        <StatCard
          icon={<FormOutlined />}
          title="待复核 AI 对练"
          value={e.pending_review || 0}
          suffix="次"
          emphasize={(e.pending_review || 0) > 0}
          footer="AI 通关考试待人工复核"
        />
      </Col>

      <Col xs={24} sm={12} md={6}>
        <StatCard
          icon={<AlertOutlined />}
          title="已逾期未完成"
          value={pt.paper_overdue || 0}
          suffix="份"
          emphasize={(pt.paper_overdue || 0) > 0}
          footer={(pt.paper_overdue || 0) > 0 ? "建议催办" : "无逾期"}
        />
      </Col>
    </Row>
  );
}
