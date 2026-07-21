import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  RadarChartOutlined,
  ReadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  UserDeleteOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";

import {
  anonymizeAssessmentSubmission,
  createAssessmentForm,
  duplicateAssessmentForm,
  generateAssessmentAI,
  getAssessmentQuestionnaire,
  getAssessmentSubmission,
  listAssessmentForms,
  listAssessmentSubmissions,
  markAssessmentOfficial,
  setAssessmentFormStatus,
  updateAssessmentForm,
} from "../../../lib/api.assessments";
import { useECharts } from "../dashboard/useECharts";
import "./assessment-admin.css";


const DEFAULT_FIELDS = [
  { key: "name", label: "姓名", type: "text", required: true, enabled: true, options: [] },
  { key: "phone", label: "手机号码", type: "phone", required: true, enabled: true, options: [] },
  { key: "age", label: "年龄", type: "number", required: true, enabled: true, options: [] },
  { key: "gender", label: "性别", type: "select", required: true, enabled: true, options: ["男", "女", "不便透露"] },
  { key: "position", label: "应聘岗位", type: "text", required: false, enabled: true, options: [] },
];

const QUESTION_KIND_LABELS = {
  personality: "人格倾向",
  personality_context: "人格补充",
  behavior: "职场行为",
  workplace: "职场取舍",
  workplace_likert: "工作符合度",
  workplace_choice: "工作情境",
  credibility: "可信度校验",
  open: "开放题",
};

const DIRECTION_LABELS = {
  positive: "正向计分",
  reverse: "反向计分",
  none: "不计入分数",
};

const CHECK_TYPE_LABELS = {
  attention: "注意力校验",
  consistency: "一致性校验",
  plausibility: "真实性校验",
};


function RadarPanel({ scores = {} }) {
  const entries = Object.entries(scores);
  const option = useMemo(() => ({
    animationDuration: 700,
    color: ["#c84c35"],
    tooltip: { trigger: "item" },
    radar: {
      radius: "65%",
      splitNumber: 4,
      indicator: entries.map(([name]) => ({ name, max: 100 })),
      axisName: { color: "#5e5a55", fontSize: 12 },
      axisLine: { lineStyle: { color: "rgba(100,82,66,.18)" } },
      splitLine: { lineStyle: { color: "rgba(100,82,66,.14)" } },
      splitArea: { areaStyle: { color: ["rgba(248,242,234,.3)", "rgba(255,255,255,.7)"] } },
    },
    series: [{
      type: "radar",
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2 },
      areaStyle: { color: "rgba(200,76,53,.17)" },
      data: [{ value: entries.map(([, value]) => value), name: "人格倾向" }],
    }],
  }), [entries]);
  const chartRef = useECharts(option, [option]);
  if (!entries.length) return <Empty description="暂无雷达图数据" />;
  return <div ref={chartRef} className="assessment-radar-chart" />;
}


function FieldEditor({ fields, onChange }) {
  const patchField = (index, patch) => {
    onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  };
  const addField = () => {
    if (fields.length >= 12) return;
    onChange([
      ...fields,
      {
        key: `custom_${Date.now().toString(36)}`,
        label: "自定义信息",
        type: "text",
        required: false,
        enabled: true,
        options: [],
      },
    ]);
  };
  return (
    <div className="assessment-field-editor">
      <div className="assessment-field-editor__head">
        <div><strong>填写人信息</strong><span>姓名和手机号码固定必填，其他字段可调整。</span></div>
        <Button size="small" icon={<PlusOutlined />} onClick={addField} disabled={fields.length >= 12}>增加字段</Button>
      </div>
      {fields.map((field, index) => {
        const locked = field.key === "name" || field.key === "phone";
        return (
          <div className="assessment-field-row" key={field.key}>
            <Input
              value={field.label}
              maxLength={40}
              onChange={(event) => patchField(index, { label: event.target.value })}
              addonBefore={locked ? <LockOutlined /> : null}
            />
            <Select
              value={field.type}
              disabled={locked}
              onChange={(type) => patchField(index, { type, options: type === "select" ? field.options : [] })}
              options={[
                { value: "text", label: "文本" },
                { value: "phone", label: "电话" },
                { value: "number", label: "数字" },
                { value: "select", label: "单选" },
              ]}
            />
            <Tooltip title="是否展示"><Switch checked={field.enabled} disabled={locked} onChange={(enabled) => patchField(index, { enabled })} /></Tooltip>
            <Tooltip title="是否必填"><Switch checked={field.required} disabled={locked} onChange={(required) => patchField(index, { required })} /></Tooltip>
            <Button
              danger
              type="text"
              disabled={locked}
              onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}
            >
              删除
            </Button>
            {field.type === "select" ? (
              <Input
                className="assessment-field-row__options"
                value={(field.options || []).join("、")}
                placeholder="选项之间用顿号分隔"
                onChange={(event) => patchField(index, {
                  options: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
                })}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}


export default function AssessmentAdminPage() {
  const { message } = AntdApp.useApp();
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [submissions, setSubmissions] = useState({ items: [], total: 0 });
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingForm, setEditingForm] = useState(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorFields, setEditorFields] = useState(DEFAULT_FIELDS);
  const [editorSaving, setEditorSaving] = useState(false);
  const [questionnaire, setQuestionnaire] = useState(null);
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  const [questionnaireLoading, setQuestionnaireLoading] = useState(false);

  const selectedForm = forms.find((form) => form.id === selectedId) || null;

  const refreshForms = async (preferredId) => {
    setLoadingForms(true);
    try {
      const rows = await listAssessmentForms();
      setForms(rows);
      setSelectedId((current) => preferredId || current || rows[0]?.id || null);
    } catch (error) {
      message.error(error.message);
    } finally {
      setLoadingForms(false);
    }
  };

  useEffect(() => { refreshForms(); }, []);

  useEffect(() => {
    if (!selectedId) {
      setSubmissions({ items: [], total: 0 });
      return;
    }
    let active = true;
    setLoadingSubmissions(true);
    listAssessmentSubmissions(selectedId, { search, page, page_size: 20 })
      .then((result) => { if (active) setSubmissions(result); })
      .catch((error) => { if (active) message.error(error.message); })
      .finally(() => { if (active) setLoadingSubmissions(false); });
    return () => { active = false; };
  }, [message, page, search, selectedId]);

  const openEditor = (form = null) => {
    setEditingForm(form);
    setEditorTitle(form?.title || "通用职场行为与人格倾向测评");
    setEditorDescription(form?.description || "用于了解填写人的职场行为方式与人格倾向，结果仅作面试辅助。 ");
    setEditorFields((form?.info_fields || DEFAULT_FIELDS).map((field) => ({ ...field, options: [...(field.options || [])] })));
    setEditorOpen(true);
  };

  const openQuestionnaire = async () => {
    setQuestionnaireOpen(true);
    if (questionnaire) return;
    setQuestionnaireLoading(true);
    try {
      setQuestionnaire(await getAssessmentQuestionnaire());
    } catch (error) {
      message.error(error.message);
      setQuestionnaireOpen(false);
    } finally {
      setQuestionnaireLoading(false);
    }
  };

  const saveEditor = async () => {
    if (!editorTitle.trim()) {
      message.warning("请填写表单名称。");
      return;
    }
    if (editorFields.some((field) => !field.label.trim())) {
      message.warning("信息字段名称不能为空。");
      return;
    }
    setEditorSaving(true);
    try {
      const payload = {
        title: editorTitle.trim(),
        description: editorDescription.trim(),
        info_fields: editorFields,
      };
      const saved = editingForm
        ? await updateAssessmentForm(editingForm.id, payload)
        : await createAssessmentForm(payload);
      setEditorOpen(false);
      await refreshForms(saved.id);
      message.success(editingForm ? "表单已更新，公开链接保持不变。" : "表单已创建。 ");
    } catch (error) {
      message.error(error.message);
    } finally {
      setEditorSaving(false);
    }
  };

  const toggleStatus = async (form) => {
    try {
      await setAssessmentFormStatus(form.id, form.status === "active" ? "disabled" : "active");
      await refreshForms(form.id);
      message.success(form.status === "active" ? "表单已停用。" : "表单已启用，原链接继续有效。 ");
    } catch (error) {
      message.error(error.message);
    }
  };

  const duplicate = async (form) => {
    try {
      const copied = await duplicateAssessmentForm(form.id);
      await refreshForms(copied.id);
      message.success("已复制为停用状态的新表单。 ");
    } catch (error) {
      message.error(error.message);
    }
  };

  const copyLink = async (form) => {
    const link = `${window.location.origin}${form.public_path}`;
    try {
      await navigator.clipboard.writeText(link);
      message.success("公开链接已复制。 ");
    } catch {
      message.info(link);
    }
  };

  const openDetail = async (id) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await getAssessmentSubmission(id));
    } catch (error) {
      message.error(error.message);
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetailAndList = async () => {
    if (detail?.id) setDetail(await getAssessmentSubmission(detail.id));
    if (selectedId) setSubmissions(await listAssessmentSubmissions(selectedId, { search, page, page_size: 20 }));
    await refreshForms(selectedId);
  };

  const runAI = async (regenerate = false) => {
    if (!detail) return;
    setAiLoading(true);
    try {
      const aiReport = await generateAssessmentAI(detail.id, regenerate);
      setDetail((current) => ({ ...current, ai_report: aiReport, has_ai_report: true }));
      message.success("AI 分析已生成。 ");
    } catch (error) {
      message.error(error.message);
    } finally {
      setAiLoading(false);
    }
  };

  const formColumns = [
    {
      title: "表单",
      dataIndex: "title",
      render: (_, record) => (
        <div className="assessment-form-title">
          <strong>{record.title}</strong>
          <span>规则 {record.rules_version} · 资料版本 {record.schema_version}</span>
        </div>
      ),
    },
    { title: "题目", dataIndex: "question_count", width: 84, render: (value) => `${value} 题` },
    { title: "答卷", dataIndex: "submission_count", width: 84 },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (status) => status === "active" ? <Tag color="success">收集中</Tag> : <Tag>已停用</Tag>,
    },
    {
      title: "操作",
      width: 330,
      render: (_, record) => (
        <Space wrap onClick={(event) => event.stopPropagation()}>
          <Button size="small" icon={<LinkOutlined />} onClick={() => copyLink(record)}>复制链接</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(record)}>设置</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => duplicate(record)}>复制表单</Button>
          <Button size="small" danger={record.status === "active"} onClick={() => toggleStatus(record)}>
            {record.status === "active" ? "停用" : "启用"}
          </Button>
        </Space>
      ),
    },
  ];

  const submissionColumns = [
    {
      title: "填写人",
      render: (_, record) => (
        <div className="assessment-person-cell">
          <strong>{record.name || "—"} {record.is_official ? <Tag color="gold">正式</Tag> : null}</strong>
          <span>{record.phone || "已匿名"}</span>
        </div>
      ),
    },
    { title: "岗位", dataIndex: "position", render: (value) => value || "—" },
    { title: "题库版本", dataIndex: "rules_version", width: 112, render: (value) => <Tag>{value || "—"}</Tag> },
    { title: "倾向标签", dataIndex: "profile_label", width: 120, render: (value) => value ? <Tag color="volcano">{value}</Tag> : "—" },
    {
      title: "可信度",
      dataIndex: "credibility",
      width: 110,
      render: (value) => value ? <Tooltip title={`${value.score} 分`}><Tag color={value.score >= 80 ? "green" : value.score >= 60 ? "orange" : "red"}>{value.status}</Tag></Tooltip> : "—",
    },
    { title: "核实线索", dataIndex: "risk_count", width: 96, render: (value) => value ? <Tag color="blue">{value} 项</Tag> : <span>0</span> },
    { title: "提交时间", dataIndex: "submitted_at", width: 170, render: (value) => value ? new Date(value).toLocaleString("zh-CN") : "—" },
    { title: "", width: 92, render: (_, record) => <Button type="link" icon={<EyeOutlined />} onClick={() => openDetail(record.id)}>查看</Button> },
  ];

  const answerColumns = [
    {
      title: "题号",
      dataIndex: "question_id",
      width: 78,
      render: (value) => <span className="assessment-table-question-id">{value}</span>,
    },
    { title: "题目原文", dataIndex: "prompt" },
    { title: "作答", dataIndex: "answer_label", width: 300, render: (value, record) => record.response_type === "text" ? <span>{value}</span> : <Tag className="assessment-answer-tag">{value}</Tag> },
    { title: "原始值", dataIndex: "raw_score", width: 78, render: (value) => value ?? "—" },
  ];

  return (
    <div className="assessment-admin">
      <section className="assessment-admin-hero">
        <div>
          <span className="assessment-admin-eyebrow">TALENT SIGNALS</span>
          <h1>人才测评</h1>
          <p>创建固定规则测评链接，查看每一题作答、确定性计分、雷达图与 AI 面试辅助分析。</p>
        </div>
        <Space wrap className="assessment-admin-hero__actions">
          <Button size="large" icon={<ReadOutlined />} onClick={openQuestionnaire}>查看 {questionnaire?.question_count || 54} 道原题</Button>
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => openEditor()}>创建表单</Button>
        </Space>
      </section>

      <Alert
        className="assessment-lock-alert"
        icon={<LockOutlined />}
        showIcon
        type="info"
        title="V3 题库与解释规则已锁定"
        description="54 道题由后端规则版本统一管理；本版不计算总分，工作符合度、情境选择、人格参考百分位和可信度分开呈现。"
      />

      <Card className="assessment-admin-card" title="表单与固定链接" extra={<span>{forms.length} 个表单</span>}>
        <Table
          rowKey="id"
          loading={loadingForms}
          columns={formColumns}
          dataSource={forms}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description="还没有测评表单" /> }}
          onRow={(record) => ({ onClick: () => { setSelectedId(record.id); setPage(1); } })}
          rowClassName={(record) => record.id === selectedId ? "assessment-row-selected" : ""}
        />
      </Card>

      <Card
        className="assessment-admin-card assessment-submission-card"
        title={selectedForm ? `答卷 · ${selectedForm.title}` : "答卷"}
        extra={selectedForm ? (
          <Space>
            <Input.Search
              allowClear
              placeholder="姓名 / 手机 / 岗位"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onSearch={(value) => { setSearch(value.trim()); setPage(1); }}
              style={{ width: 230 }}
            />
            <Button icon={<LinkOutlined />} onClick={() => copyLink(selectedForm)}>公开链接</Button>
          </Space>
        ) : null}
      >
        <Table
          rowKey="id"
          loading={loadingSubmissions}
          columns={submissionColumns}
          dataSource={submissions.items}
          scroll={{ x: 980 }}
          pagination={{
            current: page,
            pageSize: 20,
            total: submissions.total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{ emptyText: <Empty description={selectedForm ? "还没有已提交答卷" : "请先选择一个表单"} /> }}
        />
      </Card>

      <Modal
        open={editorOpen}
        title={editingForm ? "设置表单" : "创建测评表单"}
        width={820}
        onCancel={() => setEditorOpen(false)}
        onOk={saveEditor}
        okText={editingForm ? "保存设置" : "创建表单"}
        confirmLoading={editorSaving}
        destroyOnHidden
      >
        <div className="assessment-editor-grid">
          <label><span>表单名称</span><Input value={editorTitle} maxLength={255} onChange={(event) => setEditorTitle(event.target.value)} /></label>
          <label><span>填写说明</span><Input.TextArea value={editorDescription} rows={3} maxLength={2000} showCount onChange={(event) => setEditorDescription(event.target.value)} /></label>
          {editingForm ? (
            <Alert showIcon type="success" title="公开链接不会因修改设置而变化" description={`${window.location.origin}${editingForm.public_path}`} />
          ) : null}
          <FieldEditor fields={editorFields} onChange={setEditorFields} />
        </div>
      </Modal>

      <Drawer
        open={questionnaireOpen}
        onClose={() => setQuestionnaireOpen(false)}
        width="min(920px, 96vw)"
        title={questionnaire ? `固定原题与计分规则 · ${questionnaire.version}` : "固定原题与计分规则"}
      >
        {questionnaireLoading || !questionnaire ? (
          <div className="assessment-detail-loading"><Spin size="large" /></div>
        ) : (
          <div className="assessment-questionnaire">
            <Alert
              showIcon
              icon={<LockOutlined />}
              type="info"
              title={`${questionnaire.question_count} 道原题只读锁定`}
              description={`${questionnaire.overall_rule} ${questionnaire.disclaimer}`}
            />

            <Card size="small" title="人格题作答选项" className="assessment-option-card">
              <p>{questionnaire.response_instruction}</p>
              <div className="assessment-option-legend">
                {questionnaire.response_options.map((option) => (
                  <div key={option.value}>
                    <strong>{option.label}</strong>
                    <span>原始值 {option.score}</span>
                    <small>{option.hint}</small>
                  </div>
                ))}
              </div>
            </Card>

            {questionnaire.sections.map((section) => (
              <section className="assessment-question-section" key={section.id}>
                <div className="assessment-question-section__head">
                  <div><span>SECTION {String(section.id).padStart(2, "0")}</span><h3>{section.title}</h3></div>
                  <p>{section.subtitle}</p>
                </div>
                <div className="assessment-question-list">
                  {section.questions.map((question) => (
                    <article key={question.id}>
                      <strong className="assessment-question-id">{question.id}</strong>
                      <div>
                        <p>{question.prompt}</p>
                        <Space size={[4, 6]} wrap>
                          <Tag color={question.kind?.startsWith("workplace") ? "green" : question.kind === "credibility" ? "gold" : question.kind === "open" ? "blue" : "volcano"}>
                            {QUESTION_KIND_LABELS[question.kind]}
                          </Tag>
                          <Tag>{question.dimension}</Tag>
                          {question.direction ? <Tag>{DIRECTION_LABELS[question.direction]}</Tag> : null}
                          {question.weight !== undefined ? <Tag>权重 {question.weight}</Tag> : null}
                          {question.response_type === "most_least" ? <Tag color="cyan">最像 / 最不像</Tag> : null}
                          {question.response_type === "single_choice" ? <Tag color="cyan">单项选择</Tag> : null}
                          {question.response_type === "text" ? <Tag color="blue">开放作答</Tag> : null}
                          {question.check_type ? <Tag color="purple">{CHECK_TYPE_LABELS[question.check_type]}</Tag> : null}
                          {question.expected_score ? <Tag>指定 {question.expected_score} 分选项</Tag> : null}
                          {question.compare_question_id ? <Tag>对照 {question.compare_question_id}</Tag> : null}
                          {question.max_pass_score ? <Tag>通过阈值 ≤ {question.max_pass_score} 分</Tag> : null}
                        </Space>
                        {question.options?.length ? (
                          <div className="assessment-question-options">
                            {question.options.map((option) => <span key={option.value}><b>{option.value}</b>{option.label}</span>)}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Drawer>

      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width="min(1020px, 96vw)"
        title={detail ? `${detail.name || "已匿名"} · 答卷 #${detail.id}` : "答卷详情"}
        extra={detail ? (
          <Space>
            <Button icon={<CheckCircleOutlined />} disabled={detail.is_official || !!detail.anonymized_at} onClick={async () => {
              try { await markAssessmentOfficial(detail.id); await refreshDetailAndList(); message.success("已设为该手机号的正式记录。 "); } catch (error) { message.error(error.message); }
            }}>设为正式</Button>
            <Popconfirm title="匿名化后将清除姓名、电话、年龄等身份信息，且无法恢复。" onConfirm={async () => {
              try { await anonymizeAssessmentSubmission(detail.id); await refreshDetailAndList(); message.success("身份信息已匿名化。 "); } catch (error) { message.error(error.message); }
            }}>
              <Button danger icon={<UserDeleteOutlined />} disabled={!!detail.anonymized_at}>匿名化</Button>
            </Popconfirm>
          </Space>
        ) : null}
      >
        {detailLoading || !detail ? <div className="assessment-detail-loading"><Spin size="large" /></div> : (
          <div className="assessment-detail">
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label="姓名">{detail.name || "已匿名"}</Descriptions.Item>
              <Descriptions.Item label="手机">{detail.phone || "已匿名"}</Descriptions.Item>
              <Descriptions.Item label="岗位">{detail.position || "—"}</Descriptions.Item>
              <Descriptions.Item label="提交次数">第 {detail.attempt_no} 次</Descriptions.Item>
              <Descriptions.Item label="填写时长">{detail.duration_seconds ? `${Math.floor(detail.duration_seconds / 60)} 分 ${detail.duration_seconds % 60} 秒` : "—"}</Descriptions.Item>
              <Descriptions.Item label="规则版本">{detail.score?.rules_version}</Descriptions.Item>
            </Descriptions>

            <Row gutter={[14, 14]} className="assessment-stat-grid">
              {detail.score?.overall_score !== null && detail.score?.overall_score !== undefined ? (
                <Col xs={12} md={6}><Card><Statistic title="职场行为总分（旧版）" value={detail.score?.overall_score} suffix="/ 100" /></Card></Col>
              ) : (
                <Col xs={12} md={6}><Card><Statistic title="参考样本中的主要特质" value={`${detail.score?.profile_basis_dimension || "—"} · 第 ${detail.score?.norm_percentiles?.[detail.score?.profile_basis_dimension] ?? "—"} 百分位`} /></Card></Col>
              )}
              <Col xs={12} md={6}><Card><Statistic title="倾向类型" value={detail.score?.profile_label || "—"} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="可信度" value={detail.score?.credibility?.score} suffix="%" /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title={detail.score?.rules_version !== "personality-v1" ? "面试核实线索" : "风险证据"} value={detail.score?.risks?.length || 0} suffix="项" /></Card></Col>
            </Row>

            <Alert
              showIcon
              icon={<SafetyCertificateOutlined />}
              type={detail.score?.credibility?.score >= 80 ? "success" : "warning"}
              title={`可信度：${detail.score?.credibility?.status || "—"}`}
              description={detail.score?.credibility?.duration_note || "可信度只表示答题一致性，不影响任何人格或职场维度。"}
            />

            <div className="assessment-detail-grid">
              <Card title={<><RadarChartOutlined /> {detail.score?.norm_percentiles ? "人格参考百分位" : "人格倾向雷达图"}</>}>
                <RadarPanel scores={detail.score?.radar_scores} />
                <Typography.Paragraph type="secondary">
                  {detail.score?.norm_reference
                    ? `${detail.score.norm_reference.sample_label}（N=${detail.score.norm_reference.sample_size}）。${detail.score.norm_reference.sample_note}`
                    : "人格倾向用于描述风格，不进入职场行为总分。"}
                </Typography.Paragraph>
              </Card>
              <Card title={detail.score?.rules_version !== "personality-v1" ? "六项工作倾向" : "五项职场行为维度"}>
                <div className="assessment-behavior-bars">
                  {Object.entries(detail.score?.behavior_scores || {}).map(([name, value]) => (
                    <div key={name}><span><strong>{name}</strong><em>{detail.score?.behavior_bands?.[name] || value}</em></span><Progress percent={value} showInfo={false} strokeColor="#1f6a5d" /></div>
                  ))}
                </div>
                <Alert type="info" showIcon title={detail.score?.rules_version !== "personality-v1" ? "解释边界" : "总分规则"} description={detail.score?.overall_basis} />
              </Card>
            </div>

            <Card
              className="assessment-ai-card"
              title={<><RobotOutlined /> AI 面试辅助分析</>}
              extra={<Button type="primary" icon={<ApiOutlined />} loading={aiLoading} onClick={() => runAI(!!detail.ai_report)}>{detail.ai_report ? "重新生成" : "生成分析"}</Button>}
            >
              {detail.ai_report ? (
                <div className="assessment-ai-report">
                  <Typography.Paragraph className="assessment-ai-summary">{detail.ai_report.overall_summary}</Typography.Paragraph>
                  <Row gutter={[20, 20]}>
                    <Col xs={24} md={12}><h4>3 项优势信号</h4><ol>{detail.ai_report.strengths?.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
                    <Col xs={24} md={12}><h4>3 项面试核实点</h4><ol>{detail.ai_report.verification_points?.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
                    <Col span={24}><h4>5 个建议追问</h4><ol className="assessment-interview-list">{detail.ai_report.interview_questions?.map((item, index) => <li key={index}>{item}</li>)}</ol></Col>
                  </Row>
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击生成后，AI 只会读取确定性维度、情境作答和可信度，不会读取姓名、电话、年龄等信息。" />
              )}
            </Card>

            <Card title={`${detail.score?.rules_version !== "personality-v1" ? "面试核实线索" : "风险证据"}（${detail.score?.risks?.length || 0}）`}>
              {detail.score?.risks?.length ? (
                <div className="assessment-risk-list">
                  {detail.score.risks.map((risk) => (
                    <div key={risk.id}>
                      <Tag color={detail.score?.rules_version !== "personality-v1" ? "blue" : "red"}>{risk.question_id}</Tag>
                      <strong>{risk.label}</strong>
                      <p>{risk.prompt}</p>
                      <span className="assessment-risk-answer">{detail.score?.rules_version !== "personality-v1" ? "汇总结果" : "填写人选择"}：{risk.answer_label}</span>
                    </div>
                  ))}
                </div>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有需要单独标记的极端取舍" />}
            </Card>

            <Card title="逐题作答明细">
              <Table rowKey="question_id" size="small" pagination={false} columns={answerColumns} dataSource={detail.answer_details || []} scroll={{ x: 760 }} />
            </Card>
          </div>
        )}
      </Drawer>
    </div>
  );
}
