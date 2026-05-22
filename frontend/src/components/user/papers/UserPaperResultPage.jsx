import { ArrowLeftOutlined, CheckCircleTwoTone, CloseCircleTwoTone, MinusCircleTwoTone } from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Result,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMySubmissionResult } from "../../../lib/api.userPapers";

const { Paragraph, Title, Text } = Typography;

const TYPE_COLOR = {
  single: "blue",
  multiple: "purple",
  judge: "cyan",
  blank: "gold",
  short_answer: "orange",
};

function letterFor(idx) {
  return String.fromCharCode("A".charCodeAt(0) + idx);
}

function fmtScore(v) {
  if (v == null) return "-";
  return Math.round(v * 10) / 10;
}

function correctnessIcon(ans) {
  if (ans.is_objective) {
    if (ans.is_correct === true) return <CheckCircleTwoTone twoToneColor="#52c41a" />;
    if (ans.is_correct === false) return <CloseCircleTwoTone twoToneColor="#cf1322" />;
  }
  return <MinusCircleTwoTone twoToneColor="#faad14" />;
}

export default function UserPaperResultPage() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetchMySubmissionResult(submissionId);
        if (alive) setData(res);
      } catch (err) {
        if (alive) message.error(err?.message || "加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [submissionId, message]);

  if (loading) return <Card loading style={{ maxWidth: 880, margin: "24px auto" }} />;
  if (!data) return <Empty description="未找到答卷" style={{ marginTop: 80 }} />;

  const { submission: s, paper, answers, show_answer: showAnswer } = data;
  const isPending = s.status === "submitted";
  const isGraded = s.status === "graded";

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "16px" }}>
      <Button
        size="small"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate("/papers")}
        style={{ marginBottom: 12 }}
      >
        返回考试列表
      </Button>

      <Card style={{ marginBottom: 16 }}>
        <Title level={4} style={{ marginTop: 0 }}>{paper.title}</Title>
        <Space wrap size={24} style={{ marginTop: 8 }}>
          <Statistic
            title="本次成绩"
            value={isGraded ? fmtScore(s.final_score) : "—"}
            suffix={isGraded ? `/ ${paper.total_score}` : ""}
            valueStyle={{ color: isGraded ? (s.is_pass ? "#3f8600" : "#cf1322") : undefined }}
          />
          <Statistic title="客观题得分" value={fmtScore(s.auto_score)} />
          {isGraded ? (
            <Statistic
              title="结果"
              valueRender={() => (s.is_pass
                ? <Tag color="success" style={{ fontSize: 14 }}>合格 ✓</Tag>
                : <Tag color="error" style={{ fontSize: 14 }}>不合格 ✗</Tag>)}
              value=" "
            />
          ) : null}
          <Statistic title="第几次" value={`第 ${s.attempt_no} 次`} />
          <Statistic title="提交时间" valueStyle={{ fontSize: 14 }} value={String(s.submitted_at || "").slice(0, 16).replace("T", " ")} />
        </Space>
      </Card>

      {isPending ? (
        <Alert
          type="warning"
          showIcon
          message="待人工复核"
          description="本卷含简答题，需老师复核完成后才会出最终成绩。"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {isGraded && s.comment ? (
        <Alert
          type="info"
          showIcon
          message="老师评语"
          description={<Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{s.comment}</Paragraph>}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!showAnswer && paper.show_answer_after === "after_graded" && !isGraded ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="复核完成后才会展示正确答案。"
        />
      ) : null}

      {(answers || []).map((ans, idx) => (
        <Card
          key={ans.id}
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <span>第 {idx + 1} 题</span>
              <Tag bordered={false} color={TYPE_COLOR[ans.question_type] || "default"}>
                {ans.question_type_label}
              </Tag>
              {correctnessIcon(ans)}
              <Tag>得分 {fmtScore(ans.final_score ?? ans.auto_score)} / {ans.score}</Tag>
            </Space>
          }
        >
          <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{ans.stem}</Paragraph>

          {ans.options && ans.options.length ? (
            <div style={{ marginBottom: 12 }}>
              {ans.options.map((opt, i) => {
                const letter = letterFor(i);
                const userPicked = ans.user_answer.includes(letter);
                const isCorrect = showAnswer && ans.correct_answer.includes(letter);
                let bg = "transparent";
                let border = "1px solid var(--line-soft, #eee)";
                if (isCorrect) {
                  bg = "rgba(82,196,26,.12)";
                  border = "1px solid #52c41a";
                } else if (userPicked && showAnswer && !isCorrect) {
                  bg = "rgba(207,19,34,.08)";
                  border = "1px solid #cf1322";
                } else if (userPicked) {
                  bg = "rgba(22,119,255,.08)";
                  border = "1px solid #1677ff";
                }
                return (
                  <div
                    key={i}
                    style={{
                      padding: "8px 12px",
                      marginBottom: 6,
                      borderRadius: 6,
                      background: bg,
                      border,
                    }}
                  >
                    <Space>
                      <Tag>{letter}</Tag>
                      <span>{opt}</span>
                      {userPicked ? <Tag color="blue" bordered={false}>你的选择</Tag> : null}
                      {isCorrect ? <Tag color="success" bordered={false}>正确</Tag> : null}
                    </Space>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* 非选择题展示用户答案 */}
          {(!ans.options || !ans.options.length) ? (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">你的答案：</Text>
              {ans.user_answer.length ? (
                <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                  {ans.user_answer.join(" | ")}
                </Paragraph>
              ) : <Text type="secondary">（未作答）</Text>}
            </div>
          ) : null}

          {showAnswer && ans.correct_answer.length && (!ans.options || !ans.options.length) ? (
            <div style={{ marginBottom: 12 }}>
              <Text strong type="success">参考答案：</Text>
              <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                {ans.correct_answer.join(" | ")}
              </Paragraph>
            </div>
          ) : null}

          {showAnswer && ans.explanation ? (
            <Alert
              type="info"
              message="解析"
              description={<span style={{ whiteSpace: "pre-wrap" }}>{ans.explanation}</span>}
            />
          ) : null}

          {ans.comment ? (
            <Alert
              type="success"
              style={{ marginTop: 12 }}
              message="老师批注"
              description={<span style={{ whiteSpace: "pre-wrap" }}>{ans.comment}</span>}
            />
          ) : null}
        </Card>
      ))}
    </div>
  );
}
