import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  HistoryOutlined,
  LogoutOutlined,
  PlayCircleFilled,
  RocketOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Card, Empty, List, Space, Tag, Typography, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyExams } from "../lib/api.exam";
import { fetchMyTrainingRecords } from "../lib/api.training";
import { logoutApi } from "../lib/api.auth";
import { clearAuth, getCurrentUser } from "../lib/auth";

const { Title, Text } = Typography;

function statusTag(status) {
  if (status === "passed") return <Tag color="success" icon={<CheckCircleFilled />}>已通过</Tag>;
  if (status === "failed") return <Tag color="error" icon={<CloseCircleFilled />}>未通过</Tag>;
  if (status === "in_progress") return <Tag color="processing" icon={<PlayCircleFilled />}>进行中</Tag>;
  if (status === "pending_review") return <Tag color="gold" icon={<ClockCircleOutlined />}>等待老师复核</Tag>;
  return <Tag color="warning" icon={<ClockCircleOutlined />}>待考试</Tag>;
}

export default function HomePage() {
  const [exams, setExams] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = getCurrentUser();

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
      } catch (err) {
        if (alive) message.error(err?.message || "加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message]);

  const handleLogout = async () => {
    try { await logoutApi(); } catch { /* ignore */ }
    clearAuth();
    navigate("/login", { replace: true });
  };

  // 待办：pending / in_progress / pending_review
  const todo = exams.filter((e) => ["pending", "in_progress", "pending_review"].includes(e.exam?.status));
  // 已完成：passed / failed
  const done = exams.filter((e) => ["passed", "failed"].includes(e.exam?.status));

  return (
    <div className="home-screen">
      <header className="home-topbar">
        <div className="home-brand">
          <div className="prepare-emblem" style={{ width: 40, height: 40, fontSize: 18, marginBottom: 0, borderRadius: 12 }}>商</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>商学院AI培训</div>
            <div style={{ fontSize: 12, color: "var(--text-mute)" }}>欢迎，{user?.display_name || user?.username}</div>
          </div>
        </div>
        <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
      </header>

      <main className="home-main">
        <div className="home-entry-grid">
          <Card
            className="home-cta-card"
            variant="borderless"
            styles={{ body: { padding: 24 } }}
          >
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Title level={4} style={{ margin: 0, color: "#fff" }}>立即训练</Title>
              <Text style={{ color: "rgba(255,255,255,0.85)" }}>自由选择训练类型与客户画像，AI 客户陪你练 ≥10 轮。</Text>
              <Button
                type="default"
                size="large"
                icon={<RocketOutlined />}
                style={{ marginTop: 12, background: "#fff", borderColor: "#fff", color: "var(--accent-deep)", fontWeight: 600 }}
                onClick={() => navigate("/train/prepare")}
              >
                开始训练
              </Button>
            </Space>
          </Card>

          <Card
            className="home-magic-card"
            variant="outlined"
            styles={{ body: { padding: 24 } }}
          >
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Space size={10}>
                <ReadOutlined style={{ fontSize: 20, color: "var(--accent-deep)" }} />
                <Title level={4} style={{ margin: 0 }}>魔学院</Title>
              </Space>
              <Text style={{ color: "var(--text-mute)" }}>
                覆盖视频学习、节点答题、学习统计、白名单、读书录音上传和月度统计。
              </Text>
              <Button
                type="primary"
                size="large"
                icon={<ReadOutlined />}
                style={{ marginTop: 12, alignSelf: "flex-start" }}
                onClick={() => navigate("/magic-academy")}
              >
                进入魔学院
              </Button>
            </Space>
          </Card>
        </div>

        <Card
          title="待办考试"
          variant="outlined"
          extra={done.length > 0 ? <Text type="secondary">已完成 {done.length}</Text> : null}
        >
          {loading ? (
            <Text type="secondary">加载中…</Text>
          ) : todo.length === 0 ? (
            <Empty description="暂无待办考试" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              dataSource={todo}
              renderItem={(item) => {
                const e = item.exam || {};
                const isPendingReview = e.status === "pending_review";
                return (
                  <List.Item
                    key={e.id}
                    actions={[
                      isPendingReview ? (
                        <Button
                          key="enter"
                          size="small"
                          onClick={() => navigate(`/exam/${e.id}/result`)}
                        >
                          查看 AI 预评分
                        </Button>
                      ) : (
                        <Button
                          key="enter"
                          type="primary"
                          size="small"
                          onClick={() => navigate(`/exam/${e.id}/intro`)}
                        >
                          {e.status === "in_progress" ? "继续答题" : "进入考试"}
                        </Button>
                      ),
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<Avatar style={{ background: "var(--accent)" }}>考</Avatar>}
                      title={<Space>{e.title || "陪练考试"} {statusTag(e.status)}</Space>}
                      description={
                        <Space size={16} wrap>
                          <span>已尝试 {e.attempt_count}/{e.max_attempts}</span>
                          <span>及格分 {e.pass_score}</span>
                          <span style={{ color: "var(--text-faint)" }}>{e.created_at?.slice(0, 16).replace("T", " ")}</span>
                        </Space>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          )}
        </Card>

        {done.length > 0 ? (
          <Card title="已完成考试" variant="outlined">
            <List
              dataSource={done}
              renderItem={(item) => {
                const e = item.exam || {};
                return (
                  <List.Item
                    key={e.id}
                    actions={[
                      <Button
                        key="view"
                        size="small"
                        onClick={() => navigate(`/exam/${e.id}/result`)}
                      >
                        查看复盘
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Space>{e.title || "陪练考试"} {statusTag(e.status)}</Space>}
                      description={
                        <span style={{ color: "var(--text-faint)" }}>
                          {e.completed_at?.slice(0, 16).replace("T", " ")}
                        </span>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        ) : null}

        <Card
          title={<Space><HistoryOutlined />我的训练记录</Space>}
          variant="outlined"
          extra={
            records.length > 0 ? (
              <Button type="link" onClick={() => navigate("/training/records")}>查看全部</Button>
            ) : null
          }
        >
          {loading ? (
            <Text type="secondary">加载中…</Text>
          ) : records.length === 0 ? (
            <Empty description="还没有训练记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              dataSource={records.slice(0, 5)}
              renderItem={(item) => (
                <List.Item
                  key={item.id}
                  actions={[
                    <Button
                      key="view"
                      size="small"
                      type="link"
                      onClick={() => navigate(`/training/records/${item.id}`)}
                    >
                      查看
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={8}>
                        <Tag color="blue">{item.training_type}</Tag>
                        <Tag>{item.difficulty}</Tag>
                        <Tag color={item.result === "成交" ? "success" : item.result === "意向客户" ? "processing" : "default"}>
                          {item.result || "—"}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space size={16}>
                        <span>分数 <strong>{Math.round(item.score || 0)}</strong></span>
                        <span style={{ color: "var(--text-faint)" }}>
                          {item.created_at?.slice(0, 16).replace("T", " ")}
                        </span>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </main>
    </div>
  );
}
