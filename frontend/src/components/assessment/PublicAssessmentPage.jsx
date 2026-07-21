import {
  App as AntdApp,
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Progress,
  Radio,
  Result,
  Select,
  Skeleton,
  Space,
  Tag,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import {
  createAssessmentDraft,
  getAssessmentDraft,
  getPublicAssessment,
  saveAssessmentDraft,
  submitAssessmentDraft,
} from "../../lib/api.assessments";
import "./assessment.css";


function fieldControl(field) {
  if (field.type === "number") return <InputNumber min={1} max={120} style={{ width: "100%" }} />;
  if (field.type === "select") {
    return <Select options={(field.options || []).map((value) => ({ value, label: value }))} />;
  }
  return <Input type={field.type === "phone" ? "tel" : "text"} maxLength={255} />;
}

function isQuestionAnswered(question, answer) {
  if (!question || answer === undefined || answer === null) return false;
  if (question.response_type === "most_least") return Boolean(answer.most && answer.least && answer.most !== answer.least);
  if (question.response_type === "text") return String(answer).trim().length >= (question.min_length || 1);
  return Boolean(answer);
}


export default function PublicAssessmentPage() {
  const { publicCode } = useParams();
  const { message } = AntdApp.useApp();
  const [profileForm] = Form.useForm();
  const storageKey = `personality-assessment:${publicCode}:draft-token`;
  const [formData, setFormData] = useState(null);
  const [profile, setProfile] = useState({});
  const [answers, setAnswers] = useState({});
  const [draftToken, setDraftToken] = useState("");
  const [stage, setStage] = useState("loading");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    if (stage === "questions") {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [sectionIndex, stage]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const publicResult = await getPublicAssessment(publicCode);
        if (!active) return;
        let nextForm = publicResult.form;
        const storedToken = localStorage.getItem(storageKey) || "";
        if (storedToken) {
          try {
            const draft = await getAssessmentDraft(publicCode, storedToken);
            if (!active) return;
            if (draft.status === "submitted") {
              localStorage.removeItem(storageKey);
            } else {
              nextForm = draft.form || nextForm;
              setDraftToken(storedToken);
              setProfile(draft.profile || {});
              setAnswers(draft.answers || {});
              profileForm.setFieldsValue({ ...(draft.profile || {}), privacy_ack: true });
              setFormData(nextForm);
              setStage("questions");
              return;
            }
          } catch (draftError) {
            if (draftError?.status !== 404) throw draftError;
            localStorage.removeItem(storageKey);
          }
        }
        setFormData(nextForm);
        setStage("profile");
      } catch (loadError) {
        if (!active) return;
        setError(loadError?.message || "测评暂时无法打开。请联系表单创建者确认链接状态。");
        setStage("error");
      }
    };
    load();
    return () => { active = false; };
  }, [profileForm, publicCode, storageKey]);

  useEffect(() => {
    if (stage !== "questions" || !draftToken) return undefined;
    setSaving(true);
    setSaveLabel("正在保存…");
    const timer = window.setTimeout(async () => {
      try {
        await saveAssessmentDraft(publicCode, draftToken, { profile, answers });
        setSaveLabel("已自动保存");
      } catch {
        setSaveLabel("自动保存失败，请检查网络");
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [answers, draftToken, profile, publicCode, stage]);

  const questionnaire = formData?.questionnaire;
  const sections = questionnaire?.sections || [];
  const currentSection = sections[sectionIndex];
  const allQuestions = sections.flatMap((section) => section.questions || []);
  const currentSectionOffset = sections
    .slice(0, sectionIndex)
    .reduce((total, section) => total + (section.questions || []).length, 0);
  const answeredCount = allQuestions.filter((question) => isQuestionAnswered(question, answers[question.id])).length;
  const questionCount = questionnaire?.question_count || 54;
  const progress = Math.round((answeredCount / questionCount) * 100);

  const enabledInfoFields = useMemo(
    () => (formData?.info_fields || []).filter((field) => field.enabled !== false),
    [formData],
  );

  const beginAssessment = async () => {
    try {
      const values = await profileForm.validateFields();
      const { privacy_ack: _privacyAck, ...nextProfile } = values;
      const result = await createAssessmentDraft(publicCode, nextProfile);
      localStorage.setItem(storageKey, result.draft_token);
      setDraftToken(result.draft_token);
      setProfile(nextProfile);
      setFormData(result.form || formData);
      setAnswers({});
      setSectionIndex(0);
      setStage("questions");
    } catch (beginError) {
      if (beginError?.errorFields) return;
      message.error(beginError?.message || "创建答卷失败，请重试。");
    }
  };

  const goToSection = (index) => {
    setSectionIndex(Math.max(0, Math.min(index, sections.length - 1)));
  };

  const goNext = () => {
    const missing = (currentSection?.questions || []).filter((question) => !isQuestionAnswered(question, answers[question.id]));
    if (missing.length) {
      message.warning(`本页还有 ${missing.length} 道题未完成。`);
      return;
    }
    goToSection(sectionIndex + 1);
  };

  const submit = async () => {
    if (answeredCount !== questionCount) {
      const missingSection = sections.findIndex((section) =>
        section.questions.some((question) => !isQuestionAnswered(question, answers[question.id])));
      if (missingSection >= 0) goToSection(missingSection);
      message.warning(`还有 ${questionCount - answeredCount} 道题未完成。`);
      return;
    }
    setSubmitting(true);
    try {
      await submitAssessmentDraft(publicCode, draftToken, { profile, answers });
      localStorage.removeItem(storageKey);
      setStage("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      message.error(submitError?.message || "提交失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "loading") {
    return (
      <main className="assessment-public assessment-public--center">
        <div className="assessment-loading-card"><Skeleton active paragraph={{ rows: 6 }} /></div>
      </main>
    );
  }

  if (stage === "error") {
    return (
      <main className="assessment-public assessment-public--center">
        <Result status="warning" title="暂时无法填写" subTitle={error} />
      </main>
    );
  }

  if (stage === "done") {
    return (
      <main className="assessment-public assessment-public--center">
        <section className="assessment-complete-card">
          <div className="assessment-complete-mark"><CheckCircleFilled /></div>
          <div className="assessment-kicker">SUBMISSION RECEIVED</div>
          <h1>答卷已提交</h1>
        </section>
      </main>
    );
  }

  if (stage === "profile") {
    return (
      <main className="assessment-public">
        <div className="assessment-ambient assessment-ambient--one" />
        <div className="assessment-ambient assessment-ambient--two" />
        <section className="assessment-intro">
          <div className="assessment-intro__copy">
            <div className="assessment-kicker">HUAREN TALENT ASSESSMENT · {(questionnaire?.version || "V3").replace("personality-", "").toUpperCase()}</div>
            <h1>{formData.title}</h1>
            <p className="assessment-intro__description">
              {formData.description || "通过工作习惯与情境选择，了解你的职场行为方式与人格倾向。"}
            </p>
            <div className="assessment-meta-row">
              <span><ClockCircleOutlined /> 约 {questionnaire?.estimated_minutes || "10-12"} 分钟</span>
              <span><SafetyCertificateOutlined /> {questionCount} 道固定题目</span>
              <span>可随时续填</span>
            </div>
            <Alert
              showIcon
              type="info"
              title="作答提示"
              description={questionnaire?.response_instruction}
            />
          </div>
          <div className="assessment-profile-card">
            <div className="assessment-card-number">01</div>
            <h2>先认识一下你</h2>
            <p>这些信息只用于识别本次答卷，不会发给 AI 分析模型。</p>
            <Form form={profileForm} layout="vertical" requiredMark="optional">
              {enabledInfoFields.map((field) => (
                <Form.Item
                  key={field.key}
                  name={field.key}
                  label={field.label}
                  rules={[{ required: field.required, message: `请填写${field.label}` }]}
                >
                  {fieldControl(field)}
                </Form.Item>
              ))}
              <Form.Item
                name="privacy_ack"
                valuePropName="checked"
                rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认信息使用说明")) }]}
              >
                <Checkbox>我已知晓：本测评用于面试辅助，不构成心理诊断或单独录用依据。</Checkbox>
              </Form.Item>
              <Button type="primary" size="large" block onClick={beginAssessment}>
                开始测评 <ArrowRightOutlined />
              </Button>
            </Form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="assessment-public assessment-questionnaire">
      <header className="assessment-progress-head">
        <div>
          <div className="assessment-kicker">{formData.title}</div>
          <h1>{currentSection?.title}</h1>
          <p>{currentSection?.subtitle}</p>
        </div>
        <div className="assessment-progress-stat">
          <strong>{answeredCount}</strong><span> / {questionCount}</span>
          <small>{saving ? "正在保存" : saveLabel || "自动保存已开启"}</small>
        </div>
        <Progress percent={progress} showInfo={false} strokeColor="#ca4b31" trailColor="#eadfd5" />
        <div className="assessment-section-dots" aria-label="答题分组进度" style={{ "--assessment-section-count": sections.length }}>
          {sections.map((section, index) => (
            <button
              type="button"
              key={section.id}
              className={index === sectionIndex ? "is-current" : index < sectionIndex ? "is-done" : ""}
              onClick={() => goToSection(index)}
            >
              {String(index + 1).padStart(2, "0")}
            </button>
          ))}
        </div>
      </header>

      <section className="assessment-question-list">
        {(currentSection?.questions || []).map((question, index) => {
          const answered = isQuestionAnswered(question, answers[question.id]);
          const displayNumber = currentSectionOffset + index + 1;
          const setMostLeast = (part, value) => setAnswers((current) => {
            const previous = current[question.id] || {};
            const opposite = part === "most" ? "least" : "most";
            return {
              ...current,
              [question.id]: {
                ...previous,
                [part]: value,
                [opposite]: previous[opposite] === value ? "" : previous[opposite],
              },
            };
          });
          return (
          <article className={`assessment-question-card${answered ? " is-answered" : ""}`} key={question.id}>
            <div className="assessment-question-card__head">
              <span>{String(displayNumber).padStart(2, "0")}</span>
              <h2>{question.prompt}</h2>
              {answered ? <Tag color="success">已完成</Tag> : null}
            </div>
            {question.response_type === "most_least" ? (
              <div className="assessment-most-least">
                <div className="assessment-most-least__legend"><span>选项</span><strong>最像我</strong><strong>最不像我</strong></div>
                {(question.options || []).map((option) => (
                  <div className="assessment-most-least__option" key={option.value}>
                    <p><b>{option.value}</b>{option.label}</p>
                    <button type="button" className={answers[question.id]?.most === option.value ? "is-selected" : ""} onClick={() => setMostLeast("most", option.value)} aria-label={`${option.label}最像我`}>最像</button>
                    <button type="button" className={answers[question.id]?.least === option.value ? "is-selected is-least" : ""} onClick={() => setMostLeast("least", option.value)} aria-label={`${option.label}最不像我`}>最不像</button>
                  </div>
                ))}
              </div>
            ) : question.response_type === "single_choice" ? (
              <Radio.Group
                value={answers[question.id]}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                className="assessment-choice-list"
              >
                {(question.options || []).map((option) => (
                  <Radio value={option.value} key={option.value} className="assessment-choice-option">
                    <span className="assessment-choice-option__copy"><b>{option.value}</b><span>{option.label}</span></span>
                  </Radio>
                ))}
              </Radio.Group>
            ) : question.response_type === "text" ? (
              <Input.TextArea
                className="assessment-open-answer"
                value={answers[question.id] || ""}
                rows={5}
                maxLength={question.max_length || 1500}
                showCount
                placeholder="请写一个具体发生过的例子，包括你的选择和结果。"
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              />
            ) : (
              <Radio.Group
                value={answers[question.id]}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                className="assessment-scale"
              >
                {(questionnaire?.response_options || []).map((option) => (
                  <Radio.Button value={option.value} key={option.value}>
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </Radio.Button>
                ))}
              </Radio.Group>
            )}
            <span className="assessment-question-index">{String(displayNumber).padStart(2, "0")}</span>
          </article>
        );})}
      </section>

      <footer className="assessment-actions">
        <Button
          size="large"
          icon={<ArrowLeftOutlined />}
          disabled={sectionIndex === 0}
          onClick={() => goToSection(sectionIndex - 1)}
        >
          上一组
        </Button>
        <Space>
          <span className="assessment-actions__note">{questionnaire?.disclaimer}</span>
          {sectionIndex < sections.length - 1 ? (
            <Button type="primary" size="large" onClick={goNext}>
              下一组 <ArrowRightOutlined />
            </Button>
          ) : (
            <Button type="primary" size="large" loading={submitting} onClick={submit}>
              提交答卷
            </Button>
          )}
        </Space>
      </footer>
    </main>
  );
}
