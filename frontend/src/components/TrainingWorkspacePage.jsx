import {
  ClockCircleOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  RightOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, List, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyExams } from "../lib/api.exam";
import { fetchMyTrainingRecords } from "../lib/api.training";
import { loadActiveSession } from "../lib/storage";

const { Paragraph, Text, Title } = Typography;

function buildExamStatus(exam) {
  if (exam?.status === "pending_review") return { label: "等待复核", color: "gold" };
  if (exam?.status === "in_progress") return { label: "进行中", color: "processing" };
  if (exam?.status === "passed") return { label: "已通过", color: "success" };
  if (exam?.status === "failed") return { label: "未通过", color: "error" };
  return { label: "待开始", color: "warning" };
}

export default function TrainingWorkspacePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState([]);
  const [records, setRecords] = useState([]);
  const activeSession = useMemo(() => loadActiveSession(), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [examData, recordData] = await Promise.all([
          fetchMyExams().catch(() => []),
          fetchMyTrainingRecords().catch(() => []),
        ]);
        if (!alive) return;
        setExams(Array.isArray(examData) ? examData : []);
        setRecords(Array.isArray(recordData) ? recordData : []);
      } catch (error) {
        if (alive) message.error(error?.message || "销售对练工作台加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message]);

  const pendingExams = exams.filter((item) => ["pending", "in_progress", "pending_review"].includes(item.exam?.status));
  const recentRecords = records.slice(0, 4);

  return (
    <div className="workspace-shell">
      <section className="workspace-hero workspace-hero--training">
        <div>
          <Tag bordered={false} className="workspace-hero__eyebrow">销售对练工作台</Tag>
          <Title level={2} className="workspace-hero__title">把训练、考试和复盘放在一个清晰入口里</Title>
          <Paragraph className="workspace-hero__desc">
            从这里继续上次对练、开启新训练、处理考试任务，并快速回看最近的复盘记录。
          </Paragraph>
          <Space size={12} wrap>
            <Button type="primary" size="large" onClick={() => navigate("/train/prepare")}>
              开始新训练
            </Button>
            <Button size="large" onClick={() => navigate("/training/records")}>
              查看全部复盘
            </Button>
          </Space>
        </div>
        <div className="workspace-hero__stats">
          <div className="workspace-stat">
            <span>待处理考试</span>
            <strong>{pendingExams.length}</strong>
          </div>
          <div className="workspace-stat">
            <span>复盘记录</span>
            <strong>{records.length}</strong>
          </div>
        </div>
      </section>

      <section className="workspace-grid workspace-grid--3">
        <Card className="workspace-card workspace-card--accent" loading={loading}>
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Space align="center">
              <PlayCircleOutlined />
              <Title level={4} style={{ margin: 0 }}>继续训练</Title>
            </Space>
            {activeSession?.session_id ? (
              <>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  当前会话已保存，可继续刚才的模拟对话或考试流程。
                </Paragraph>
                <Space size={[8, 8]} wrap>
                  {activeSession.training_type ? <Tag>{activeSession.training_type}</Tag> : null}
                  {activeSession.difficulty ? <Tag>{activeSession.difficulty}</Tag> : null}
                  {activeSession.customer_type ? <Tag>{activeSession.customer_type}</Tag> : null}
                </Space>
                <Button type="primary" onClick={() => navigate(`/chat/${activeSession.session_id}`)}>
                  继续当前会话
                </Button>
              </>
            ) : (
              <>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  当前没有未完成会话，可以直接发起一轮新的销售对练。
                </Paragraph>
                <Button onClick={() => navigate("/train/prepare")}>进入训练配置</Button>
              </>
            )}
          </Space>
        </Card>

        <Card className="workspace-card" loading={loading}>
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Space align="center">
              <ClockCircleOutlined />
              <Title level={4} style={{ margin: 0 }}>待办考试</Title>
            </Space>
            {pendingExams.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理考试" />
            ) : (
              <List
                dataSource={pendingExams.slice(0, 3)}
                renderItem={(item) => {
                  const exam = item.exam || {};
                  const status = buildExamStatus(exam);
                  return (
                    <List.Item
                      key={exam.id}
                      actions={[
                        <Button
                          key="go"
                          type="link"
                          onClick={() => navigate(exam.status === "pending_review" ? `/exam/${exam.id}/result` : `/exam/${exam.id}/intro`)}
                        >
                          立即处理
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={(
                          <Space size={8} wrap>
                            <span>{exam.title || "陪练考试"}</span>
                            <Tag color={status.color}>{status.label}</Tag>
                          </Space>
                        )}
                        description={`已尝试 ${exam.attempt_count}/${exam.max_attempts}，及格分 ${exam.pass_score}`}
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Space>
        </Card>

        <Card className="workspace-card" loading={loading}>
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Space align="center">
              <ReadOutlined />
              <Title level={4} style={{ margin: 0 }}>常用入口</Title>
            </Space>
            <Button block onClick={() => navigate("/train/prepare")}>开始新训练</Button>
            <Button block onClick={() => navigate("/training/records")}>查看训练记录</Button>
            <Button block onClick={() => navigate("/home")}>返回首页总览</Button>
          </Space>
        </Card>
      </section>

      <section className="workspace-section">
        <div className="workspace-section__header">
          <div>
            <Title level={3} style={{ marginBottom: 4 }}>最近复盘</Title>
            <Text type="secondary">把最近几次训练结果放在眼前，方便快速回看和继续提升。</Text>
          </div>
          <Button type="link" icon={<RightOutlined />} onClick={() => navigate("/training/records")}>
            查看全部
          </Button>
        </div>

        {recentRecords.length === 0 ? (
          <Card className="workspace-card">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有训练复盘记录，先开始一轮新的销售对练吧。"
            />
          </Card>
        ) : (
          <div className="workspace-grid workspace-grid--2">
            {recentRecords.map((item) => (
              <Card key={item.id} className="workspace-card workspace-card--interactive" onClick={() => navigate(`/training/records/${item.id}`)}>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color="blue">{item.training_type}</Tag>
                    <Tag>{item.difficulty}</Tag>
                    <Tag color={item.result === "成交" ? "success" : item.result === "意向客户" ? "processing" : "default"}>
                      {item.result || "待定"}
                    </Tag>
                  </Space>
                  <Title level={5} style={{ margin: 0 }}>最近训练得分 {Math.round(item.score || 0)}</Title>
                  <Text type="secondary">{item.customer_type || "未标记客户类型"}</Text>
                  <Space align="center" size={10}>
                    <TrophyOutlined />
                    <Text>{item.created_at?.slice(0, 16).replace("T", " ") || "暂无时间"}</Text>
                  </Space>
                </Space>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
