import { useMemo } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Grid,
  Progress,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ApiOutlined,
  RadarChartOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";

import { useECharts } from "../admin/dashboard/useECharts";


function RadarPanel({ scores = {} }) {
  const entries = Object.entries(scores);
  const option = useMemo(() => ({
    animationDuration: 700,
    color: ["#c84c35"],
    tooltip: { trigger: "item" },
    radar: {
      radius: "65%",
      splitNumber: 4,
      indicator: entries.map(([name]) => ({ name, max: 100 })),
      axisName: { color: "#5e5a55", fontSize: 12 },
      axisLine: { lineStyle: { color: "rgba(100,82,66,.18)" } },
      splitLine: { lineStyle: { color: "rgba(100,82,66,.14)" } },
      splitArea: { areaStyle: { color: ["rgba(248,242,234,.3)", "rgba(255,255,255,.7)"] } },
    },
    series: [{
      type: "radar",
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2 },
      areaStyle: { color: "rgba(200,76,53,.17)" },
      data: [{ value: entries.map(([, value]) => value), name: "人格倾向" }],
    }],
  }), [entries]);
  const chartRef = useECharts(option, [option]);
  if (!entries.length) return <Empty description="暂无雷达图数据" />;
  return <div ref={chartRef} className="assessment-radar-chart" />;
}


const answerColumns = [
  {
    title: "题号",
    dataIndex: "question_id",
    width: 78,
    render: (value) => <span className="assessment-table-question-id">{value}</span>,
  },
  { title: "题目原文", dataIndex: "prompt" },
  { title: "作答", dataIndex: "answer_label", width: 300, render: (value, record) => record.response_type === "text" ? <span>{value}</span> : <Tag className="assessment-answer-tag">{value}</Tag> },
  { title: "原始值", dataIndex: "raw_score", width: 78, render: (value) => value ?? "—" },
];


export default function AssessmentReport({ detail, aiLoading = false, onRunAI = null }) {
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;

  return (
    <div className="assessment-detail">
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
        <Descriptions.Item label="姓名">{detail.name || "已匿名"}</Descriptions.Item>
        <Descriptions.Item label="手机">{detail.phone || "已匿名"}</Descriptions.Item>
        <Descriptions.Item label="年龄">{detail.age ? `${detail.age} 岁` : "—"}</Descriptions.Item>
        <Descriptions.Item label="岗位">{detail.position || "—"}</Descriptions.Item>
        <Descriptions.Item label="提交次数">第 {detail.attempt_no} 次</Descriptions.Item>
        <Descriptions.Item label="填写时长">{detail.duration_seconds ? `${Math.floor(detail.duration_seconds / 60)} 分 ${detail.duration_seconds % 60} 秒` : "—"}</Descriptions.Item>
        <Descriptions.Item label="规则版本">{detail.score?.rules_version}</Descriptions.Item>
      </Descriptions>

      <Row gutter={[14, 14]} className="assessment-stat-grid">
        {detail.score?.overall_score !== null && detail.score?.overall_score !== undefined ? (
          <Col xs={12} md={6}><Card><Statistic title="职场行为总分（旧版）" value={detail.score?.overall_score} suffix="/ 100" /></Card></Col>
        ) : null}
        <Col xs={12} md={6}><Card><Statistic title="倾向类型" value={detail.score?.profile_label || "—"} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="可信度" value={detail.score?.credibility?.score} suffix="%" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={detail.score?.rules_version !== "personality-v1" ? "面试核实线索" : "风险证据"} value={detail.score?.risks?.length || 0} suffix="项" /></Card></Col>
      </Row>

      <Alert
        showIcon
        icon={<SafetyCertificateOutlined />}
        type={detail.score?.credibility?.score >= 80 ? "success" : "warning"}
        title={`可信度：${detail.score?.credibility?.status || "—"}`}
        description={detail.score?.credibility?.duration_note || "可信度只表示答题一致性，不影响任何人格或职场维度。"}
      />

      <div className="assessment-detail-grid">
        <Card title={<><RadarChartOutlined /> {detail.score?.norm_percentiles ? "人格参考百分位" : "人格倾向雷达图"}</>}>
          <RadarPanel scores={detail.score?.radar_scores} />
          <Typography.Paragraph type="secondary">
            {detail.score?.norm_reference
              ? `${detail.score.norm_reference.sample_label}（N=${detail.score.norm_reference.sample_size}）。${detail.score.norm_reference.sample_note}`
              : "人格倾向用于描述风格，不进入职场行为总分。"}
          </Typography.Paragraph>
        </Card>
        <Card title={detail.score?.rules_version !== "personality-v1" ? "六项工作倾向" : "五项职场行为维度"}>
          <div className="assessment-behavior-bars">
            {Object.entries(detail.score?.behavior_scores || {}).map(([name, value]) => (
              <div key={name}>
                <span><strong>{name}</strong><em>{Number(value).toFixed(1)}</em></span>
                <Progress percent={Number(value)} showInfo={false} strokeColor="#1f6a5d" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card
        className="assessment-ai-card"
        title={<><RobotOutlined /> AI 面试辅助分析</>}
        extra={onRunAI ? <Button type="primary" icon={<ApiOutlined />} loading={aiLoading} onClick={() => onRunAI(!!detail.ai_report)}>{detail.ai_report ? "重新生成" : "生成分析"}</Button> : null}
      >
        {detail.ai_report ? (
          <div className="assessment-ai-report">
            <Typography.Paragraph className="assessment-ai-summary">{detail.ai_report.overall_summary}</Typography.Paragraph>
            <Row gutter={[20, 20]}>
              <Col xs={24} md={12}><h4>3 项优势信号</h4><ol>{detail.ai_report.strengths?.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
              <Col xs={24} md={12}><h4>3 项面试核实点</h4><ol>{detail.ai_report.verification_points?.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
              {detail.ai_report.primary_job_directions?.length ? (
                <Col xs={24} md={12}><h4>5 个主要匹配方向</h4><ol>{detail.ai_report.primary_job_directions.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
              ) : null}
              {detail.ai_report.secondary_job_directions?.length ? (
                <Col xs={24} md={12}><h4>5 个次要匹配方向</h4><ol>{detail.ai_report.secondary_job_directions.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
              ) : null}
              <Col span={24}><h4>5 个建议追问</h4><ol className="assessment-interview-list">{detail.ai_report.interview_questions?.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
            </Row>
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击生成后，AI 只会读取确定性维度、情境作答和可信度，不会读取姓名、电话、年龄或应聘岗位。" />
        )}
      </Card>

      <Card title={`${detail.score?.rules_version !== "personality-v1" ? "面试核实线索" : "风险证据"}（${detail.score?.risks?.length || 0}）`}>
        {detail.score?.risks?.length ? (
          <div className="assessment-risk-list">
            {detail.score.risks.map((risk) => (
              <div key={risk.id}>
                <Tag color={detail.score?.rules_version !== "personality-v1" ? "blue" : "red"}>{risk.question_id}</Tag>
                <strong>{risk.label}</strong>
                <p>{risk.prompt}</p>
                <span className="assessment-risk-answer">{detail.score?.rules_version !== "personality-v1" ? "汇总结果" : "填写人选择"}：{risk.answer_label}</span>
              </div>
            ))}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有需要单独标记的极端取舍" />}
      </Card>

      <Card title="逐题作答明细" className="assessment-answer-detail-card">
        {isMobile ? (
          <div className="assessment-mobile-answer-list">
            {(detail.answer_details || []).map((answer) => (
              <article key={answer.question_id}>
                <header>
                  <span className="assessment-table-question-id">{answer.question_id}</span>
                  <small>原始值 {answer.raw_score ?? "—"}</small>
                </header>
                <p>{answer.prompt}</p>
                <div>
                  <strong>作答</strong>
                  {answer.response_type === "text"
                    ? <span>{answer.answer_label}</span>
                    : <Tag className="assessment-answer-tag">{answer.answer_label}</Tag>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Table rowKey="question_id" size="small" pagination={false} columns={answerColumns} dataSource={detail.answer_details || []} scroll={{ x: 760 }} />
        )}
      </Card>
    </div>
  );
}
