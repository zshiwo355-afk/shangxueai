import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMyExams, startExam } from "../lib/api.exam";
import { saveActiveSession } from "../lib/storage";

const { Paragraph, Text } = Typography;

function settingTag(label, value) {
  return <Tag bordered={false}>{`${label}：${value}`}</Tag>;
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
        if (alive) message.error(error?.message || "加载失败。");
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
      message.error(error?.message || "开始失败。");
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="page-shell"><p>加载中...</p></div>;
  if (!exam) return null;

  const remaining = Math.max(exam.max_attempts - exam.attempt_count, 0);
  const finished = exam.status === "passed" || exam.status === "failed";
  const pendingReview = exam.status === "pending_review" || attempts.some((item) => item.review_pending);
  const hasInProgress = attempts.some((item) => item.status === "in_progress");

  return (
    <div className="page-shell page-shell--narrow page-shell--minimal">
      <div className="page-toolbar page-toolbar--stack page-toolbar--minimal">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>{exam.title || "销售考试"}</h2>
            <Text type="secondary">开始前先确认状态。</Text>
          </div>
        </div>
        <Space wrap>
          <Button onClick={() => navigate("/training/records")}>训练记录</Button>
          <Button type="primary" onClick={() => navigate(`/exam/${examId}/result`)}>
            结果
          </Button>
        </Space>
      </div>

      <Card className="exam-hero-card exam-hero-card--minimal" bordered={false}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space size={[8, 8]} wrap>
            {settingTag("训练", exam.fixed_training_type || "随机")}
            {settingTag("难度", exam.fixed_difficulty || "随机")}
            {settingTag("客户", exam.fixed_customer_type || "随机")}
          </Space>

          <div className="exam-metric-grid">
            <div className="exam-metric-card">
              <span>及格分</span>
              <strong style={{ color: "#16a34a" }}>{exam.pass_score}</strong>
            </div>
            <div className="exam-metric-card">
              <span>剩余次数</span>
              <strong style={{ color: remaining > 0 ? "var(--accent-deep, #426f9f)" : "#dc2626" }}>{remaining}</strong>
            </div>
            <div className="exam-metric-card">
              <span>AI 权重</span>
              <strong>{`${Math.round(exam.ai_weight * 100)}%`}</strong>
            </div>
          </div>

          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            可按实际进展提交。
          </Paragraph>
        </Space>
      </Card>

      <Card className="exam-rule-card exam-rule-card--minimal" variant="outlined">
        <ul className="exam-rule-list exam-rule-list--minimal">
          <li>最多 {exam.max_attempts} 次</li>
          <li>提交后先看 AI 预评</li>
          <li>最终结果以复核为准</li>
        </ul>
      </Card>

      {finished ? (
        <Card className="exam-state-card exam-state-card--minimal" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space>
              <CheckCircleOutlined />
              <Text>{exam.status === "passed" ? "这场考试已通过。" : "这场考试未通过。"}</Text>
            </Space>
            <Button type="primary" onClick={() => navigate(`/exam/${examId}/result`)}>
              查看结果
            </Button>
          </Space>
        </Card>
      ) : pendingReview ? (
        <Card className="exam-state-card exam-state-card--warning exam-state-card--minimal" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space>
              <ClockCircleOutlined />
              <Text>最近一次提交正在复核中。</Text>
            </Space>
            <Button onClick={() => navigate(`/exam/${examId}/result`)}>查看结果</Button>
          </Space>
        </Card>
      ) : hasInProgress ? (
        <Card className="exam-state-card exam-state-card--minimal" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space>
              <PlayCircleOutlined />
              <Text>检测到未完成考试。</Text>
            </Space>
            <Button type="primary" onClick={handleStart} loading={starting}>
              继续考试
            </Button>
          </Space>
        </Card>
      ) : remaining <= 0 ? (
        <Card bordered={false}>
          <Empty description="这场考试已经没有剩余次数。" />
        </Card>
      ) : (
        <Card className="exam-state-card exam-state-card--minimal" bordered={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text>
              当前可开始第 <strong>{exam.attempt_count + 1}</strong> 次考试。
            </Text>
            <Button type="primary" size="large" loading={starting} onClick={handleStart}>
              {starting ? "准备中..." : `开始第 ${exam.attempt_count + 1} 次考试`}
            </Button>
          </Space>
        </Card>
      )}
    </div>
  );
}
