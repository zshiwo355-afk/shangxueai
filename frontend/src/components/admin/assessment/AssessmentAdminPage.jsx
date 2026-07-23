import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  ReadOutlined,
  ShareAltOutlined,
  StopOutlined,
  UserDeleteOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";

import AssessmentReport from "../../assessment/AssessmentReport";
import { copyText } from "../../../lib/clipboard";
import {
  anonymizeAssessmentSubmission,
  createAssessmentForm,
  deleteAssessmentForm,
  deleteAssessmentSubmissions,
  duplicateAssessmentForm,
  generateAssessmentAI,
  getAssessmentQuestionnaire,
  getAssessmentSubmission,
  listAssessmentForms,
  listAssessmentSubmissions,
  markAssessmentOfficial,
  disableAssessmentShare,
  enableAssessmentShare,
  setAssessmentFormStatus,
  updateAssessmentForm,
} from "../../../lib/api.assessments";
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
  const [pageSize, setPageSize] = useState(20);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState([]);
  const [deletingSubmissions, setDeletingSubmissions] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
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
      setSelectedId((current) => {
        const candidate = preferredId || current;
        return rows.some((row) => row.id === candidate) ? candidate : rows[0]?.id || null;
      });
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
    listAssessmentSubmissions(selectedId, { search, page, page_size: pageSize })
      .then((result) => { if (active) setSubmissions(result); })
      .catch((error) => { if (active) message.error(error.message); })
      .finally(() => { if (active) setLoadingSubmissions(false); });
    return () => { active = false; };
  }, [message, page, pageSize, search, selectedId]);

  useEffect(() => { setSelectedSubmissionIds([]); }, [page, pageSize, search, selectedId]);

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

  const removeForm = async (form) => {
    try {
      const result = await deleteAssessmentForm(form.id);
      setPage(1);
      setSelectedSubmissionIds([]);
      setDetailOpen(false);
      setDetail(null);
      await refreshForms();
      message.success(`表单已删除，同时删除 ${result.deleted_submissions || 0} 份答卷和 ${result.deleted_drafts || 0} 份草稿。`);
    } catch (error) {
      message.error(error.message);
    }
  };

  const removeSelectedSubmissions = async () => {
    if (!selectedId || !selectedSubmissionIds.length) return;
    setDeletingSubmissions(true);
    try {
      const result = await deleteAssessmentSubmissions(selectedId, selectedSubmissionIds);
      const remaining = Math.max(0, submissions.total - result.deleted);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(remaining / pageSize)));
      setSelectedSubmissionIds([]);
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        setSubmissions(await listAssessmentSubmissions(selectedId, { search, page, page_size: pageSize }));
      }
      await refreshForms(selectedId);
      message.success(`已永久删除 ${result.deleted} 份答卷。`);
    } catch (error) {
      message.error(error.message);
    } finally {
      setDeletingSubmissions(false);
    }
  };

  const copyLink = async (form) => {
    const link = `${window.location.origin}${form.public_path}`;
    try {
      if (!await copyText(link)) throw new Error("复制失败");
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
    if (selectedId) setSubmissions(await listAssessmentSubmissions(selectedId, { search, page, page_size: pageSize }));
    await refreshForms(selectedId);
  };

  const runAI = async (regenerate = false) => {
    if (!detail) return;
    setAiLoading(true);
    try {
      const aiReport = await generateAssessmentAI(detail.id, regenerate);
      setDetail((current) => ({ ...current, ai_report: aiReport, ai_report_is_current: true, has_ai_report: true }));
      message.success("AI 分析已生成。 ");
    } catch (error) {
      message.error(error.message);
    } finally {
      setAiLoading(false);
    }
  };

  const shareLink = detail?.share?.path ? `${window.location.origin}${detail.share.path}` : "";

  const copyShareLink = async () => {
    try {
      if (!await copyText(shareLink)) throw new Error("复制失败");
      message.success("分享链接已复制。 ");
    } catch {
      message.info(shareLink);
    }
  };

  const enableShare = async (regenerate = false) => {
    if (!detail) return;
    setShareLoading(true);
    try {
      const share = await enableAssessmentShare(detail.id, regenerate);
      setDetail((current) => ({ ...current, share }));
      message.success(regenerate ? "已生成新链接，原链接已失效。" : "分享链接已启用。 ");
    } catch (error) {
      message.error(error.message);
    } finally {
      setShareLoading(false);
    }
  };

  const disableShare = async () => {
    if (!detail) return;
    setShareLoading(true);
    try {
      const share = await disableAssessmentShare(detail.id);
      setDetail((current) => ({ ...current, share }));
      message.success("分享链接已停用。 ");
    } catch (error) {
      message.error(error.message);
    } finally {
      setShareLoading(false);
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
      width: 410,
      render: (_, record) => (
        <Space wrap onClick={(event) => event.stopPropagation()}>
          <Button size="small" icon={<LinkOutlined />} onClick={() => copyLink(record)}>复制链接</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(record)}>设置</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => duplicate(record)}>复制表单</Button>
          <Button size="small" danger={record.status === "active"} onClick={() => toggleStatus(record)}>
            {record.status === "active" ? "停用" : "启用"}
          </Button>
          <Popconfirm
            title={`永久删除“${record.title}”？`}
            description={`将同时删除 ${record.submission_count || 0} 份已提交答卷和 ${record.draft_count || 0} 份草稿，且无法恢复。`}
            okText="永久删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => removeForm(record)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
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
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="姓名 / 手机 / 岗位"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onSearch={(value) => { setSearch(value.trim()); setPage(1); }}
              style={{ width: 230 }}
            />
            <Popconfirm
              title={`永久删除选中的 ${selectedSubmissionIds.length} 份答卷？`}
              description="答卷、计分结果和 AI 分析将一并删除，且无法恢复。"
              okText="永久删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={!selectedSubmissionIds.length}
              onConfirm={removeSelectedSubmissions}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={!selectedSubmissionIds.length}
                loading={deletingSubmissions}
              >
                删除选中{selectedSubmissionIds.length ? `（${selectedSubmissionIds.length}）` : ""}
              </Button>
            </Popconfirm>
            <Button icon={<LinkOutlined />} onClick={() => copyLink(selectedForm)}>公开链接</Button>
          </Space>
        ) : null}
      >
        <Table
          rowKey="id"
          loading={loadingSubmissions}
          columns={submissionColumns}
          dataSource={submissions.items}
          rowSelection={{
            selectedRowKeys: selectedSubmissionIds,
            onChange: setSelectedSubmissionIds,
          }}
          scroll={{ x: 980 }}
          pagination={{
            current: page,
            pageSize,
            total: submissions.total,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            showTotal: (total) => `共 ${total} 份答卷`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1);
              setPageSize(nextPageSize);
            },
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
        width="min(1020px, 100vw)"
        rootClassName="assessment-detail-drawer"
        title={detail ? `${detail.name || "已匿名"} · 答卷 #${detail.id}` : "答卷详情"}
        extra={detail ? (
          <Space wrap className="assessment-detail-actions">
            <Button icon={<ShareAltOutlined />} disabled={!!detail.anonymized_at} onClick={() => setShareOpen(true)}>分享报告</Button>
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
          <AssessmentReport detail={detail} aiLoading={aiLoading} onRunAI={runAI} />
        )}
      </Drawer>

      <Modal
        open={shareOpen}
        onCancel={() => setShareOpen(false)}
        title="分享报告"
        rootClassName="assessment-share-modal"
        footer={null}
        destroyOnHidden
      >
        {detail?.share?.enabled ? (
          <div className="assessment-share-panel">
            <Alert
              showIcon
              type="success"
              title="分享链接已启用"
              description={`有效期至 ${new Date(detail.share.expires_at).toLocaleString("zh-CN")}`}
            />
            <Input readOnly value={shareLink} />
            <Space wrap className="assessment-share-actions">
              <Button type="primary" icon={<CopyOutlined />} onClick={copyShareLink}>复制链接</Button>
              <Popconfirm title="重新生成后，原链接将立即失效。" onConfirm={() => enableShare(true)}>
                <Button loading={shareLoading}>重新生成</Button>
              </Popconfirm>
              <Popconfirm title="停用后，该链接将无法继续访问。" onConfirm={disableShare}>
                <Button danger loading={shareLoading}>停用链接</Button>
              </Popconfirm>
            </Space>
          </div>
        ) : (
          <div className="assessment-share-panel">
            <Alert
              showIcon
              type="info"
              title={detail?.share?.expired ? "分享链接已过期" : "分享链接未启用"}
              description="启用后生成一个30天有效的免登录只读链接。"
            />
            <Button type="primary" icon={<ShareAltOutlined />} loading={shareLoading} onClick={() => enableShare(false)}>启用链接</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
