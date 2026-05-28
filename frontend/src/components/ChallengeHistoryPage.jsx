import { CheckCircleOutlined, ClockCircleOutlined, HistoryOutlined, TrophyOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyExams } from "../lib/api.exam";

const { Paragraph, Text, Title } = Typography;

function challengeStatusMeta(exam, attempts) {
  if (exam?.status === "pending_review" || attempts.some((item) => item.review_pending)) {
    return { label: "待复核", color: "gold" };
  }
  if (exam?.status === "in_progress") {
    return { label: "进行中", color: "processing" };
  }
  if (exam?.status === "passed") {
    return { label: "已通过", color: "success" };
  }
  if (exam?.status === "failed") {
    return { label: "未通过", color: "error" };
  }
  return { label: "待开始", color: "default" };
}

function formatTime(value) {
  if (!value) return "暂无时间";
  return String(value).slice(0, 16).replace("T", " ");
}

function latestAttemptLabel(entry) {
  const latest = entry.attempts.at(-1);
  if (!latest) return "尚未开始通关";
  return `${latest.training_type || "随机训练"} · ${latest.customer_type || "随机客户"}`;
}

function latestScore(entry) {
  const latest = entry.attempts.at(-1);
  if (!latest) return null;
  if (latest.final_score != null) return Math.round(latest.final_score);
  if (latest.score != null) return Math.round(latest.score);
  return null;
}

function scoreHint(entry) {
  const latest = entry.attempts.at(-1);
  if (!latest) return "等待开始";
  if (latest.review_pending) return "AI 预评";
  if (latest.final_score != null) return latest.final_is_pass ? "综合通过" : "综合待提升";
  return "最近一次";
}

export default function ChallengeHistoryPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterKey, setFilterKey] = useState("all");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const data = await fetchMyExams();
        if (!alive) return;
        setItems(Array.isArray(data) ? data : []);
      } catch (error) {
        if (alive) message.error(error?.message || "通关记录加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [message]);

  const summary = useMemo(() => {
    const pending = items.filter((item) => ["pending", "in_progress"].includes(item.exam?.status)).length;
    const review = items.filter((item) => item.exam?.status === "pending_review").length;
    const passed = items.filter((item) => item.exam?.status === "passed").length;
    return { total: items.length, pending, review, passed };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filterKey === "pending") {
      return items.filter((item) => ["pending", "in_progress"].includes(item.exam?.status));
    }
    if (filterKey === "review") {
      return items.filter((item) => item.exam?.status === "pending_review");
    }
    if (filterKey === "done") {
      return items.filter((item) => ["passed", "failed"].includes(item.exam?.status));
    }
    return items;
  }, [filterKey, items]);

  const renderCard = (entry) => {
    const exam = entry.exam || {};
    const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
    const latest = attempts.at(-1) || null;
    const status = challengeStatusMeta(exam, attempts);
    const score = latestScore(entry);
    const primaryAction =
      exam.status === "pending_review" || exam.status === "passed" || exam.status === "failed"
        ? () => navigate(`/exam/${exam.id}/result`)
        : () => navigate(`/exam/${exam.id}/intro`);

    return (
      <Card key={exam.id} className="history-record-card history-record-card--minimal" bordered={false}>
        <div className="history-record-card__top">
          <div className="history-record-card__content">
            <Space size={[8, 8]} wrap>
              <Tag bordered={false} color={status.color}>{status.label}</Tag>
              <Tag bordered={false} color="blue">{latest?.training_type || exam.fixed_training_type || "随机训练"}</Tag>
              <Tag bordered={false}>{latest?.difficulty || exam.fixed_difficulty || "中等"}</Tag>
              <Tag bordered={false}>{latest?.customer_type || exam.fixed_customer_type || "随机客户"}</Tag>
            </Space>

            <Title level={5} style={{ margin: "10px 0 0", color: "var(--accent-deep, #426f9f)" }}>
              {exam.title || "AI 通关"}
            </Title>

            <Text type="secondary" className="history-record-card__summary">
              {latestAttemptLabel(entry)}
            </Text>
          </div>

          <div className="history-record-card__score">
            <TrophyOutlined />
            <strong>{score ?? "—"}</strong>
            <span>{scoreHint(entry)}</span>
          </div>
        </div>

        <div className="history-record-card__meta">
          <span>{formatTime(latest?.completed_at || exam.updated_at || exam.created_at)}</span>
          <span>已尝试 {exam.attempt_count || 0}/{exam.max_attempts || 0} 次 · 及格线 {exam.pass_score || 0}</span>
        </div>

        <div className="history-record-card__actions">
          <Space size={10} wrap>
            <Button type="primary" onClick={primaryAction}>
              {exam.status === "pending_review" || exam.status === "passed" || exam.status === "failed" ? "查看结果" : "进入通关"}
            </Button>
            <Button icon={<HistoryOutlined />} onClick={() => navigate(`/exam/${exam.id}/result`)}>
              历史详情
            </Button>
          </Space>
          {exam.status === "passed" ? (
            <Tag bordered={false} color="success" icon={<CheckCircleOutlined />}>已达标</Tag>
          ) : (
            <Tag bordered={false} color={status.color} icon={<ClockCircleOutlined />}>{status.label}</Tag>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="page-shell page-shell--wide page-shell--minimal">
      <div className="page-toolbar page-toolbar--stack page-toolbar--minimal">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>通关记录</h2>
            <Text type="secondary">集中查看每场 AI 通关的状态、得分和历史结果。</Text>
          </div>
        </div>

        <div className="page-toolbar__actions">
          <Button onClick={() => navigate("/training/records")}>训练记录</Button>
          <Button type="primary" onClick={() => navigate("/workspace/training")}>返回工作台</Button>
        </div>
      </div>

      <div className="history-summary history-summary--minimal">
        <Card className="history-summary__card" bordered={false}>
          <span>总数</span>
          <strong>{summary.total}</strong>
        </Card>
        <Card className="history-summary__card" bordered={false}>
          <span>待通关</span>
          <strong style={{ color: "var(--accent-deep, #426f9f)" }}>{summary.pending}</strong>
        </Card>
        <Card className="history-summary__card" bordered={false}>
          <span>待复核</span>
          <strong style={{ color: "#d97706" }}>{summary.review}</strong>
        </Card>
        <Card className="history-summary__card" bordered={false}>
          <span>已通过</span>
          <strong style={{ color: "#16a34a" }}>{summary.passed}</strong>
        </Card>
      </div>

      <Card className="history-filter-card history-filter-card--minimal" bordered={false}>
        <div className="history-filter-card__content">
          <Space align="center" size={[8, 8]} wrap>
            <Button type={filterKey === "all" ? "primary" : "default"} onClick={() => setFilterKey("all")}>全部</Button>
            <Button type={filterKey === "pending" ? "primary" : "default"} onClick={() => setFilterKey("pending")}>待通关</Button>
            <Button type={filterKey === "review" ? "primary" : "default"} onClick={() => setFilterKey("review")}>待复核</Button>
            <Button type={filterKey === "done" ? "primary" : "default"} onClick={() => setFilterKey("done")}>已结束</Button>
          </Space>
          <Text type="secondary">{filteredItems.length} 条</Text>
        </div>
      </Card>

      {loading ? (
        <div className="history-card-list history-card-list--minimal">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="history-record-card history-record-card--minimal" bordered={false}>
              <Paragraph style={{ marginBottom: 0 }}>加载中...</Paragraph>
            </Card>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card bordered={false}>
          <Empty description="当前没有可查看的通关记录。" />
        </Card>
      ) : (
        <div className="history-card-list history-card-list--minimal">
          {filteredItems.map(renderCard)}
        </div>
      )}
    </div>
  );
}
