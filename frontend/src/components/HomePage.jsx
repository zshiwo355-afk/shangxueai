import {
  CalendarOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  HistoryOutlined,
  PlayCircleFilled,
  ReadOutlined,
  RocketOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, List, Progress, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyExams } from "../lib/api.exam";
import { fetchMyAudios, fetchMyMagicVideos } from "../lib/api.magic";
import { fetchMyTrainingRecords } from "../lib/api.training";
import { getCurrentUser } from "../lib/auth";
import { loadActiveSession } from "../lib/storage";

const { Paragraph, Text, Title } = Typography;

function statusTag(status) {
  if (status === "passed") return <Tag color="success" icon={<CheckCircleFilled />}>已通过</Tag>;
  if (status === "failed") return <Tag color="error">未通过</Tag>;
  if (status === "in_progress") return <Tag color="processing" icon={<PlayCircleFilled />}>进行中</Tag>;
  if (status === "pending_review") return <Tag color="gold" icon={<ClockCircleOutlined />}>等待复核</Tag>;
  return <Tag color="warning" icon={<ClockCircleOutlined />}>待考试</Tag>;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = getCurrentUser();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState([]);
  const [records, setRecords] = useState([]);
  const [videos, setVideos] = useState([]);
  const [audios, setAudios] = useState([]);
  const activeSession = useMemo(() => loadActiveSession(), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [examData, recordData, videoData, audioData] = await Promise.all([
          fetchMyExams().catch(() => []),
          fetchMyTrainingRecords().catch(() => []),
          fetchMyMagicVideos().catch(() => []),
          fetchMyAudios().catch(() => []),
        ]);
        if (!alive) return;
        setExams(Array.isArray(examData) ? examData : []);
        setRecords(Array.isArray(recordData) ? recordData : []);
        setVideos(Array.isArray(videoData) ? videoData : []);
        setAudios(Array.isArray(audioData) ? audioData : []);
      } catch (error) {
        if (alive) message.error(error?.message || "首页数据加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message]);

  const todoExams = exams.filter((item) => ["pending", "in_progress", "pending_review"].includes(item.exam?.status));
  const doneExams = exams.filter((item) => ["passed", "failed"].includes(item.exam?.status));
  const pendingVideos = videos.filter((item) => item.is_required && !item.progress?.is_completed);
  const inProgressVideos = videos.filter((item) => !item.progress?.is_completed && (item.progress?.progress_percent || 0) > 0);
  const continueVideo = inProgressVideos[0] || pendingVideos[0] || videos[0] || null;
  const monthAudioCount = audios.filter((item) => dayjs(item.uploaded_time).format("YYYY-MM") === dayjs().format("YYYY-MM")).length;
  const todayUploaded = audios.some((item) => dayjs(item.uploaded_time).format("YYYY-MM-DD") === dayjs().format("YYYY-MM-DD"));

  const todoItems = [
    activeSession?.session_id ? {
      key: "active-session",
      title: activeSession.mode === "exam" ? "上次考试还没结束" : "上次训练还没结束",
      description: activeSession.training_type
        ? `${activeSession.training_type} / ${activeSession.difficulty || "未标记难度"} / ${activeSession.customer_type || "未标记客户类型"}`
        : "可以直接回到刚才的会话继续进行。",
      action: "继续会话",
      onClick: () => navigate(`/chat/${activeSession.session_id}`),
      icon: <PlayCircleFilled />,
    } : null,
    todoExams[0]?.exam ? {
      key: `exam-${todoExams[0].exam.id}`,
      title: todoExams[0].exam.status === "pending_review" ? "有考试在等待复核" : "有考试待处理",
      description: `${todoExams[0].exam.title || "陪练考试"} · 已尝试 ${todoExams[0].exam.attempt_count}/${todoExams[0].exam.max_attempts}`,
      action: todoExams[0].exam.status === "pending_review" ? "查看结果" : "进入考试",
      onClick: () => navigate(todoExams[0].exam.status === "pending_review" ? `/exam/${todoExams[0].exam.id}/result` : `/exam/${todoExams[0].exam.id}/intro`),
      icon: <ClockCircleOutlined />,
    } : null,
    continueVideo ? {
      key: `video-${continueVideo.id}`,
      title: "魔学院里有课程可继续",
      description: `${continueVideo.title} · 进度 ${Math.round(continueVideo.progress?.progress_percent || 0)}%`,
      action: "继续学习",
      onClick: () => navigate("/magic-academy"),
      icon: <ReadOutlined />,
    } : null,
    {
      key: "audio",
      title: todayUploaded ? "今日读书打卡已完成" : "今日还未完成读书打卡",
      description: `本月累计上传 ${monthAudioCount} 次录音`,
      action: "打开打卡中心",
      onClick: () => navigate("/magic-academy?tab=audio"),
      icon: <CalendarOutlined />,
    },
  ].filter(Boolean);

  const averageScore = records.length > 0
    ? Math.round(records.reduce((sum, item) => sum + Number(item.score || 0), 0) / records.length)
    : 0;
  const completedVideoRate = videos.length > 0 ? Math.round((videos.filter((item) => item.progress?.is_completed).length / videos.length) * 100) : 0;

  return (
    <div className="portal-home">
      <section className="portal-home__hero">
        <div className="portal-home__hero-copy">
          <Tag bordered={false} className="portal-home__eyebrow">用户门户首页</Tag>
          <Title level={1} className="portal-home__title">
            欢迎回来，{user?.display_name || user?.username || "学员"}
          </Title>
          <Paragraph className="portal-home__subtitle">
            今天的学习与训练，从这里开始。销售对练负责模拟实战、考试与复盘，魔学院负责课程学习、节点答题与日常打卡。
          </Paragraph>
          <Space size={10} wrap>
            <Tag color="blue">待处理考试 {todoExams.length}</Tag>
            <Tag color="cyan">待学课程 {pendingVideos.length}</Tag>
            <Tag color={todayUploaded ? "success" : "warning"}>{todayUploaded ? "今日已打卡" : "今日未打卡"}</Tag>
          </Space>
        </div>

        <div className="portal-home__entry-grid">
          <Card className="portal-entry portal-entry--training" loading={loading}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <div className="portal-entry__icon"><RocketOutlined /></div>
              <div>
                <Title level={3} style={{ marginBottom: 6, color: "#fff" }}>销售对练</Title>
                <Text className="portal-entry__text">
                  模拟对话、考试评估、复盘提升，适合快速进入实战训练状态。
                </Text>
              </div>
              <Space size={10} wrap>
                <Button size="large" className="portal-entry__primary" onClick={() => navigate("/workspace/training")}>
                  进入工作台
                </Button>
                {activeSession?.session_id ? (
                  <Button size="large" ghost className="portal-entry__ghost" onClick={() => navigate(`/chat/${activeSession.session_id}`)}>
                    继续上次
                  </Button>
                ) : null}
              </Space>
            </Space>
          </Card>

          <Card className="portal-entry portal-entry--magic" loading={loading}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <div className="portal-entry__icon portal-entry__icon--light"><ReadOutlined /></div>
              <div>
                <Title level={3} style={{ marginBottom: 6 }}>魔学院</Title>
                <Text className="portal-entry__text portal-entry__text--dark">
                  课程学习、节点答题、进度跟踪和读书打卡都从这里进入。
                </Text>
              </div>
              <Space size={10} wrap>
                <Button type="primary" size="large" onClick={() => navigate("/workspace/magic")}>
                  进入学习中心
                </Button>
                {continueVideo ? (
                  <Button size="large" onClick={() => navigate("/magic-academy")}>
                    继续学习
                  </Button>
                ) : null}
              </Space>
            </Space>
          </Card>
        </div>
      </section>

      <section className="portal-home__metrics">
        <Card className="portal-metric" loading={loading}>
          <RocketOutlined />
          <span>训练记录</span>
          <strong>{records.length}</strong>
        </Card>
        <Card className="portal-metric" loading={loading}>
          <TrophyOutlined />
          <span>平均得分</span>
          <strong>{averageScore}</strong>
        </Card>
        <Card className="portal-metric" loading={loading}>
          <CheckCircleFilled />
          <span>考试完成</span>
          <strong>{doneExams.length}</strong>
        </Card>
        <Card className="portal-metric" loading={loading}>
          <ReadOutlined />
          <span>课程完成率</span>
          <strong>{`${completedVideoRate}%`}</strong>
        </Card>
      </section>

      <section className="portal-home__panel-grid">
        <Card className="portal-panel" title="我的待办" loading={loading}>
          {todoItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理事项，保持这个节奏就很好。" />
          ) : (
            <List
              dataSource={todoItems}
              renderItem={(item) => (
                <List.Item
                  key={item.key}
                  actions={[
                    <Button key="go" type="link" onClick={item.onClick}>
                      {item.action}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<div className="portal-todo__icon">{item.icon}</div>}
                    title={item.title}
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          )}
        </Card>

        <Card
          className="portal-panel"
          title={<Space><HistoryOutlined />最近训练</Space>}
          extra={<Button type="link" onClick={() => navigate("/training/records")}>全部记录</Button>}
          loading={loading}
        >
          {records.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有训练记录，先开始一轮销售对练吧。" />
          ) : (
            <List
              dataSource={records.slice(0, 4)}
              renderItem={(item) => (
                <List.Item
                  key={item.id}
                  actions={[
                    <Button key="view" type="link" onClick={() => navigate(`/training/records/${item.id}`)}>
                      查看复盘
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={(
                      <Space size={[8, 8]} wrap>
                        <Tag color="blue">{item.training_type}</Tag>
                        <Tag>{item.difficulty}</Tag>
                        <Tag color={item.result === "成交" ? "success" : item.result === "意向客户" ? "processing" : "default"}>
                          {item.result || "待定"}
                        </Tag>
                      </Space>
                    )}
                    description={`得分 ${Math.round(item.score || 0)} · ${item.created_at?.slice(0, 16).replace("T", " ") || "暂无时间"}`}
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </section>

      <section className="portal-home__panel-grid portal-home__panel-grid--secondary">
        <Card
          className="portal-panel"
          title="最近学习"
          extra={<Button type="link" onClick={() => navigate("/magic-academy")}>进入魔学院</Button>}
          loading={loading}
        >
          {videos.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有课程任务，可先进入魔学院查看。" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              {videos.slice(0, 3).map((item) => (
                <div key={item.id} className="portal-course">
                  <div className="portal-course__header">
                    <Space size={[8, 8]} wrap>
                      <Text strong>{item.title}</Text>
                      {item.is_required ? <Tag color="gold">必修</Tag> : null}
                    </Space>
                    <Text type="secondary">{Math.round(item.progress?.progress_percent || 0)}%</Text>
                  </div>
                  <Progress percent={Math.round(item.progress?.progress_percent || 0)} size="small" />
                </div>
              ))}
            </Space>
          )}
        </Card>

        <Card className="portal-panel portal-panel--highlight" loading={loading}>
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Title level={4} style={{ marginBottom: 0 }}>下一步建议</Title>
            {activeSession?.session_id ? (
              <Paragraph style={{ marginBottom: 0 }}>
                你有一个未结束的{activeSession.mode === "exam" ? "考试会话" : "训练会话"}，建议先把它完成，再开启新的内容。
              </Paragraph>
            ) : continueVideo ? (
              <Paragraph style={{ marginBottom: 0 }}>
                优先继续《{continueVideo.title}》，保持学习连续性，然后再处理新的训练任务。
              </Paragraph>
            ) : (
              <Paragraph style={{ marginBottom: 0 }}>
                当前适合先做一轮新的销售对练，或者进入魔学院完成今天的学习与打卡。
              </Paragraph>
            )}
            <Space size={10} wrap>
              <Button type="primary" onClick={() => navigate(activeSession?.session_id ? `/chat/${activeSession.session_id}` : "/workspace/training")}>
                {activeSession?.session_id ? "继续当前会话" : "去销售对练"}
              </Button>
              <Button onClick={() => navigate("/workspace/magic")}>去魔学院</Button>
            </Space>
          </Space>
        </Card>
      </section>

      {doneExams.length > 0 ? (
        <section className="portal-home__done">
          <Card className="portal-panel" title="已完成考试" loading={loading}>
            <List
              dataSource={doneExams.slice(0, 3)}
              renderItem={(item) => {
                const exam = item.exam || {};
                return (
                  <List.Item
                    key={exam.id}
                    actions={[
                      <Button key="view" type="link" onClick={() => navigate(`/exam/${exam.id}/result`)}>
                        查看结果
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Space>{exam.title || "陪练考试"} {statusTag(exam.status)}</Space>}
                      description={exam.completed_at?.slice(0, 16).replace("T", " ") || "暂无完成时间"}
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </section>
      ) : null}
    </div>
  );
}
