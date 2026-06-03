import {
  CalendarOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FormOutlined,
  ReadOutlined,
  RocketOutlined,
  ScheduleOutlined,
  SoundOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Badge, Button, Card, Empty, Skeleton, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchMyExams } from "../lib/api.exam";
import { fetchMyMagicVideos, fetchMyReadingContents } from "../lib/api.magic";
import { fetchMyPaperAssignments } from "../lib/api.userPapers";

const { Paragraph, Title, Text } = Typography;

// 三档分桶语义：
// - overdue：已经过截止时间，但任务仍未完成（最紧急）
// - today  ：截止在今天 23:59 之前；或读物补卡的当日新读物
// - week   ：截止在本周日 23:59 之前
// - later  ：有截止但更远 / 没有截止时间的"长尾"待办，单独一档展示
const BUCKET_META = {
  overdue: { key: "overdue", label: "已逾期", icon: <ExclamationCircleOutlined />, tone: "danger", desc: "请尽快处理，部分任务可能已无法补做。" },
  today: { key: "today", label: "今日必做", icon: <ClockCircleOutlined />, tone: "warning", desc: "今天截止，建议优先完成。" },
  week: { key: "week", label: "本周到期", icon: <CalendarOutlined />, tone: "primary", desc: "在本周内完成即可。" },
  later: { key: "later", label: "稍后处理", icon: <ScheduleOutlined />, tone: "default", desc: "暂无紧迫截止，但仍属待办。" },
};
const BUCKET_ORDER = ["overdue", "today", "week", "later"];

const KIND_META = {
  paper: { label: "试卷", icon: <FormOutlined />, color: "geekblue" },
  exam: { label: "AI 通关", icon: <RocketOutlined />, color: "purple" },
  video: { label: "课程", icon: <ReadOutlined />, color: "cyan" },
  reading: { label: "读书打卡", icon: <SoundOutlined />, color: "magenta" },
};

function endOfTodayLocal() {
  return dayjs().endOf("day");
}

function endOfWeekLocal() {
  // 周日为本周末。dayjs 默认 locale 周一为 startOf("week")，但本项目 README/导航中用周日为分隔点，
  // 这里取 .endOf('week') 与默认 locale 行为保持一致；用户能直观看到的语义就是"本周日 23:59 前"。
  return dayjs().endOf("week");
}

function bucketByDeadline(deadline) {
  // 没有截止：归"稍后"。
  if (!deadline) return "later";
  const dl = dayjs(deadline);
  if (!dl.isValid()) return "later";
  const now = dayjs();
  if (dl.isBefore(now)) return "overdue";
  if (dl.isBefore(endOfTodayLocal()) || dl.isSame(endOfTodayLocal())) return "today";
  if (dl.isBefore(endOfWeekLocal()) || dl.isSame(endOfWeekLocal())) return "week";
  return "later";
}

function formatDeadline(deadline) {
  if (!deadline) return "无截止";
  const dl = dayjs(deadline);
  if (!dl.isValid()) return "无截止";
  return dl.format("MM-DD HH:mm");
}

function paperAttemptsLeft(item) {
  return Math.max(0, Number(item.max_attempts || 1) - Number(item.attempt_count || 0));
}

function paperIsTodo(item) {
  if (!item) return false;
  if (item.last_status === "graded") return false;
  if (item.is_expired && paperAttemptsLeft(item) <= 0) return false;
  return true;
}

function paperStatusText(item) {
  if (item.last_status === "submitted") return item.manual_review_subjective ? "等待复核" : "评分中";
  if (item.last_status === "in_progress") return "答题进行中";
  return "尚未开始";
}

// ---------- 数据 → 待办项 ----------

function buildPaperTodos(papers) {
  return papers.filter(paperIsTodo).map((item) => {
    // last_status === submitted 时虽然算"待办"（要看结果或等待复核），但用户层面其实没有动作要做，
    // 我们仍然把它归为待办里的 later 段，避免被遗漏，但 action 改为"查看结果"。
    const isResultOnly = item.last_status === "submitted";
    const deadline = isResultOnly ? null : item.deadline_at;
    return {
      id: `paper:${item.id}`,
      kind: "paper",
      title: item.paper_title,
      subtitle: paperStatusText(item),
      deadline,
      bucket: bucketByDeadline(deadline),
      url: isResultOnly && item.last_submission_id
        ? `/papers/submissions/${item.last_submission_id}`
        : `/papers/${item.id}/take`,
      action: isResultOnly ? "查看结果" : "去答题",
    };
  });
}

function buildExamTodos(challenges) {
  const out = [];
  for (const item of challenges) {
    const exam = item.exam || item;
    if (!exam) continue;
    if (!["pending", "in_progress", "pending_review"].includes(exam.status)) continue;
    const isReview = exam.status === "pending_review";
    const deadline = isReview ? null : exam.deadline_at;
    let subtitle = "尚未开始";
    if (exam.status === "in_progress") subtitle = "进行中";
    else if (exam.status === "pending_review") subtitle = "等待管理员复核";
    out.push({
      id: `exam:${exam.id}`,
      kind: "exam",
      title: exam.title || "AI 通关",
      subtitle,
      deadline,
      bucket: bucketByDeadline(deadline),
      url: isReview ? `/exam/${exam.id}/result` : `/exam/${exam.id}/intro`,
      action: isReview ? "查看结果" : "去通关",
    });
  }
  return out;
}

function buildVideoTodos(videos) {
  return videos
    .filter((item) => item && item.is_required && !item.progress?.is_completed)
    .map((item) => {
      const deadline = item.deadline_at || null;
      const percent = Math.round(item.progress?.progress_percent || 0);
      return {
        id: `video:${item.id}`,
        kind: "video",
        title: item.title || "学习视频",
        subtitle: percent > 0 ? `已观看 ${percent}%` : "尚未开始",
        deadline,
        bucket: bucketByDeadline(deadline),
        url: "/workspace/magic",
        action: percent > 0 ? "继续学习" : "去学习",
      };
    });
}

function buildReadingTodos(readings) {
  // /api/magic-academy/my/reading-contents 返回当日的读书内容；服务端已经按 target / 推送时间过滤好。
  // - completed=true → 已打卡，不属于待办
  // - can_submit=true → 还能补卡，按 makeup_deadline_at 分桶
  // - can_submit=false 且未完成 → 多半是"已超过补卡时间"，归 overdue
  return (readings || [])
    .filter((row) => row && !row.completed)
    .map((row) => {
      const deadline = row.makeup_deadline_at || null;
      const bucket = row.can_submit ? bucketByDeadline(deadline) : "overdue";
      return {
        id: `reading:${row.id}`,
        kind: "reading",
        title: row.title || "今日读书",
        subtitle: row.submit_disabled_reason || (row.can_submit ? "等待你录音打卡" : "暂不可补卡"),
        deadline,
        bucket,
        url: "/magic-academy?tab=audio",
        action: row.can_submit ? "去打卡" : "查看",
      };
    });
}

// ---------- 视图 ----------

function TodoItem({ item, onClick }) {
  const meta = KIND_META[item.kind] || KIND_META.paper;
  return (
    <div
      className="user-todo-item"
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--surface-mute, #f6f7fa)",
        alignItems: "center",
      }}
    >
      <Tag bordered={false} color={meta.color} icon={meta.icon} className="user-todo-item__kind" style={{ marginInlineEnd: 0 }}>
        {meta.label}
      </Tag>
      <div className="user-todo-item__main" style={{ flex: 1, minWidth: 0 }}>
        <div className="user-todo-item__title" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>
          {item.title || "—"}
        </div>
        <Text type="secondary" className="user-todo-item__meta" style={{ fontSize: 12 }}>
          {item.subtitle} · 截止 {formatDeadline(item.deadline)}
        </Text>
      </div>
      <Button type="primary" ghost size="small" className="user-todo-item__action" onClick={onClick}>
        {item.action}
      </Button>
    </div>
  );
}

function BucketCard({ bucketKey, items, onItemClick }) {
  const meta = BUCKET_META[bucketKey];
  const tagColor = {
    danger: "error",
    warning: "warning",
    primary: "processing",
    default: "default",
  }[meta.tone];
  return (
    <Card
      className="user-todos__bucket"
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <Space className="user-todos__bucket-title" wrap>
          <span style={{ color: "var(--text-strong)" }}>{meta.icon}</span>
          <strong>{meta.label}</strong>
          <Badge count={items.length} color={meta.tone === "danger" ? "#dc2626" : meta.tone === "warning" ? "#d97706" : "#3b82f6"} showZero />
        </Space>
      }
      extra={<Tag bordered={false} color={tagColor} className="user-todos__bucket-desc">{meta.desc}</Tag>}
    >
      {items.length === 0 ? (
        <Text type="secondary">暂无待办。</Text>
      ) : (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {items.map((item) => (
            <TodoItem key={item.id} item={item} onClick={() => onItemClick(item)} />
          ))}
        </Space>
      )}
    </Card>
  );
}

export default function UserTodosPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [papers, setPapers] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [videos, setVideos] = useState([]);
  const [readings, setReadings] = useState([]);

  const reload = async () => {
    setLoading(true);
    try {
      const [paperData, examData, videoData, readingData] = await Promise.all([
        fetchMyPaperAssignments().catch(() => []),
        fetchMyExams().catch(() => []),
        fetchMyMagicVideos().catch(() => []),
        fetchMyReadingContents().catch(() => []),
      ]);
      setPapers(Array.isArray(paperData) ? paperData : []);
      setChallenges(Array.isArray(examData) ? examData : []);
      setVideos(Array.isArray(videoData) ? videoData : []);
      setReadings(Array.isArray(readingData) ? readingData : []);
    } catch (err) {
      message.error(err?.message || "待办加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const grouped = useMemo(() => {
    const all = [
      ...buildPaperTodos(papers),
      ...buildExamTodos(challenges),
      ...buildVideoTodos(videos),
      ...buildReadingTodos(readings),
    ];
    const map = { overdue: [], today: [], week: [], later: [] };
    for (const item of all) {
      (map[item.bucket] || map.later).push(item);
    }
    // 桶内按 deadline 升序，无 deadline 的排到最后
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (a.deadline && b.deadline) return dayjs(a.deadline).valueOf() - dayjs(b.deadline).valueOf();
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return 0;
      });
    }
    return map;
  }, [papers, challenges, videos, readings]);

  const total = grouped.overdue.length + grouped.today.length + grouped.week.length + grouped.later.length;

  const onItemClick = (item) => {
    if (item?.url) navigate(item.url);
  };

  return (
    <div className="user-todos" style={{ padding: "24px 24px 48px", maxWidth: 960, margin: "0 auto" }}>
      <div className="user-todos__header" style={{ marginBottom: 20 }}>
        <Title level={3} style={{ marginBottom: 4 }}>我的待办</Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          一处汇总你尚未完成的试卷、AI 通关、必看课程与读书打卡。系统按截止时间分为
          <strong>已逾期 / 今日必做 / 本周到期 / 稍后处理</strong> 四档，方便你按优先级处理。
        </Paragraph>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : total === 0 ? (
        <Card>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有任何待办，先去看看吧。" />
        </Card>
      ) : (
        BUCKET_ORDER.map((key) => (
          <BucketCard key={key} bucketKey={key} items={grouped[key]} onItemClick={onItemClick} />
        ))
      )}
    </div>
  );
}
