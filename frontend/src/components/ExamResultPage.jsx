import { Button, Card, Empty, Space, Tabs, Tag, Typography, App as AntdApp } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchMyExamAttempts, fetchMyExams } from "../lib/api.exam";
import ChatHistoryView from "./ChatHistoryView";
import ReviewView from "./ReviewView";

const { Paragraph } = Typography;

function attemptStatusTag(a) {
  if (a.status === "in_progress") return <Tag color="processing">进行中</Tag>;
  if (a.review_pending) return <Tag color="gold">等待管理员复核</Tag>;
  if (a.final_is_pass) return <Tag color="success">合格</Tag>;
  return <Tag color="error">不合格</Tag>;
}

function ScoreLine({ attempt, examAiWeight }) {
  // 复核未完成时只展示 AI 分；复核完成时展示 AI / 老师 / 综合
  if (attempt.review_pending || attempt.final_score == null) {
    return (
      <Space size={[12, 8]} wrap>
        <span>AI 评分 <strong>{Math.round(attempt.score || 0)}</strong></span>
        <Tag color="gold">等待老师复核中…</Tag>
      </Space>
    );
  }
  const aiW = Math.round((examAiWeight ?? 0.5) * 100);
  const adminW = 100 - aiW;
  return (
    <Space size={[12, 8]} wrap>
      <span>AI <strong>{Math.round(attempt.score || 0)}</strong></span>
      <span style={{ color: "var(--text-faint)" }}>×{aiW}%</span>
      <span>老师 <strong>{Math.round(attempt.admin_score || 0)}</strong></span>
      <span style={{ color: "var(--text-faint)" }}>×{adminW}%</span>
      <span>= 综合 <strong style={{ color: "var(--accent-deep)", fontSize: 18 }}>{Math.round(attempt.final_score || 0)}</strong></span>
    </Space>
  );
}

export default function ExamResultPage() {
  const { examId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);

  // 优先用刚 finish 时携带的 result（attempt 信息），但完整数据仍以接口为准
  const justFinished = location.state?.result;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [examsList, attemptsList] = await Promise.all([
          fetchMyExams(),
          fetchMyExamAttempts(examId),
        ]);
        if (!alive) return;
        const item = (examsList || []).find((x) => String(x.exam?.id) === String(examId));
        if (!item) {
          message.error("未找到该考试。");
          navigate("/home", { replace: true });
          return;
        }
        setExam(item.exam);
        setAttempts(attemptsList || []);
      } catch (err) {
        if (alive) message.error(err?.message || "加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [examId, message, navigate]);

  const canRetry = useMemo(() => {
    if (!exam) return false;
    if (exam.status !== "pending") return false;
    return exam.attempt_count < exam.max_attempts;
  }, [exam]);

  const hasPendingReview = useMemo(
    () => (attempts || []).some((a) => a.review_pending),
    [attempts],
  );

  if (loading) return <div className="page-shell"><p>加载中…</p></div>;
  if (!exam) return null;

  const completedAttempts = (attempts || []).filter((a) => a.status === "completed");

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <Button onClick={() => navigate("/home")}>返回首页</Button>
        <h2 style={{ margin: 0 }}>{exam.title || "陪练考试"} · 结果</h2>
        <div>
          {canRetry ? (
            <Button type="primary" onClick={() => navigate(`/exam/${examId}/intro`)}>再考一次</Button>
          ) : null}
        </div>
      </div>

      <Card variant="outlined">
        <Space size={[8, 8]} wrap>
          {exam.status === "pending_review" ? (
            <Tag color="gold">等待管理员复核</Tag>
          ) : exam.status === "passed" ? (
            <Tag color="success">已通过</Tag>
          ) : exam.status === "failed" ? (
            <Tag color="error">未通过</Tag>
          ) : exam.status === "pending" ? (
            <Tag color="warning">还可继续考试</Tag>
          ) : (
            <Tag color="processing">进行中</Tag>
          )}
          <span>已尝试 <strong>{exam.attempt_count}</strong> / {exam.max_attempts}</span>
          <span>及格分 <strong>{exam.pass_score}</strong></span>
          <span>权重 AI {Math.round(exam.ai_weight * 100)}% / 老师 {Math.round((1 - exam.ai_weight) * 100)}%</span>
        </Space>
        {hasPendingReview ? (
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            你的最近一次答题已提交，AI 已给出预评分。最终成绩需要管理员人工复核后确认，复核完成后此页会显示综合分。
          </Paragraph>
        ) : null}
      </Card>

      {justFinished ? (
        <Card variant="outlined" title={`第 ${justFinished.attempt?.attempt_no} 次刚刚提交`}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space size={[8, 8]} wrap>
              <Tag color="gold">已提交，等待老师复核</Tag>
              <span>AI 预评分 <strong>{Math.round(justFinished.attempt?.score || 0)}</strong></span>
              <Tag>{justFinished.attempt?.training_type}</Tag>
              <Tag>{justFinished.attempt?.customer_type}</Tag>
            </Space>
            {justFinished.attempt?.review_json ? (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <ReviewView review={justFinished.attempt.review_json} showHero={false} />
                <ChatHistoryView messages={justFinished.attempt.chat_history} />
              </Space>
            ) : (
              <Empty description="本次复盘数据缺失" />
            )}
          </Space>
        </Card>
      ) : null}

      {completedAttempts.length > 0 ? (
        <Card variant="outlined" title="历次尝试">
          <Tabs
            items={completedAttempts.map((a) => ({
              key: String(a.attempt_no),
              label: `第 ${a.attempt_no} 次`,
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Space size={[12, 8]} wrap>
                    {attemptStatusTag(a)}
                    <ScoreLine attempt={a} examAiWeight={exam.ai_weight} />
                    <Tag>{a.training_type}</Tag>
                    <Tag>{a.customer_type}</Tag>
                    <span style={{ color: "var(--text-faint)" }}>
                      {a.completed_at?.slice(0, 16).replace("T", " ")}
                    </span>
                  </Space>
                  {a.admin_comment ? (
                    <Card type="inner" style={{ background: "#fffaf2" }}>
                      <Paragraph strong style={{ marginBottom: 4 }}>老师评语</Paragraph>
                      <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{a.admin_comment}</Paragraph>
                    </Card>
                  ) : null}
                  {a.review_json ? (
                    <ReviewView review={a.review_json} showHero={false} />
                  ) : null}
                  <ChatHistoryView messages={a.chat_history} />
                </Space>
              ),
            }))}
          />
        </Card>
      ) : (
        !justFinished ? <Empty description="还没有完成的尝试" /> : null
      )}
    </div>
  );
}
