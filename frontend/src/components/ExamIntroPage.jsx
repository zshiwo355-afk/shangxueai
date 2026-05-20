import { CheckCircleOutlined, ClockCircleOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMyExams, startExam } from "../lib/api.exam";
import { saveActiveSession } from "../lib/storage";

const { Paragraph, Text } = Typography;

function settingTag(label, value) {
  return (
    <Tag color={value === "随机" ? "default" : "blue"}>
      {label}：{value}
    </Tag>
  );
}

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
        const item = (list || []).find((entry) => String(entry.exam?.id) === String(examId));
        if (!item) {
          message.error("没有找到这场考试。");
          navigate("/workspace/training", { replace: true });
          return;
        }
        if (alive) {
          setExam(item.exam);
          setAttempts(item.attempts || []);
        }
      } catch (error) {
        if (alive) message.error(error?.message || "考试信息加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
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
    } catch (error) {
      message.error(error?.message || "开始考试失败。");
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
  const pendingReview = exam.status === "pending_review" || attempts.some((item) => item.review_pending);
  const hasInProgress = attempts.some((item) => item.status === "in_progress");

  return (
    <div className="page-shell page-shell--narrow">
      <div className="page-toolbar page-toolbar--stack">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>返回销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>{exam.title || "销售考试"}</h2>
            <Text type="secondary">开始前先确认规则、剩余次数和当前状态，避免在考试中途来回跳转。</Text>
          </div>
        </div>
        <Space wrap>
          <Button onClick={() => navigate("/training/records")}>查看训练记录</Button>
          <Button type="primary" onClick={() => navigate(`/exam/${examId}/result`)}>查看结果页</Button>
        </Space>
      </div>

      <Card className="exam-hero-card" bordered={false}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space size={[8, 8]} wrap>
            {settingTag("训练类型", exam.fixed_training_type || "随机")}
            {settingTag("难度", exam.fixed_difficulty || "随机")}
            {settingTag("客户类型", exam.fixed_customer_type || "随机")}
          </Space>

          <div className="exam-metric-grid">
            <div className="exam-metric-card">
              <span>及格分</span>
              <strong>{exam.pass_score}</strong>
            </div>
            <div className="exam-metric-card">
              <span>剩余次数</span>
              <strong>{remaining}</strong>
            </div>
            <div className="exam-metric-card">
              <span>AI 评分权重</span>
              <strong>{`${Math.round(exam.ai_weight * 100)}%`}</strong>
            </div>
          </div>

          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            提交考试后系统会先生成 AI 预评分，再进入人工复核。建议把每一轮对话都当成正式实战完成。
          </Paragraph>
        </Space>
      </Card>

      <Card title="考试规则" variant="outlined">
        <ul className="exam-rule-list">
          <li>最多可参加 <strong>{exam.max_attempts}</strong> 次，当前已经使用 <strong>{exam.attempt_count}</strong> 次。</li>
          <li>未通过且仍有剩余次数时，可以再次进入考试。</li>
          <li>提交后需等待复核完成，才能看到最终结论。</li>
        </ul>
      </Card>

      {finished ? (
        <Card className="exam-state-card" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space><CheckCircleOutlined /><Text>{exam.status === "passed" ? "这场考试已经通过。" : "这场考试暂未通过，可以回看结果详情。"}</Text></Space>
            <Button type="primary" onClick={() => navigate(`/exam/${examId}/result`)}>查看考试结果</Button>
          </Space>
        </Card>
      ) : pendingReview ? (
        <Card className="exam-state-card exam-state-card--warning" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space><ClockCircleOutlined /><Text>最近一次提交正在等待复核，暂时不能开启新一轮考试。</Text></Space>
            <Button onClick={() => navigate(`/exam/${examId}/result`)}>查看当前结果</Button>
          </Space>
        </Card>
      ) : hasInProgress ? (
        <Card className="exam-state-card" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space><PlayCircleOutlined /><Text>检测到你有一场未完成的考试，可以直接继续作答。</Text></Space>
            <Button type="primary" onClick={handleStart} loading={starting}>继续考试</Button>
          </Space>
        </Card>
      ) : remaining <= 0 ? (
        <Card bordered={false}>
          <Empty description="这场考试已经没有剩余作答次数" />
        </Card>
      ) : (
        <Card className="exam-state-card" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text>当前可以开始第 <strong>{exam.attempt_count + 1}</strong> 次考试。</Text>
            <Button type="primary" size="large" loading={starting} onClick={handleStart}>
              {starting ? "AI 正在准备考试场景…" : `开始第 ${exam.attempt_count + 1} 次考试`}
            </Button>
          </Space>
        </Card>
      )}
    </div>
  );
}
