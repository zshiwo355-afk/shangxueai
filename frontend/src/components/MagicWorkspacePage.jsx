import {
  CalendarOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  RightOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, List, Progress, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyAudios, fetchMyMagicVideos } from "../lib/api.magic";

const { Paragraph, Text, Title } = Typography;

export default function MagicWorkspacePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState([]);
  const [audios, setAudios] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [videoData, audioData] = await Promise.all([
          fetchMyMagicVideos().catch(() => []),
          fetchMyAudios().catch(() => []),
        ]);
        if (!alive) return;
        setVideos(Array.isArray(videoData) ? videoData : []);
        setAudios(Array.isArray(audioData) ? audioData : []);
      } catch (error) {
        if (alive) message.error(error?.message || "魔学院学习中心加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message]);

  const requiredPending = videos.filter((item) => item.is_required && !item.progress?.is_completed);
  const inProgress = videos.filter((item) => !item.progress?.is_completed && (item.progress?.progress_percent || 0) > 0);
  const completed = videos.filter((item) => item.progress?.is_completed);
  const continueVideo = inProgress[0] || requiredPending[0] || videos[0] || null;
  const monthAudioCount = audios.filter((item) => dayjs(item.uploaded_time).format("YYYY-MM") === dayjs().format("YYYY-MM")).length;
  const todayUploaded = audios.some((item) => dayjs(item.uploaded_time).format("YYYY-MM-DD") === dayjs().format("YYYY-MM-DD"));
  const recentVideos = useMemo(() => {
    const ordered = [...videos].sort((a, b) => (b.progress?.progress_percent || 0) - (a.progress?.progress_percent || 0));
    return ordered.slice(0, 4);
  }, [videos]);

  return (
    <div className="workspace-shell">
      <section className="workspace-hero workspace-hero--magic">
        <div>
          <Tag bordered={false} className="workspace-hero__eyebrow">魔学院学习中心</Tag>
          <Title level={2} className="workspace-hero__title">把课程学习、节点答题和读书打卡收进一个清晰入口</Title>
          <Paragraph className="workspace-hero__desc">
            先看到最该完成的任务，再继续上次学习进度，最后处理每日打卡，不再在复杂页签里找入口。
          </Paragraph>
          <Space size={12} wrap>
            <Button type="primary" size="large" onClick={() => navigate("/magic-academy")}>
              进入学习中心
            </Button>
            <Button size="large" onClick={() => navigate("/magic-academy?tab=audio")}>
              打开读书打卡
            </Button>
          </Space>
        </div>
        <div className="workspace-hero__stats">
          <div className="workspace-stat">
            <span>待学必修</span>
            <strong>{requiredPending.length}</strong>
          </div>
          <div className="workspace-stat">
            <span>本月打卡</span>
            <strong>{monthAudioCount}</strong>
          </div>
        </div>
      </section>

      <section className="workspace-grid workspace-grid--4">
        <Card className="workspace-card workspace-metric" loading={loading}>
          <ReadOutlined />
          <span>待学课程</span>
          <strong>{requiredPending.length}</strong>
        </Card>
        <Card className="workspace-card workspace-metric" loading={loading}>
          <PlayCircleOutlined />
          <span>进行中课程</span>
          <strong>{inProgress.length}</strong>
        </Card>
        <Card className="workspace-card workspace-metric" loading={loading}>
          <CheckCircleOutlined />
          <span>已完成课程</span>
          <strong>{completed.length}</strong>
        </Card>
        <Card className="workspace-card workspace-metric" loading={loading}>
          <CalendarOutlined />
          <span>今日打卡</span>
          <strong>{todayUploaded ? "已完成" : "未完成"}</strong>
        </Card>
      </section>

      <section className="workspace-grid workspace-grid--aside">
        <div className="workspace-column">
          <Card className="workspace-card" loading={loading}>
            <div className="workspace-section__header">
              <div>
                <Title level={3} style={{ marginBottom: 4 }}>我的学习任务</Title>
                <Text type="secondary">把需要优先完成的课程先展示出来。</Text>
              </div>
              <Button type="link" icon={<RightOutlined />} onClick={() => navigate("/magic-academy")}>
                查看全部
              </Button>
            </div>

            {recentVideos.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有学习任务" />
            ) : (
              <List
                dataSource={recentVideos}
                renderItem={(item) => {
                  const percent = Math.round(item.progress?.progress_percent || 0);
                  return (
                    <List.Item
                      key={item.id}
                      actions={[
                        <Button key="go" type="link" onClick={() => navigate("/magic-academy")}>
                          {item.progress?.is_completed ? "查看" : "继续学习"}
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<VideoCameraOutlined className="workspace-list-icon" />}
                        title={(
                          <Space size={[8, 8]} wrap>
                            <span>{item.title}</span>
                            {item.is_required ? <Tag color="gold">必修</Tag> : null}
                            {item.progress?.is_completed ? <Tag color="success">已完成</Tag> : null}
                          </Space>
                        )}
                        description={(
                          <Space direction="vertical" size={8} style={{ width: "100%" }}>
                            <Text type="secondary">{item.category || "未分类课程"}</Text>
                            <Progress percent={percent} size="small" />
                          </Space>
                        )}
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </div>

        <div className="workspace-column workspace-column--aside">
          <Card className="workspace-card workspace-card--accent" loading={loading}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Space align="center">
                <PlayCircleOutlined />
                <Title level={4} style={{ margin: 0 }}>继续学习</Title>
              </Space>
              {continueVideo ? (
                <>
                  <Title level={5} style={{ margin: 0 }}>{continueVideo.title}</Title>
                  <Text type="secondary">{continueVideo.description || continueVideo.category || "继续你上次的学习进度"}</Text>
                  <Progress percent={Math.round(continueVideo.progress?.progress_percent || 0)} size="small" />
                  <Button type="primary" onClick={() => navigate("/magic-academy")}>
                    进入继续学习
                  </Button>
                </>
              ) : (
                <>
                  <Text type="secondary">当前没有进行中的课程，去学习中心挑一门开始吧。</Text>
                  <Button onClick={() => navigate("/magic-academy")}>浏览课程</Button>
                </>
              )}
            </Space>
          </Card>

          <Card className="workspace-card" loading={loading}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Space align="center">
                <CalendarOutlined />
                <Title level={4} style={{ margin: 0 }}>读书打卡</Title>
              </Space>
              <Text type="secondary">
                {todayUploaded ? "今天已经完成打卡，可以继续上传补充内容。" : "今天还没有上传读书录音，记得完成每日打卡。"}
              </Text>
              <Space size={[8, 8]} wrap>
                <Tag color={todayUploaded ? "success" : "warning"}>{todayUploaded ? "今日已打卡" : "今日未打卡"}</Tag>
                <Tag>{`本月 ${monthAudioCount} 次上传`}</Tag>
              </Space>
              <Button onClick={() => navigate("/magic-academy?tab=audio")}>打开打卡中心</Button>
            </Space>
          </Card>
        </div>
      </section>
    </div>
  );
}
