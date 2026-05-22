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

function pad2(n) {
  return String(Math.max(0, n)).padStart(2, "0");
}

/** 把表单 state 里的答案标准化成提交格式：list[str]。 */
function normalizeAnswer(question, value) {
  const t = question.question_type;
  if (t === "single" || t === "judge") {
    return value ? [String(value)] : [];
  }
  if (t === "multiple") {
    if (!Array.isArray(value)) return [];
    return value.map(String);
  }
  if (t === "blank") {
    if (!Array.isArray(value)) return value ? [String(value).trim()].filter(Boolean) : [];
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (t === "short_answer") {
    const text = String(value || "").trim();
    return text ? [text] : [];
  }
  return [];
}

function emptyValueFor(question) {
  const t = question.question_type;
  if (t === "multiple") return [];
  if (t === "blank") return [];
  return undefined;
}

export default function UserPaperTakePage() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { message, modal } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [answers, setAnswers] = useState({}); // {paper_question_id: value}
  const [marks, setMarks] = useState({});     // {paper_question_id: true}
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
        const init = {};
        for (const q of data.questions || []) {
          init[q.id] = emptyValueFor(q);
        }
        setAnswers(init);
        // 倒计时优先用服务端基于 started_at 算出的 remain_sec（刷新不会重置）；
        // 服务端没返回（试卷未限时）则不启动倒计时。
        if (typeof data.remain_sec === "number") {
          setRemainSec(data.remain_sec);
        } else {
          setRemainSec(null);
        }
      } catch (err) {
        if (alive) message.error(err?.message || "加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [assignmentId, message]);

  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const payload = (detail.questions || []).map((q) => ({
        paper_question_id: q.id,
        answer: normalizeAnswer(q, answers[q.id]),
      }));
      const res = await submitAssignment(assignmentId, payload);
      message.success(auto ? "时间到，已自动提交答卷。" : "已提交答卷。");
      navigate(`/papers/submissions/${res.id}`, { replace: true });
    } catch (err) {
      submittedRef.current = false;
      message.error(err?.message || "提交失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }, [assignmentId, answers, detail, message, navigate]);

  // 倒计时
  useEffect(() => {
    if (remainSec == null) return;
    if (remainSec <= 0) {
      submit(true);
      return;
    }
    const t = setTimeout(() => setRemainSec((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [remainSec, submit]);

  const questions = useMemo(() => detail?.questions || [], [detail]);
  const total = questions.length;
  const current = questions[activeIdx] || null;

  const answeredFlags = useMemo(() => {
    return questions.map((q) => normalizeAnswer(q, answers[q.id]).length > 0);
  }, [answers, questions]);
  const answeredCount = answeredFlags.filter(Boolean).length;
  const unanswered = total - answeredCount;
  const markedCount = questions.filter((q) => marks[q.id]).length;

  const goTo = useCallback((idx) => {
    setActiveIdx(Math.max(0, Math.min(total - 1, idx)));
    // 题切换后滚到顶
    if (stageRef.current) {
      try {
        stageRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        stageRef.current.scrollIntoView();
      }
    }
  }, [total]);

  const onSubmitClick = () => {
    const tip = unanswered > 0
      ? `还有 ${unanswered} 题未作答，确认提交？`
      : "确认提交答卷？";
    modal.confirm({
      title: tip,
      content: "提交后将无法修改。",
      okText: "确认提交",
      cancelText: "再检查一下",
      onOk: () => submit(false),
    });
  };

  const toggleMark = (qid) => {
    setMarks((s) => ({ ...s, [qid]: !s[qid] }));
  };

  if (loading) return <Card loading style={{ maxWidth: 1080, margin: "24px auto" }} />;
  if (!detail) return <Empty description="未找到考试" style={{ marginTop: 80 }} />;

  if (!detail.can_start) {
    return (
      <div style={{ maxWidth: 720, margin: "48px auto", padding: "0 16px" }}>
        <Result
          status="warning"
          title="无法开始考试"
          subTitle={detail.block_reason || "当前不可作答。"}
          extra={
            <Space>
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
          }
        />
      </div>
    );
  }

  const a = detail.assignment;
  const isLast = activeIdx >= total - 1;
  const isFirst = activeIdx <= 0;

  return (
    <div className="paper-take">
      <Affix offsetTop={0}>
        <header className="paper-take__bar">
          <div className="paper-take__bar-inner">
            <Space size={12} wrap>
              <Button
                size="small"
                icon={<ArrowLeftOutlined />}
                onClick={() => {
                  modal.confirm({
                    title: "确认离开考试？",
                    content: "未提交的答案将不会保存。",
                    okText: "离开",
                    cancelText: "继续作答",
                    onOk: () => navigate("/papers"),
                  });
                }}
              >
                返回
              </Button>
              <Title level={5} style={{ margin: 0 }}>{a.paper_title}</Title>
              <Tag>第 {a.attempt_count + 1} / {a.max_attempts} 次</Tag>
            </Space>
            <Space size={12} wrap>
              <Tag color="blue" bordered={false}>题数 {total}</Tag>
              <Tag color="geekblue" bordered={false}>总分 {a.total_score}</Tag>
              <Tag bordered={false}>及格 {a.pass_score}</Tag>
              {remainSec != null ? (
                <span className={`paper-take__timer${remainSec < 300 ? " is-urgent" : ""}`}>
                  <ClockCircleOutlined />
                  {pad2(Math.floor(remainSec / 60))}<i>:</i>{pad2(remainSec % 60)}
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

      <div className="paper-take__body">
        <aside className="paper-take__sidebar">
          <div className="paper-take__sidebar-head">
            <span>题号导航</span>
            <Tooltip title="已作答 / 共">
              <span className="paper-take__progress">
                <strong>{answeredCount}</strong>
                <span>/ {total}</span>
              </span>
            </Tooltip>
          </div>

          <div className="paper-take__palette">
            {questions.map((q, idx) => {
              const answered = answeredFlags[idx];
              const marked = !!marks[q.id];
              const active = idx === activeIdx;
              const cls = [
                "paper-take__chip",
                active ? "is-active" : "",
                answered ? "is-answered" : "",
                marked ? "is-marked" : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={q.id}
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
              {markedCount > 0 ? <>，<strong>{markedCount}</strong> 题已标记</> : null}
            </div>
          ) : (
            <div className="paper-take__hint paper-take__hint--ok">
              <CheckOutlined /> 全部题目已作答
            </div>
          )}
        </aside>

        <main className="paper-take__stage" ref={stageRef}>
          {a.duration_minutes > 0 && remainSec != null && remainSec < 300 ? (
            <Alert
              type="warning"
              showIcon
              message={`仅剩 ${pad2(Math.floor(remainSec / 60))}:${pad2(remainSec % 60)}，请尽快完成。`}
              style={{ marginBottom: 16 }}
            />
          ) : null}

          {current ? (
            <Card className="paper-take__qcard" bordered={false}>
              <div className="paper-take__qhead">
                <div className="paper-take__qhead-left">
                  <span className="paper-take__qnum">第 {activeIdx + 1} 题</span>
                  <span className="paper-take__qcount">/ 共 {total} 题</span>
                </div>
                <Space size={8}>
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
                    onChange={(e) => setAnswers((s) => ({ ...s, [current.id]: e.target.value }))}
                  >
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      {current.options.map((opt, i) => {
                        const letter = letterFor(i);
                        const checked = answers[current.id] === letter;
                        return (
                          <label
                            key={i}
                            className={`paper-take__option${checked ? " is-checked" : ""}`}
                            onClick={() => setAnswers((s) => ({ ...s, [current.id]: letter }))}
                          >
                            <Radio value={letter} />
                            <span className="paper-take__option-letter">{letter}</span>
                            <span className="paper-take__option-text">{opt}</span>
                          </label>
                        );
                      })}
                    </Space>
                  </Radio.Group>
                ) : null}

                {current.question_type === "multiple" ? (
                  <Checkbox.Group
                    value={answers[current.id] || []}
                    onChange={(v) => setAnswers((s) => ({ ...s, [current.id]: v }))}
                    style={{ width: "100%" }}
                  >
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      {current.options.map((opt, i) => {
                        const letter = letterFor(i);
                        const checked = (answers[current.id] || []).includes(letter);
                        return (
                          <label
                            key={i}
                            className={`paper-take__option${checked ? " is-checked" : ""}`}
                          >
                            <Checkbox value={letter} />
                            <span className="paper-take__option-letter">{letter}</span>
                            <span className="paper-take__option-text">{opt}</span>
                          </label>
                        );
                      })}
                    </Space>
                  </Checkbox.Group>
                ) : null}

                {current.question_type === "judge" ? (
                  <Radio.Group
                    value={answers[current.id]}
                    onChange={(e) => setAnswers((s) => ({ ...s, [current.id]: e.target.value }))}
                  >
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      {["对", "错"].map((opt) => {
                        const checked = answers[current.id] === opt;
                        return (
                          <label
                            key={opt}
                            className={`paper-take__option${checked ? " is-checked" : ""}`}
                            onClick={() => setAnswers((s) => ({ ...s, [current.id]: opt }))}
                          >
                            <Radio value={opt} />
                            <span className="paper-take__option-text">{opt}</span>
                          </label>
                        );
                      })}
                    </Space>
                  </Radio.Group>
                ) : null}

                {current.question_type === "blank" ? (
                  <BlankInputs
                    value={answers[current.id] || []}
                    onChange={(v) => setAnswers((s) => ({ ...s, [current.id]: v }))}
                  />
                ) : null}

                {current.question_type === "short_answer" ? (
                  <Input.TextArea
                    rows={6}
                    maxLength={2000}
                    showCount
                    placeholder="请作答……"
                    value={answers[current.id] || ""}
                    onChange={(e) => setAnswers((s) => ({ ...s, [current.id]: e.target.value }))}
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
              <Button
                size="large"
                type="primary"
                onClick={() => goTo(activeIdx + 1)}
              >
                下一题 <RightOutlined />
              </Button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

/** 填空题的多空输入：默认 1 空，允许动态加空。 */
function BlankInputs({ value, onChange }) {
  const items = Array.isArray(value) && value.length ? value : [""];
  const update = (idx, v) => {
    const next = [...items];
    next[idx] = v;
    onChange(next);
  };
  const addBlank = () => onChange([...items, ""]);
  const removeBlank = (idx) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.length ? next : [""]);
  };
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={10}>
      {items.map((v, idx) => (
        <Space key={idx} style={{ width: "100%" }}>
          <Tag>第 {idx + 1} 空</Tag>
          <Input
            style={{ width: 360 }}
            placeholder="填入答案"
            value={v}
            onChange={(e) => update(idx, e.target.value)}
          />
          {items.length > 1 ? (
            <Button type="link" danger onClick={() => removeBlank(idx)}>移除</Button>
          ) : null}
        </Space>
      ))}
      <Button type="dashed" onClick={addBlank}>新增空</Button>
    </Space>
  );
}
