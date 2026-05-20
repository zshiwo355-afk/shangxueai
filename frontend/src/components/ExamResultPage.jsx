import { App as AntdApp, Button, Card, Empty, Space, Tabs, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchMyExamAttempts, fetchMyExams } from "../lib/api.exam";
import ChatHistoryView from "./ChatHistoryView";
import ReviewView from "./ReviewView";

const { Paragraph, Text } = Typography;

function attemptStatusTag(attempt) {
  if (attempt.status === "in_progress") return <Tag color="processing">进行中</Tag>;
  if (attempt.review_pending) return <Tag color="gold">等待复核</Tag>;
  if (attempt.final_is_pass) return <Tag color="success">合格</Tag>;
  return <Tag color="error">待提升</Tag>;
}

function scoreLine(attempt, examAiWeight) {
  if (attempt.review_pending || attempt.final_score == null) {
    return (
      <Space size={[12, 8]} wrap>
        <span>AI 评分 <strong>{Math.round(attempt.score || 0)}</strong></span>
        <Tag color="gold">等待老师复核中</Tag>
      </Space>
    );
  }

  const aiWeight = Math.round((examAiWeight ?? 0.5) * 100);
  const adminWeight = 100 - aiWeight;
  return (
    <Space size={[12, 8]} wrap>
      <span>AI <strong>{Math.round(attempt.score || 0)}</strong></span>
      <span style={{ color: "var(--text-faint)" }}>×{aiWeight}%</span>
      <span>老师 <strong>{Math.round(attempt.admin_score || 0)}</strong></span>
      <span style={{ color: "var(--text-faint)" }}>×{adminWeight}%</span>
      <span>综合 <strong style={{ color: "var(--accent-deep)", fontSize: 18 }}>{Math.round(attempt.final_score || 0)}</strong></span>
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
        const item = (examsList || []).find((entry) => String(entry.exam?.id) === String(examId));
        if (!item) {
          message.error("没有找到这场考试。");
          navigate("/workspace/training", { replace: true });
          return;
        }
        setExam(item.exam);
        setAttempts(attemptsList || []);
      } catch (error) {
        if (alive) message.error(error?.message || "考试结果加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [examId, message, navigate]);

  const canRetry = useMemo(() => {
    if (!exam) return false;
    return exam.status === "pending" && exam.attempt_count < exam.max_attempts;
  }, [exam]);

  const hasPendingReview = useMemo(
    () => attempts.some((attempt) => attempt.review_pending),
    [attempts],
  );

  if (loading) return <div className="page-shell"><p>加载中…</p></div>;
  if (!exam) return null;

  const completedAttempts = attempts.filter((attempt) => attempt.status === "completed");

  return (
    <div className="page-shell page-shell--wide">
      <div className="page-toolbar page-toolbar--stack">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>返回销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>{exam.title || "销售考试"} · 结果页</h2>
            <Text type="secondary">先看当前结论，再逐次回看完整尝试，避免在结果页和工作台之间来回跳。</Text>
          </div>
        </div>
        <Space wrap>
          <Button onClick={() => navigate(`/exam/${examId}/intro`)}>回到考试说明</Button>
          {canRetry ? <Button type="primary" onClick={() => navigate(`/exam/${examId}/intro`)}>再考一次</Button> : null}
        </Space>
      </div>

      <Card className="exam-hero-card" bordered={false}>
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Space size={[8, 8]} wrap>
            {exam.status === "pending_review" ? <Tag color="gold">等待复核</Tag> : null}
            {exam.status === "passed" ? <Tag color="success">已通过</Tag> : null}
            {exam.status === "failed" ? <Tag color="error">未通过</Tag> : null}
            {exam.status === "pending" ? <Tag color="warning">仍可继续考试</Tag> : null}
          </Space>

          <div className="exam-metric-grid">
            <div className="exam-metric-card">
              <span>尝试次数</span>
              <strong>{exam.attempt_count}/{exam.max_attempts}</strong>
            </div>
            <div className="exam-metric-card">
              <span>及格分</span>
              <strong>{exam.pass_score}</strong>
            </div>
            <div className="exam-metric-card">
              <span>AI 权重</span>
              <strong>{`${Math.round(exam.ai_weight * 100)}%`}</strong>
            </div>
          </div>

          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {hasPendingReview
              ? "最近一次提交已进入复核流程，当前看到的是 AI 预评和历史结果。"
              : "你可以在这里回看每一次作答的完整复盘，再决定要不要继续补考。"}
          </Paragraph>
        </Space>
      </Card>

      {justFinished ? (
        <Card title={`第 ${justFinished.attempt?.attempt_no} 次刚提交`} variant="outlined">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space size={[8, 8]} wrap>
              <Tag color="gold">已提交，等待复核</Tag>
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
              <Empty description="这次提交暂时没有生成复盘数据" />
            )}
          </Space>
        </Card>
      ) : null}

      {completedAttempts.length > 0 ? (
        <Card variant="outlined" title="历史尝试">
          <Tabs
            items={completedAttempts.map((attempt) => ({
              key: String(attempt.attempt_no),
              label: `第 ${attempt.attempt_no} 次`,
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Space size={[12, 8]} wrap>
                    {attemptStatusTag(attempt)}
                    {scoreLine(attempt, exam.ai_weight)}
                    <Tag>{attempt.training_type}</Tag>
                    <Tag>{attempt.customer_type}</Tag>
                    <span style={{ color: "var(--text-faint)" }}>
                      {attempt.completed_at?.slice(0, 16).replace("T", " ")}
                    </span>
                  </Space>

                  {attempt.admin_comment ? (
                    <Card type="inner" className="exam-comment-card">
                      <Paragraph strong style={{ marginBottom: 4 }}>老师评语</Paragraph>
                      <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{attempt.admin_comment}</Paragraph>
                    </Card>
                  ) : null}

                  {attempt.review_json ? <ReviewView review={attempt.review_json} showHero={false} /> : null}
                  <ChatHistoryView messages={attempt.chat_history} />
                </Space>
              ),
            }))}
          />
        </Card>
      ) : (
        !justFinished ? <Empty description="还没有完成的考试尝试" /> : null
      )}

      <div className="journey-actions">
        <Button onClick={() => navigate(`/exam/${examId}/intro`)}>回到考试说明</Button>
        <Button onClick={() => navigate("/workspace/training")}>回到销售对练</Button>
        {canRetry ? <Button type="primary" onClick={() => navigate(`/exam/${examId}/intro`)}>继续下一次考试</Button> : null}
      </div>
    </div>
  );
}
