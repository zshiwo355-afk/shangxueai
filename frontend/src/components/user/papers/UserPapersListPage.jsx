import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  FilterOutlined,
  FormOutlined,
  HistoryOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Pagination, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyPaperAssignments } from "../../../lib/api.userPapers";

const { Paragraph, Text, Title } = Typography;
const PAGE_SIZE = 6;

const FILTER_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "todo", label: "待处理" },
  { key: "done", label: "已结束" },
];

function formatTime(value) {
  if (!value) return "";
  return String(value).slice(0, 16).replace("T", " ");
}

function tsOf(item) {
  if (item.last_submitted_at) return new Date(item.last_submitted_at).getTime();
  if (item.deadline_at) return new Date(item.deadline_at).getTime();
  return Number(item.id || 0);
}

function attemptsLeft(item) {
  return Math.max(0, Number(item.max_attempts || 1) - Number(item.attempt_count || 0));
}

function isDoneItem(item) {
  return item.last_status === "graded" || (item.is_expired && attemptsLeft(item) <= 0);
}

function canTake(item) {
  if (item.is_expired) return false;
  if (attemptsLeft(item) <= 0) return false;
  return true;
}

function statusTag(item) {
  if (item.is_expired && item.last_status !== "graded") {
    return <Tag bordered={false}>已截止</Tag>;
  }
  if (item.last_status === "graded") {
    return item.last_is_pass ? (
      <Tag bordered={false} color="success">已通过</Tag>
    ) : (
      <Tag bordered={false} color="error">未通过</Tag>
    );
  }
  if (item.last_status === "submitted") {
    return <Tag bordered={false} color="processing">待复核</Tag>;
  }
  if (item.last_status === "in_progress") {
    return <Tag bordered={false} color="warning">进行中</Tag>;
  }
  return <Tag bordered={false}>未开始</Tag>;
}

function scoreTone(score) {
  const value = Number(score || 0);
  if (value >= 85) return { color: "var(--accent-deep, #426f9f)", label: "优" };
  if (value >= 70) return { color: "#16a34a", label: "良" };
  if (value >= 60) return { color: "#f59e0b", label: "中" };
  return { color: "#dc2626", label: "待提升" };
}

export default function UserPapersListPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterKey, setFilterKey] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchMyPaperAssignments();
        if (alive) setItems(Array.isArray(data) ? data : []);
      } catch (err) {
        if (alive) message.error(err?.message || "考试列表加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message]);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => tsOf(b) - tsOf(a));
  }, [items]);

  const summary = useMemo(() => {
    const todoList = items.filter((it) => !isDoneItem(it));
    const availableCount = todoList.filter(canTake).length;
    const retryCount = todoList.filter((it) => Number(it.attempt_count || 0) > 0 && canTake(it)).length;
    return {
      total: items.length,
      todo: todoList.length,
      available: availableCount,
      retry: retryCount,
    };
  }, [items]);

  const filtered = useMemo(() => {
    if (filterKey === "todo") return sorted.filter((it) => !isDoneItem(it));
    if (filterKey === "done") return sorted.filter(isDoneItem);
    return sorted;
  }, [filterKey, sorted]);

  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const renderCard = (item) => {
    const left = attemptsLeft(item);
    const max = Number(item.max_attempts || 1);
    const takeable = canTake(item);
    const deadlineText = item.deadline_at ? `截止 ${formatTime(item.deadline_at)}` : "无截止时间";
    const score = item.last_final_score != null ? Math.round(item.last_final_score) : null;
    const tone = score != null ? scoreTone(score) : null;

    return (
      <Card
        key={item.id}
        className="history-record-card history-record-card--minimal"
        bordered={false}
      >
        <div className="history-record-card__top">
          <div className="history-record-card__content">
            <Space size={[8, 8]} wrap>
              {statusTag(item)}
              <Tag bordered={false} color="blue">
                <ClockCircleOutlined />{" "}
                {item.duration_minutes > 0 ? `${item.duration_minutes} 分钟` : "不限时"}
              </Tag>
              <Tag bordered={false}>剩余 {left}/{max} 次</Tag>
            </Space>
            <Title
              level={5}
              style={{ margin: "10px 0 0", color: "var(--accent-deep, #426f9f)" }}
            >
              {item.paper_title}
            </Title>
            {item.paper_description ? (
              <Paragraph
                type="secondary"
                style={{ margin: "6px 0 0", lineHeight: 1.7 }}
                ellipsis={{ rows: 2 }}
              >
                {item.paper_description}
              </Paragraph>
            ) : null}
          </div>

          {score != null ? (
            <div
              className="history-record-card__score"
              style={{ color: tone.color }}
            >
              <TrophyOutlined />
              <strong style={{ color: tone.color }}>{score}</strong>
              <span style={{ color: tone.color, opacity: 0.78 }}>{tone.label}</span>
            </div>
          ) : (
            <div className="history-record-card__score">
              <strong>{item.total_score || 0}</strong>
              <span>满分</span>
            </div>
          )}
        </div>

        <div className="history-record-card__meta">
          <span>题目 {item.question_count || 0} 道 · 及格 {item.pass_score || 0} · {deadlineText}</span>
        </div>

        <div className="history-record-card__actions">
          <Space size={10} wrap>
            {takeable ? (
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                onClick={() => navigate(`/papers/${item.id}/take`)}
              >
                {item.attempt_count > 0 ? "再次答题" : "开始答题"}
              </Button>
            ) : (
              <Button disabled>{item.is_expired ? "已截止" : "次数已用完"}</Button>
            )}
            {item.last_submission_id ? (
              <Button
                icon={<HistoryOutlined />}
                onClick={() => navigate(`/papers/submissions/${item.last_submission_id}`)}
              >
                查看上次结果
              </Button>
            ) : null}
          </Space>
        </div>
      </Card>
    );
  };

  const firstTodo = useMemo(
    () => sorted.find((it) => !isDoneItem(it) && canTake(it)),
    [sorted],
  );

  return (
    <div className="workspace-shell workspace-shell--editorial workspace-shell--minimal">
      <section className="showcase-hero">
        <span className="showcase-hero__year" aria-hidden="true">考</span>
        <div className="showcase-hero__inner">
          <div className="showcase-hero__intro">
            <span className="showcase-eyebrow fade-in-up" style={{ "--fade-delay": "0ms" }}>
              Exam Center
            </span>
            <Title level={1} className="showcase-hero__title fade-in-up" style={{ "--fade-delay": "80ms" }}>
              试卷 · 答题 · 复盘
            </Title>
            <p className="showcase-hero__english fade-in-up" style={{ "--fade-delay": "160ms" }}>
              TEST WHAT YOU LEARN
            </p>
            <Paragraph className="showcase-hero__desc fade-in-up" style={{ "--fade-delay": "220ms" }}>
              管理员派发的试卷在这里集中处理：先完成待办、再回看成绩，
              把每一次答题都变成一次知识沉淀。
            </Paragraph>
            <div className="showcase-hero__actions fade-in-up" style={{ "--fade-delay": "300ms" }}>
              <button
                type="button"
                className="cta-arrow-btn"
                onClick={() => {
                  if (firstTodo) {
                    navigate(`/papers/${firstTodo.id}/take`);
                  } else {
                    setFilterKey("todo");
                  }
                }}
              >
                <FormOutlined />
                <span>{firstTodo ? "立即答题" : "查看待办考试"}</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
              <button
                type="button"
                className="cta-arrow-btn cta-arrow-btn--ghost"
                onClick={() => setFilterKey("done")}
              >
                <HistoryOutlined />
                <span>查看历史成绩</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
            </div>
          </div>
          <aside className="showcase-hero__side fade-in-up" style={{ "--fade-delay": "380ms" }}>
            <span className="showcase-hero__side-eyebrow">Today at a glance</span>
            <ul className="showcase-hero__side-list">
              <li className="showcase-hero__side-item">
                <span>全部任务</span>
                <strong>{summary.total}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>待处理</span>
                <strong>{summary.todo}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>可立即答题</span>
                <strong>{summary.available}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>可重做</span>
                <strong>{summary.retry}</strong>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <div className="stats-row">
        <div className="stats-row__item">
          <span className="stats-row__value">{summary.total}</span>
          <span className="stats-row__label">全部任务</span>
        </div>
        <div className="stats-row__item">
          <span className="stats-row__value">{summary.todo}</span>
          <span className="stats-row__label">待处理</span>
        </div>
        <div className="stats-row__item">
          <span className="stats-row__value">{summary.available}</span>
          <span className="stats-row__label">可立即答题</span>
        </div>
        <div className="stats-row__item">
          <span className="stats-row__value">{summary.retry}</span>
          <span className="stats-row__label">可重做</span>
        </div>
      </div>

      <Card className="history-filter-card history-filter-card--minimal" bordered={false}>
        <div className="history-filter-card__content">
          <Space align="center" size={[8, 8]} wrap>
            <FilterOutlined style={{ color: "var(--text-mute)" }} />
            {FILTER_OPTIONS.map((option) => (
              <Button
                key={option.key}
                type={filterKey === option.key ? "primary" : "default"}
                onClick={() => setFilterKey(option.key)}
              >
                {option.label}
              </Button>
            ))}
          </Space>
          <Text type="secondary">{filtered.length} 项</Text>
        </div>
      </Card>

      {loading ? (
        <div
          className="history-card-list history-card-list--minimal"
          style={{ gridTemplateColumns: "1fr" }}
        >
          {[0, 1].map((i) => (
            <Card
              key={i}
              className="history-record-card history-record-card--minimal"
              bordered={false}
            >
              <Skeleton active paragraph={{ rows: 3 }} />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card bordered={false}>
          <Empty
            description={
              filterKey === "all"
                ? "暂时没有考试任务。"
                : filterKey === "todo"
                  ? "当前没有待处理的考试。"
                  : "还没有已结束的考试。"
            }
          />
        </Card>
      ) : (
        <>
          <div
            className="history-card-list history-card-list--minimal"
            style={{ gridTemplateColumns: "1fr" }}
          >
            {slice.map(renderCard)}
          </div>
          {filtered.length > PAGE_SIZE ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={filtered.length}
                onChange={setPage}
                showSizeChanger={false}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
