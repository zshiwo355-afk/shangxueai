import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  FlagOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  Affix,
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Radio,
  Result,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchAssignmentForTaking,
  submitAssignment,
} from "../../../lib/api.userPapers";

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

function pad2(n) {
  return String(Math.max(0, n)).padStart(2, "0");
}

function normalizeAnswer(question, value) {
  const type = question.question_type;
  if (type === "single" || type === "judge") {
    return value ? [String(value)] : [];
  }
  if (type === "multiple") {
    if (!Array.isArray(value)) return [];
    return value.map(String);
  }
  if (type === "blank") {
    if (!Array.isArray(value)) {
      return value ? [String(value).trim()].filter(Boolean) : [];
    }
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (type === "short_answer") {
    const text = String(value || "").trim();
    return text ? [text] : [];
  }
  return [];
}

function emptyValueFor(question) {
  const type = question.question_type;
  if (type === "multiple") return [];
  if (type === "blank") return [];
  return undefined;
}

function formatRemain(remainSec) {
  return `${pad2(Math.floor(remainSec / 60))}:${pad2(remainSec % 60)}`;
}

export default function UserPaperTakePage() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { message, modal } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [answers, setAnswers] = useState({});
  const [marks, setMarks] = useState({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [remainSec, setRemainSec] = useState(null);
  const submittedRef = useRef(false);
  const stageRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchAssignmentForTaking(assignmentId);
        if (!alive) return;
        setDetail(data);
        const initialAnswers = {};
        for (const question of data.questions || []) {
          initialAnswers[question.id] = emptyValueFor(question);
        }
        setAnswers(initialAnswers);
        if (typeof data.remain_sec === "number") {
          setRemainSec(data.remain_sec);
        } else {
          setRemainSec(null);
        }
      } catch (err) {
        if (alive) message.error(err?.message || "考试详情加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [assignmentId, message]);

  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const payload = (detail.questions || []).map((question) => ({
        paper_question_id: question.id,
        answer: normalizeAnswer(question, answers[question.id]),
      }));
      const result = await submitAssignment(assignmentId, payload);
      message.success(auto ? "时间已到，系统已自动提交答卷。" : "答卷提交成功。");
      navigate(`/papers/submissions/${result.id}`, { replace: true });
    } catch (err) {
      submittedRef.current = false;
      message.error(err?.message || "提交失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }, [answers, assignmentId, detail, message, navigate]);

  useEffect(() => {
    if (remainSec == null) return;
    if (remainSec <= 0) {
      submit(true);
      return;
    }
    const timer = setTimeout(() => {
      setRemainSec((prev) => (prev == null ? null : prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [remainSec, submit]);

  const questions = useMemo(() => detail?.questions || [], [detail]);
  const total = questions.length;
  const current = questions[activeIdx] || null;

  const answeredFlags = useMemo(
    () => questions.map((question) => normalizeAnswer(question, answers[question.id]).length > 0),
    [answers, questions],
  );
  const answeredCount = answeredFlags.filter(Boolean).length;
  const unanswered = total - answeredCount;
  const markedCount = questions.filter((question) => marks[question.id]).length;

  const goTo = useCallback((idx) => {
    setActiveIdx(Math.max(0, Math.min(total - 1, idx)));
    if (stageRef.current) {
      try {
        stageRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        stageRef.current.scrollIntoView();
      }
    }
  }, [total]);

  const onSubmitClick = () => {
    const title = unanswered > 0
      ? `还有 ${unanswered} 题未作答，确认现在提交吗？`
      : "确认提交这份答卷吗？";
    modal.confirm({
      title,
      content: "提交后将不能继续修改答案，请在提交前再检查一次。",
      okText: "确认提交",
      cancelText: "继续检查",
      onOk: () => submit(false),
    });
  };

  const onLeaveClick = () => {
    modal.confirm({
      title: "确认离开本次考试？",
      content: "当前页面不会自动保存未提交的答案。",
      okText: "离开",
      cancelText: "继续作答",
      onOk: () => navigate("/papers"),
    });
  };

  const toggleMark = (questionId) => {
    setMarks((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  if (loading) {
    return <Card className="paper-assignment-card" loading bordered={false} style={{ maxWidth: 1180, margin: "24px auto" }} />;
  }

  if (!detail) {
    return (
      <div className="page-shell page-shell--wide page-shell--minimal">
        <Card className="paper-empty-card" bordered={false}>
          <Empty description="未找到这份试卷" />
        </Card>
      </div>
    );
  }

  if (!detail.can_start) {
    return (
      <div className="page-shell page-shell--narrow page-shell--minimal">
        <Result
          status="warning"
          title="当前无法开始考试"
          subTitle={detail.block_reason || "这份试卷暂时不可作答。"}
          extra={(
            <Space wrap>
              <Button onClick={() => navigate("/papers")}>返回考试列表</Button>
              {detail.assignment.last_submission_id ? (
                <Button
                  type="primary"
                  onClick={() => navigate(`/papers/submissions/${detail.assignment.last_submission_id}`)}
                >
                  查看上次结果
                </Button>
              ) : null}
            </Space>
          )}
        />
      </div>
    );
  }

  const assignment = detail.assignment;
  const isLast = activeIdx >= total - 1;
  const isFirst = activeIdx <= 0;
  const answeredRatio = total > 0 ? Math.round((answeredCount / total) * 100) : 0;

  return (
    <div className="paper-take">
      <Affix offsetTop={0}>
        <header className="paper-take__bar">
          <div className="paper-take__bar-inner">
            <div className="paper-take__bar-main">
              <Button size="small" icon={<ArrowLeftOutlined />} onClick={onLeaveClick}>
                返回
              </Button>
              <div className="paper-take__bar-copy">
                <strong>{assignment.paper_title}</strong>
                <Text type="secondary">
                  第 {assignment.attempt_count + 1} / {assignment.max_attempts} 次作答
                </Text>
              </div>
            </div>

            <Space size={[10, 10]} wrap>
              <Tag bordered={false} color="blue">题数 {total}</Tag>
              <Tag bordered={false} color="geekblue">总分 {assignment.total_score}</Tag>
              <Tag bordered={false}>及格 {assignment.pass_score}</Tag>
              {remainSec != null ? (
                <span className={`paper-take__timer${remainSec < 300 ? " is-urgent" : ""}`}>
                  <ClockCircleOutlined />
                  {formatRemain(remainSec)}
                </span>
              ) : (
                <Tag bordered={false}>不限时</Tag>
              )}
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={submitting}
                onClick={onSubmitClick}
              >
                提交答卷
              </Button>
            </Space>
          </div>
        </header>
      </Affix>

      <section className="paper-take__hero">
        <div className="paper-take__hero-copy">
          <span className="paper-take__hero-eyebrow">正在作答</span>
          <h2>{assignment.paper_title}</h2>
          <Paragraph>
            先完成当前题目，再通过右侧题号快速跳转。标记功能适合稍后回看不确定的题。
          </Paragraph>
        </div>
        <div className="paper-take__hero-stats">
          <div className="paper-take__hero-stat">
            <span>已完成</span>
            <strong>{answeredCount}</strong>
          </div>
          <div className="paper-take__hero-stat">
            <span>未作答</span>
            <strong>{Math.max(unanswered, 0)}</strong>
          </div>
          <div className="paper-take__hero-stat">
            <span>已标记</span>
            <strong>{markedCount}</strong>
          </div>
          <div className="paper-take__hero-stat">
            <span>完成进度</span>
            <strong>{`${answeredRatio}%`}</strong>
          </div>
        </div>
      </section>

      <div className="paper-take__body">
        <aside className="paper-take__sidebar">
          <div className="paper-take__sidebar-head">
            <span>题号导航</span>
            <Tooltip title="已作答题数 / 总题数">
              <span className="paper-take__progress">
                <strong>{answeredCount}</strong>
                <span>/ {total}</span>
              </span>
            </Tooltip>
          </div>

          <div className="paper-take__palette">
            {questions.map((question, idx) => {
              const answered = answeredFlags[idx];
              const marked = !!marks[question.id];
              const active = idx === activeIdx;
              const cls = [
                "paper-take__chip",
                active ? "is-active" : "",
                answered ? "is-answered" : "",
                marked ? "is-marked" : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={question.id}
                  type="button"
                  className={cls}
                  onClick={() => goTo(idx)}
                  title={`第 ${idx + 1} 题${answered ? "（已作答）" : ""}${marked ? "（已标记）" : ""}`}
                >
                  {idx + 1}
                  {marked ? <span className="paper-take__chip-flag" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className="paper-take__legend">
            <span><i className="paper-take__sw paper-take__sw--answered" />已作答</span>
            <span><i className="paper-take__sw paper-take__sw--marked" />已标记</span>
            <span><i className="paper-take__sw" />未作答</span>
          </div>

          {unanswered > 0 ? (
            <div className="paper-take__hint">
              还有 <strong>{unanswered}</strong> 题未作答
              {markedCount > 0 ? <>，其中 <strong>{markedCount}</strong> 题已标记</> : null}
            </div>
          ) : (
            <div className="paper-take__hint paper-take__hint--ok">
              <CheckOutlined />
              所有题目都已填写答案
            </div>
          )}
        </aside>

        <main className="paper-take__stage" ref={stageRef}>
          {assignment.duration_minutes > 0 && remainSec != null && remainSec < 300 ? (
            <Alert
              type="warning"
              showIcon
              message={`剩余时间 ${formatRemain(remainSec)}，请尽快完成并提交。`}
            />
          ) : null}

          {current ? (
            <Card className="paper-take__qcard" bordered={false}>
              <div className="paper-take__qhead">
                <div className="paper-take__qhead-left">
                  <span className="paper-take__qnum">第 {activeIdx + 1} 题</span>
                  <span className="paper-take__qcount">共 {total} 题</span>
                </div>

                <Space size={[8, 8]} wrap>
                  <Tag bordered={false} color={TYPE_COLOR[current.question_type] || "default"}>
                    {current.question_type_label}
                  </Tag>
                  <Tag bordered={false}>{current.score} 分</Tag>
                  <Button
                    size="small"
                    type={marks[current.id] ? "primary" : "default"}
                    icon={<FlagOutlined />}
                    onClick={() => toggleMark(current.id)}
                  >
                    {marks[current.id] ? "已标记" : "标记"}
                  </Button>
                </Space>
              </div>

              <Paragraph className="paper-take__stem">{current.stem}</Paragraph>

              <div className="paper-take__answer">
                {current.question_type === "single" ? (
                  <Radio.Group
                    value={answers[current.id]}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))}
                  >
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      {current.options.map((option, idx) => {
                        const letter = letterFor(idx);
                        const checked = answers[current.id] === letter;
                        return (
                          <label
                            key={letter}
                            className={`paper-take__option${checked ? " is-checked" : ""}`}
                            onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: letter }))}
                          >
                            <Radio value={letter} />
                            <span className="paper-take__option-letter">{letter}</span>
                            <span className="paper-take__option-text">{option}</span>
                          </label>
                        );
                      })}
                    </Space>
                  </Radio.Group>
                ) : null}

                {current.question_type === "multiple" ? (
                  <Checkbox.Group
                    value={answers[current.id] || []}
                    onChange={(value) => setAnswers((prev) => ({ ...prev, [current.id]: value }))}
                    style={{ width: "100%" }}
                  >
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      {current.options.map((option, idx) => {
                        const letter = letterFor(idx);
                        const checked = (answers[current.id] || []).includes(letter);
                        return (
                          <label
                            key={letter}
                            className={`paper-take__option${checked ? " is-checked" : ""}`}
                          >
                            <Checkbox value={letter} />
                            <span className="paper-take__option-letter">{letter}</span>
                            <span className="paper-take__option-text">{option}</span>
                          </label>
                        );
                      })}
                    </Space>
                  </Checkbox.Group>
                ) : null}

                {current.question_type === "judge" ? (
                  <Radio.Group
                    value={answers[current.id]}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))}
                  >
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      {["对", "错"].map((option) => {
                        const checked = answers[current.id] === option;
                        return (
                          <label
                            key={option}
                            className={`paper-take__option${checked ? " is-checked" : ""}`}
                            onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: option }))}
                          >
                            <Radio value={option} />
                            <span className="paper-take__option-text">{option}</span>
                          </label>
                        );
                      })}
                    </Space>
                  </Radio.Group>
                ) : null}

                {current.question_type === "blank" ? (
                  <BlankInputs
                    value={answers[current.id] || []}
                    onChange={(value) => setAnswers((prev) => ({ ...prev, [current.id]: value }))}
                  />
                ) : null}

                {current.question_type === "short_answer" ? (
                  <Input.TextArea
                    rows={7}
                    maxLength={2000}
                    showCount
                    placeholder="请输入你的作答内容"
                    value={answers[current.id] || ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))}
                  />
                ) : null}
              </div>
            </Card>
          ) : null}

          <footer className="paper-take__nav">
            <Button
              size="large"
              icon={<LeftOutlined />}
              disabled={isFirst}
              onClick={() => goTo(activeIdx - 1)}
            >
              上一题
            </Button>

            <Text type="secondary" style={{ fontVariant: "tabular-nums" }}>
              {activeIdx + 1} / {total}
            </Text>

            {isLast ? (
              <Button
                size="large"
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={submitting}
                onClick={onSubmitClick}
              >
                提交答卷
              </Button>
            ) : (
              <Button size="large" type="primary" onClick={() => goTo(activeIdx + 1)}>
                下一题
                <RightOutlined />
              </Button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

function BlankInputs({ value, onChange }) {
  const items = Array.isArray(value) && value.length ? value : [""];

  const update = (idx, nextValue) => {
    const next = [...items];
    next[idx] = nextValue;
    onChange(next);
  };

  const addBlank = () => onChange([...items, ""]);

  const removeBlank = (idx) => {
    const next = items.filter((_, index) => index !== idx);
    onChange(next.length ? next : [""]);
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      {items.map((item, idx) => (
        <div key={`${idx}-${items.length}`} className="paper-take__blank-row">
          <Tag bordered={false}>第 {idx + 1} 空</Tag>
          <Input
            placeholder="填写答案"
            value={item}
            onChange={(e) => update(idx, e.target.value)}
          />
          {items.length > 1 ? (
            <Button type="link" danger onClick={() => removeBlank(idx)}>
              移除
            </Button>
          ) : null}
        </div>
      ))}
      <Button type="dashed" onClick={addBlank}>
        新增一空
      </Button>
    </Space>
  );
}
