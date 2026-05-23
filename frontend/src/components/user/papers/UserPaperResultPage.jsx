import {
  ArrowLeftOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  MinusCircleTwoTone,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMySubmissionResult } from "../../../lib/api.userPapers";

const { Paragraph, Text } = Typography;

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

function fmtScore(value) {
  if (value == null) return "-";
  return Math.round(value * 10) / 10;
}

function formatTime(value) {
  if (!value) return "-";
  return String(value).slice(0, 16).replace("T", " ");
}

function correctnessIcon(answer) {
  if (answer.is_objective) {
    if (answer.is_correct === true) return <CheckCircleTwoTone twoToneColor="#52c41a" />;
    if (answer.is_correct === false) return <CloseCircleTwoTone twoToneColor="#cf1322" />;
  }
  return <MinusCircleTwoTone twoToneColor="#faad14" />;
}

function scoreTone(status, isPass) {
  if (status !== "graded") return undefined;
  return isPass ? "#15803d" : "#c2410c";
}

function answerStateText(answer) {
  if (!answer.is_objective) return "主观题 / 人工评分";
  if (answer.is_correct === true) return "本题回答正确";
  if (answer.is_correct === false) return "本题回答错误";
  return "等待判分";
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
        const response = await fetchMySubmissionResult(submissionId);
        if (alive) setData(response);
      } catch (err) {
        if (alive) message.error(err?.message || "答卷加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message, submissionId]);

  const answerSummary = useMemo(() => {
    const answers = data?.answers || [];
    return answers.reduce(
      (acc, answer) => {
        if (answer.is_correct === true) acc.correct += 1;
        if (answer.is_correct === false) acc.incorrect += 1;
        if (!answer.is_objective) acc.subjective += 1;
        return acc;
      },
      { correct: 0, incorrect: 0, subjective: 0 },
    );
  }, [data]);

  if (loading) {
    return <Card className="paper-assignment-card" loading bordered={false} style={{ maxWidth: 1120, margin: "24px auto" }} />;
  }

  if (!data) {
    return (
      <div className="page-shell page-shell--wide page-shell--minimal">
        <Card className="paper-empty-card" bordered={false}>
          <Empty description="未找到这次答卷" />
        </Card>
      </div>
    );
  }

  const { submission, paper, answers, show_answer: showAnswer } = data;
  const isPending = submission.status === "submitted";
  const isGraded = submission.status === "graded";
  const finalScoreText = isGraded ? fmtScore(submission.final_score) : "--";

  return (
    <div className="page-shell page-shell--wide page-shell--minimal">
      <div className="page-toolbar page-toolbar--stack page-toolbar--minimal">
        <div className="page-toolbar__leading">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/papers")}>
            返回考试列表
          </Button>
          <div>
            <h2 style={{ margin: 0 }}>{paper.title}</h2>
            <Text type="secondary">查看本次提交成绩、老师反馈与逐题明细。</Text>
          </div>
        </div>
      </div>

      <Card className="paper-header-card" bordered={false}>
        <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
          <Tag bordered={false} color={isGraded ? (submission.is_pass ? "success" : "error") : "processing"}>
            {isGraded ? (submission.is_pass ? "已通过" : "未通过") : "待复核"}
          </Tag>
          <Tag bordered={false}>第 {submission.attempt_no} 次提交</Tag>
          <Tag bordered={false}>{formatTime(submission.submitted_at)}</Tag>
        </Space>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {isPending
            ? "当前成绩仍在等待人工复核，客观题分数已先展示。"
            : "你可以结合分数、老师评语和逐题解析回看本次作答。"}
        </Paragraph>
      </Card>

      <div className="paper-summary">
        <div className="paper-summary__card paper-summary__card--score">
          <span>最终成绩</span>
          <strong style={{ color: scoreTone(submission.status, submission.is_pass) }}>{finalScoreText}</strong>
        </div>
        <div className="paper-summary__card">
          <span>客观题得分</span>
          <strong>{fmtScore(submission.auto_score)}</strong>
        </div>
        <div className="paper-summary__card">
          <span>总分 / 及格线</span>
          <strong>{`${paper.total_score} / ${paper.pass_score}`}</strong>
        </div>
        <div className="paper-summary__card">
          <span>主观题数量</span>
          <strong>{answerSummary.subjective}</strong>
        </div>
        <div className="paper-summary__card">
          <span>答对题目</span>
          <strong>{answerSummary.correct}</strong>
        </div>
        <div className="paper-summary__card">
          <span>答错题目</span>
          <strong>{answerSummary.incorrect}</strong>
        </div>
        <div className="paper-summary__card">
          <span>总题量</span>
          <strong>{answers?.length || 0}</strong>
        </div>
        <div className="paper-summary__card">
          <span>答案开放</span>
          <strong>{showAnswer ? "已展示" : "未展示"}</strong>
        </div>
      </div>

      {isPending ? (
        <Alert
          type="warning"
          showIcon
          message="本次答卷正在等待人工复核"
          description="如果试卷中包含简答题或填空题，老师复核完成后才会出现最终成绩和通过状态。"
        />
      ) : null}

      {isGraded && submission.comment ? (
        <Card className="paper-feedback-card" bordered={false}>
          <span className="paper-feedback-card__eyebrow">老师评语</span>
          <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
            {submission.comment}
          </Paragraph>
        </Card>
      ) : null}

      {!showAnswer && paper.show_answer_after === "after_graded" && !isGraded ? (
        <Alert
          type="info"
          showIcon
          message="正确答案会在复核完成后展示"
        />
      ) : null}

      <div className="paper-answer-stack">
        {(answers || []).map((answer, idx) => (
          <Card key={answer.id} className="paper-answer-card" bordered={false}>
            <div className="paper-answer-card__head">
              <div>
                <Space size={[8, 8]} wrap>
                  <span className="paper-answer-card__title">第 {idx + 1} 题</span>
                  <Tag bordered={false} color={TYPE_COLOR[answer.question_type] || "default"}>
                    {answer.question_type_label}
                  </Tag>
                  <Tag bordered={false}>得分 {fmtScore(answer.final_score ?? answer.auto_score)} / {answer.score}</Tag>
                </Space>
                <Text type="secondary">{answerStateText(answer)}</Text>
              </div>
              <div className="paper-answer-card__icon">
                {correctnessIcon(answer)}
              </div>
            </div>

            <Paragraph className="paper-answer-card__stem">
              {answer.stem}
            </Paragraph>

            {answer.options && answer.options.length ? (
              <div className="paper-answer-card__options">
                {answer.options.map((option, optionIndex) => {
                  const letter = letterFor(optionIndex);
                  const userPicked = answer.user_answer.includes(letter);
                  const correctPicked = showAnswer && answer.correct_answer.includes(letter);
                  const optionClass = [
                    "paper-answer-card__option",
                    userPicked ? "is-user" : "",
                    correctPicked ? "is-correct" : "",
                    userPicked && showAnswer && !correctPicked ? "is-wrong" : "",
                  ].filter(Boolean).join(" ");

                  return (
                    <div key={letter} className={optionClass}>
                      <span className="paper-answer-card__option-letter">{letter}</span>
                      <span className="paper-answer-card__option-text">{option}</span>
                      <Space size={[6, 6]} wrap>
                        {userPicked ? <Tag bordered={false} color="blue">你的选择</Tag> : null}
                        {correctPicked ? <Tag bordered={false} color="success">正确答案</Tag> : null}
                      </Space>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="paper-answer-card__block">
                <span className="paper-answer-card__label">你的答案</span>
                {answer.user_answer.length ? (
                  <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                    {answer.user_answer.join(" | ")}
                  </Paragraph>
                ) : (
                  <Text type="secondary">未作答</Text>
                )}
              </div>
            )}

            {showAnswer && answer.correct_answer.length && (!answer.options || !answer.options.length) ? (
              <div className="paper-answer-card__block paper-answer-card__block--success">
                <span className="paper-answer-card__label">参考答案</span>
                <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                  {answer.correct_answer.join(" | ")}
                </Paragraph>
              </div>
            ) : null}

            {showAnswer && answer.explanation ? (
              <Alert
                type="info"
                showIcon
                message="解析"
                description={<span style={{ whiteSpace: "pre-wrap" }}>{answer.explanation}</span>}
              />
            ) : null}

            {answer.comment ? (
              <Alert
                type="success"
                showIcon
                message="老师批注"
                description={<span style={{ whiteSpace: "pre-wrap" }}>{answer.comment}</span>}
              />
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
