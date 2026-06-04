import {
  AlertOutlined,
  BookOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FireOutlined,
  FormOutlined,
  RocketOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Card, Col, Row, Statistic, Tag } from "antd";

const CARD_STYLE = { borderRadius: 12 };

export default function KpiOverviewCards({ kpi, pending }) {
  if (!kpi) return null;
  const u = kpi.users || {};
  const t = kpi.training || {};
  const r = kpi.reading || {};
  const p = kpi.papers || {};
  const e = kpi.exams || {};
  const pt = pending || {};

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><TeamOutlined /> 在职员工</>}
            value={u.active || 0}
            suffix={<span style={{ fontSize: 14, color: "var(--text-mute)" }}>/ {u.total || 0}</span>}
          />
          <div style={{ marginTop: 6, color: "var(--text-mute)", fontSize: 12 }}>
            今日活跃 <strong style={{ color: "#1677ff" }}>{u.today_active || 0}</strong> 人
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><RocketOutlined /> 本周 AI 对练</>}
            value={t.week_count || 0}
            suffix="次"
          />
          <div style={{ marginTop: 6, color: "var(--text-mute)", fontSize: 12 }}>
            近 7 天累计训练次数
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><BookOutlined /> 本周读书打卡</>}
            value={r.week_count || 0}
            suffix="人次"
          />
          <div style={{ marginTop: 6, color: "var(--text-mute)", fontSize: 12 }}>
            <FireOutlined /> 含补卡
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><CheckCircleOutlined /> 本周试卷通过率</>}
            value={p.week_pass_rate || 0}
            suffix="%"
            precision={1}
            valueStyle={{ color: "#52c41a" }}
          />
          <div style={{ marginTop: 6, color: "var(--text-mute)", fontSize: 12 }}>
            已批阅试卷的通过比例
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><FormOutlined /> 待批阅试卷</>}
            value={p.pending_review || 0}
            valueStyle={{ color: (p.pending_review || 0) > 0 ? "#fa8c16" : undefined }}
            suffix="份"
          />
          <div style={{ marginTop: 6, color: "var(--text-mute)", fontSize: 12 }}>
            提交后等待复核
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><FormOutlined /> 待复核 AI 对练</>}
            value={e.pending_review || 0}
            valueStyle={{ color: (e.pending_review || 0) > 0 ? "#fa8c16" : undefined }}
            suffix="次"
          />
          <div style={{ marginTop: 6, color: "var(--text-mute)", fontSize: 12 }}>
            AI 通关考试待人工复核
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><ClockCircleOutlined /> 临近 deadline</>}
            value={(pt.video_due_in_7d || 0) + (pt.reading_due_in_7d || 0) + (pt.paper_due_in_7d || 0)}
            suffix="项"
          />
          <div style={{ marginTop: 6, color: "var(--text-mute)", fontSize: 12 }}>
            视频 {pt.video_due_in_7d || 0} · 读物 {pt.reading_due_in_7d || 0} · 试卷 {pt.paper_due_in_7d || 0}
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={CARD_STYLE} size="small">
          <Statistic
            title={<><AlertOutlined /> 已逾期未完成</>}
            value={pt.paper_overdue || 0}
            suffix="份"
            valueStyle={{ color: (pt.paper_overdue || 0) > 0 ? "#ff4d4f" : undefined }}
          />
          <div style={{ marginTop: 6 }}>
            {(pt.paper_overdue || 0) > 0 ? (
              <Tag color="red">建议催办</Tag>
            ) : (
              <Tag color="green">无逾期</Tag>
            )}
          </div>
        </Card>
      </Col>
    </Row>
  );
}
