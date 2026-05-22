import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  FormOutlined,
  HistoryOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Pagination, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyPaperAssignments } from "../../../lib/api.userPapers";

const { Paragraph, Text } = Typography;

const PAGE_SIZE = 6;

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

function sectionTitle(label, count) {
  return (
    <div className="paper-section__head">
      <div>
        <h3>{label}</h3>
        <Text type="secondary">共 {count} 项</Text>
      </div>
    </div>
  );
}

export default function UserPapersListPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [todoPage, setTodoPage] = useState(1);
  const [donePage, setDonePage] = useState(1);

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

  const grouped = useMemo(() => {
    const todo = [];
    const done = [];
    for (const item of items) {
      if (item.last_status === "graded" || (item.is_expired && attemptsLeft(item) <= 0)) {
        done.push(item);
      } else {
        todo.push(item);
      }
    }
    todo.sort((a, b) => tsOf(b) - tsOf(a));
    done.sort((a, b) => tsOf(b) - tsOf(a));
    return { todo, done };
  }, [items]);

  useEffect(() => {
    const todoMaxPage = Math.max(1, Math.ceil(grouped.todo.length / PAGE_SIZE));
    const doneMaxPage = Math.max(1, Math.ceil(grouped.done.length / PAGE_SIZE));
    if (todoPage > todoMaxPage) setTodoPage(todoMaxPage);
    if (donePage > doneMaxPage) setDonePage(doneMaxPage);
  }, [donePage, grouped.done.length, grouped.todo.length, todoPage]);

  const summary = useMemo(() => {
    const availableCount = grouped.todo.filter(canTake).length;
    const retryCount = grouped.todo.filter((item) => Number(item.attempt_count || 0) > 0 && canTake(item)).length;
    return {
      total: items.length,
      todo: grouped.todo.length,
      done: grouped.done.length,
      available: availableCount,
      retry: retryCount,
    };
  }, [grouped.done, grouped.todo, items.length]);

  const todoSlice = grouped.todo.slice((todoPage - 1) * PAGE_SIZE, todoPage * PAGE_SIZE);
  const doneSlice = grouped.done.slice((donePage - 1) * PAGE_SIZE, donePage * PAGE_SIZE);

  const renderCard = (item) => {
    const left = attemptsLeft(item);
    const takeable = canTake(item);
    const deadlineText = item.deadline_at ? `截止时间 ${formatTime(item.deadline_at)}` : "无截止时间";

    return (
      <Card key={item.id} className="paper-assignment-card" bordered={false}>
        <div className="paper-assignment-card__head">
          <div className="paper-assignment-card__title">
            <div className="paper-assignment-card__icon">
              <FormOutlined />
            </div>
            <div>
              <Space size={[8, 8]} wrap>
                <h4>{item.paper_title}</h4>
                {statusTag(item)}
              </Space>
              <Text type="secondary">{deadlineText}</Text>
            </div>
          </div>

          {item.last_submission_id ? (
            <Button
              icon={<HistoryOutlined />}
              onClick={() => navigate(`/papers/submissions/${item.last_submission_id}`)}
            >
              查看上次结果
            </Button>
          ) : null}
        </div>

        {item.paper_description ? (
          <Paragraph className="paper-assignment-card__desc">
            {item.paper_description}
          </Paragraph>
        ) : null}

        <div className="paper-assignment-card__metrics">
          <div className="paper-assignment-card__metric">
            <span>题目数量</span>
            <strong>{item.question_count || 0}</strong>
          </div>
          <div className="paper-assignment-card__metric">
            <span>总分 / 及格</span>
            <strong>{`${item.total_score || 0} / ${item.pass_score || 0}`}</strong>
          </div>
          <div className="paper-assignment-card__metric">
            <span>剩余次数</span>
            <strong>{`${left} / ${item.max_attempts || 1}`}</strong>
          </div>
          <div className="paper-assignment-card__metric">
            <span>答题时长</span>
            <strong>{item.duration_minutes > 0 ? `${item.duration_minutes} 分钟` : "不限时"}</strong>
          </div>
        </div>

        <div className="paper-assignment-card__meta">
          <Tag bordered={false} color="blue">
            <ClockCircleOutlined />
            {item.duration_minutes > 0 ? `限时 ${item.duration_minutes} 分钟` : "不限时"}
          </Tag>
          <Tag bordered={false}>剩余次数 {left}</Tag>
          {item.last_final_score != null ? (
            <Tag bordered={false} icon={<TrophyOutlined />} color={item.last_is_pass ? "success" : "error"}>
              最近成绩 {Math.round(item.last_final_score)}
            </Tag>
          ) : null}
        </div>

        <div className="paper-assignment-card__foot">
          <Text type="secondary">
            {takeable
              ? item.attempt_count > 0
                ? "你可以继续补考或重做本试卷。"
                : "试卷已就绪，建议尽快完成。"
              : item.is_expired
                ? "当前试卷已过截止时间。"
                : "当前试卷的作答次数已用完。"}
          </Text>

          {takeable ? (
            <Button
              type="primary"
              icon={<ArrowRightOutlined />}
              onClick={() => navigate(`/papers/${item.id}/take`)}
            >
              {item.attempt_count > 0 ? "再次答题" : "开始答题"}
            </Button>
          ) : (
            <Button disabled>
              {item.is_expired ? "已截止" : "次数已用完"}
            </Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="page-shell page-shell--wide page-shell--minimal">
      <div className="page-toolbar page-toolbar--stack page-toolbar--minimal">
        <div className="page-toolbar__leading">
          <div>
            <h2 style={{ margin: 0 }}>我的考试</h2>
            <Text type="secondary">统一查看管理员派发给你的试卷任务、历史成绩和作答入口。</Text>
          </div>
        </div>
      </div>

      <Card className="paper-page-hero" bordered={false}>
        <div className="paper-page-hero__grid">
          <div className="paper-page-hero__copy">
            <span className="paper-page-hero__eyebrow">考试中心</span>
            <h3>把待完成任务、历史成绩和补考机会放在同一页里。</h3>
            <Paragraph>
              列表会自动按待完成和已结束分区展示。你可以直接进入答题，也可以回看最近一次提交结果。
            </Paragraph>
          </div>

          <div className="paper-page-hero__stats">
            <div className="paper-page-hero__stat">
              <span>全部任务</span>
              <strong>{summary.total}</strong>
            </div>
            <div className="paper-page-hero__stat">
              <span>待处理</span>
              <strong>{summary.todo}</strong>
            </div>
            <div className="paper-page-hero__stat">
              <span>可立即答题</span>
              <strong>{summary.available}</strong>
            </div>
            <div className="paper-page-hero__stat">
              <span>可重做</span>
              <strong>{summary.retry}</strong>
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card className="paper-assignment-card" loading bordered={false} />
      ) : items.length === 0 ? (
        <Card className="paper-empty-card" bordered={false}>
          <Empty description="暂时没有考试任务" />
        </Card>
      ) : (
        <div className="paper-section-stack">
          {grouped.todo.length > 0 ? (
            <section className="paper-section">
              {sectionTitle("待完成", grouped.todo.length)}
              <div className="paper-card-stack">
                {todoSlice.map(renderCard)}
              </div>
              {grouped.todo.length > PAGE_SIZE ? (
                <div className="paper-section__pager">
                  <Pagination
                    current={todoPage}
                    pageSize={PAGE_SIZE}
                    total={grouped.todo.length}
                    onChange={setTodoPage}
                    showSizeChanger={false}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {grouped.done.length > 0 ? (
            <section className="paper-section">
              {sectionTitle("已结束", grouped.done.length)}
              <div className="paper-card-stack">
                {doneSlice.map(renderCard)}
              </div>
              {grouped.done.length > PAGE_SIZE ? (
                <div className="paper-section__pager">
                  <Pagination
                    current={donePage}
                    pageSize={PAGE_SIZE}
                    total={grouped.done.length}
                    onChange={setDonePage}
                    showSizeChanger={false}
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
