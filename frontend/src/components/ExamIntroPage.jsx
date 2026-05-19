import { Button, Card, Space, Tag, Typography, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMyExams, startExam } from "../lib/api.exam";
import { saveActiveSession } from "../lib/storage";

const { Title, Paragraph, Text } = Typography;

export default function ExamIntroPage() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchMyExams();
        const item = (list || []).find((x) => String(x.exam?.id) === String(examId));
        if (!item) {
          message.error("未找到该考试。");
          navigate("/home", { replace: true });
          return;
        }
        if (alive) {
          setExam(item.exam);
          setAttempts(item.attempts || []);
        }
      } catch (err) {
        if (alive) message.error(err?.message || "加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [examId, message, navigate]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const data = await startExam(examId);
      saveActiveSession({
        session_id: data.session_id,
        exam_id: Number(examId),
        mode: "exam",
        attempt_no: data.attempt_no,
        visible_brief: data.visible_brief,
        first_customer_message: data.first_customer_message,
        state: data.state,
        training_type: data.training_type,
        difficulty: data.difficulty,
        customer_type: data.customer_type,
        chat_history: [{ role: "customer", content: data.first_customer_message }],
      });
      navigate(`/chat/${data.session_id}`);
    } catch (err) {
      message.error(err?.message || "开始考试失败。");
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return <div className="page-shell"><p>加载中…</p></div>;
  }
  if (!exam) return null;

  const remaining = Math.max(exam.max_attempts - exam.attempt_count, 0);
  const finished = exam.status === "passed" || exam.status === "failed";
  const pendingReview = exam.status === "pending_review" || (attempts || []).some((a) => a.review_pending);
  const hasInProgress = (attempts || []).some((a) => a.status === "in_progress");

  const fixedDescriptions = [
    `训练类型：${exam.fixed_training_type || "随机"}`,
    `难度：${exam.fixed_difficulty || "随机"}`,
    `客户类型：${exam.fixed_customer_type || "随机"}`,
  ];

  return (
    <div className="page-shell" style={{ maxWidth: 720 }}>
      <div className="page-toolbar">
        <Button onClick={() => navigate("/home")}>返回</Button>
        <h2 style={{ margin: 0 }}>{exam.title || "陪练考试"}</h2>
        <Space />
      </div>

      <Card variant="borderless" style={{ background: "#fff", padding: 8 }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>考试说明</Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              本次考试由管理员派发。提交答题后由 AI 给出预评分，再由管理员人工复核打分，
              最终综合分用于判定通过与否。
            </Paragraph>
          </div>

          <div>
            <Title level={5}>题目设置</Title>
            <Space size={[6, 6]} wrap>
              {fixedDescriptions.map((d, i) => (
                <Tag key={i} color={d.endsWith("随机") ? "default" : "blue"}>{d}</Tag>
              ))}
            </Space>
          </div>

          <div>
            <Title level={5}>规则</Title>
            <ul style={{ paddingLeft: 18, lineHeight: 1.85, color: "var(--text-base)" }}>
              <li>及格分：<strong>{exam.pass_score} 分</strong></li>
              <li>权重：<strong>AI {Math.round(exam.ai_weight * 100)}% / 老师 {Math.round((1 - exam.ai_weight) * 100)}%</strong></li>
              <li>最多尝试：<strong>{exam.max_attempts} 次</strong>，若上次未通过且仍有次数可重考</li>
              <li>当前已尝试：<strong>{exam.attempt_count} / {exam.max_attempts}</strong>，剩余 <strong>{remaining}</strong> 次</li>
              <li>提交后必须等管理员复核完成，才能开始下一次</li>
            </ul>
          </div>

          {finished ? (
            <Card type="inner" style={{ background: "#fafafa" }}>
              <Text>
                考试已 {exam.status === "passed" ? "通过 ✓" : "未通过 ✗"}，可点击下方按钮查看复盘。
              </Text>
              <div style={{ marginTop: 12 }}>
                <Button type="primary" onClick={() => navigate(`/exam/${examId}/result`)}>查看复盘</Button>
              </div>
            </Card>
          ) : pendingReview ? (
            <Card type="inner" style={{ background: "#fffaf2" }}>
              <Text>
                上一次答题已提交，正在等待管理员复核。复核完成后此页会更新「再考一次」按钮（如还有次数）或最终通过结论。
              </Text>
              <div style={{ marginTop: 12 }}>
                <Button onClick={() => navigate(`/exam/${examId}/result`)}>查看 AI 预评分</Button>
              </div>
            </Card>
          ) : hasInProgress ? (
            <Card type="inner" style={{ background: "#f0f8ff" }}>
              <Text>检测到你有进行中的答题，点击下方按钮可继续。</Text>
              <div style={{ marginTop: 12 }}>
                <Button type="primary" onClick={handleStart} loading={starting}>继续答题</Button>
              </div>
            </Card>
          ) : remaining <= 0 ? (
            <Card type="inner" style={{ background: "#fafafa" }}>
              <Text type="danger">已用完所有考试机会。</Text>
            </Card>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
              <Button type="primary" size="large" loading={starting} onClick={handleStart} style={{ minWidth: 220 }}>
                {starting ? "AI 正在准备题目…" : `开始第 ${exam.attempt_count + 1} 次考试`}
              </Button>
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
}
