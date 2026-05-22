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

const { Title, Paragraph, Text } = Typography;

const PAGE_SIZE = 6;

function formatTime(value) {
  if (!value) return "";
  return String(value).slice(0, 16).replace("T", " ");
}

function tsOf(item) {
  // 排序键：优先按最近提交时间，没有就按截止时间，再没有就按 id（新建越新 id 越大）
  if (item.last_submitted_at) return new Date(item.last_submitted_at).getTime();
  if (item.deadline_at) return new Date(item.deadline_at).getTime();
  return Number(item.id || 0);
}

function statusTag(item) {
  if (item.is_expired && item.last_status !== "graded") return <Tag color="default">已截止</Tag>;
  if (item.last_status === "graded") {
    return item.last_is_pass
      ? <Tag color="success">已通过</Tag>
      : <Tag color="error">未通过</Tag>;
  }
  if (item.last_status === "submitted") return <Tag color="processing">待复核</Tag>;
  if (item.last_status === "in_progress") return <Tag color="warning">进行中</Tag>;
  return <Tag>未开始</Tag>;
}

function attemptsLeft(item) {
  return Math.max(0, Number(item.max_attempts || 1) - Number(item.attempt_count || 0));
}

function canTake(item) {
  if (item.is_expired) return false;
  if (attemptsLeft(item) <= 0) return false;
  return true;
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
        if (alive) message.error(err?.message || "加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [message]);

  const grouped = useMemo(() => {
    const todo = [];
    const done = [];
    for (const it of items) {
      if (it.last_status === "graded" || (it.is_expired && attemptsLeft(it) <= 0)) {
        done.push(it);
      } else {
        todo.push(it);
      }
    }
    // 排序：最新的在前
    todo.sort((a, b) => tsOf(b) - tsOf(a));
    done.sort((a, b) => tsOf(b) - tsOf(a));
    return { todo, done };
  }, [items]);

  const todoSlice = grouped.todo.slice((todoPage - 1) * PAGE_SIZE, todoPage * PAGE_SIZE);
  const doneSlice = grouped.done.slice((donePage - 1) * PAGE_SIZE, donePage * PAGE_SIZE);

  const renderCard = (item) => {
    const left = attemptsLeft(item);
    const takeable = canTake(item);
    return (
      <Card
        key={item.id}
        style={{ marginBottom: 16 }}
        hoverable
        title={
          <Space size={12}>
            <FormOutlined />
            <span>{item.paper_title}</span>
            {statusTag(item)}
          </Space>
        }
        extra={
          item.last_submission_id ? (
            <Button
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => navigate(`/papers/submissions/${item.last_submission_id}`)}
            >
              查看上次结果
            </Button>
          ) : null
        }
      >
        {item.paper_description ? (
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {item.paper_description}
          </Paragraph>
        ) : null}

        <Space wrap size={12} style={{ marginBottom: 12 }}>
          <Tag color="blue">题数 {item.question_count}</Tag>
          <Tag color="geekblue">总分 {item.total_score}</Tag>
          <Tag>及格 {item.pass_score}</Tag>
          {item.duration_minutes > 0 ? (
            <Tag icon={<ClockCircleOutlined />}>限时 {item.duration_minutes} 分钟</Tag>
          ) : <Tag>不限时</Tag>}
          <Tag>剩余次数 {left} / {item.max_attempts}</Tag>
          {item.last_final_score != null ? (
            <Tag icon={<TrophyOutlined />} color={item.last_is_pass ? "success" : "error"}>
              最近成绩 {Math.round(item.last_final_score)}
            </Tag>
          ) : null}
        </Space>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Text type="secondary">
            {item.deadline_at ? `截止：${formatTime(item.deadline_at)}` : "无截止时间"}
          </Text>
          <Space>
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
          </Space>
        </div>
      </Card>
    );
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 16px" }}>
      <Title level={3} style={{ marginBottom: 4 }}>我的考试</Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        管理员派发给你的试卷会在这里出现，请在截止时间前完成。
      </Paragraph>

      {loading ? (
        <Card loading />
      ) : items.length === 0 ? (
        <Empty description="暂无考试任务" />
      ) : (
        <>
          {grouped.todo.length > 0 ? (
            <>
              <Title level={5} style={{ marginTop: 8 }}>
                待完成 / 进行中
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
                  共 {grouped.todo.length} 项
                </Text>
              </Title>
              {todoSlice.map(renderCard)}
              {grouped.todo.length > PAGE_SIZE ? (
                <div style={{ textAlign: "center", margin: "12px 0 24px" }}>
                  <Pagination
                    current={todoPage}
                    pageSize={PAGE_SIZE}
                    total={grouped.todo.length}
                    onChange={setTodoPage}
                    showSizeChanger={false}
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {grouped.done.length > 0 ? (
            <>
              <Title level={5} style={{ marginTop: 24 }}>
                已结束
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
                  共 {grouped.done.length} 项
                </Text>
              </Title>
              {doneSlice.map(renderCard)}
              {grouped.done.length > PAGE_SIZE ? (
                <div style={{ textAlign: "center", margin: "12px 0 0" }}>
                  <Pagination
                    current={donePage}
                    pageSize={PAGE_SIZE}
                    total={grouped.done.length}
                    onChange={setDonePage}
                    showSizeChanger={false}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
