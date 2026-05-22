import { DeleteOutlined, DownloadOutlined, EditOutlined, ImportOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Col,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  buildImportTemplateUrl,
  createQuestion,
  deleteQuestion,
  listQuestionBank,
  updateQuestion,
} from "../../../lib/api.papers";
import ImportQuestionsModal from "./ImportQuestionsModal";

const QUESTION_TYPES = [
  { value: "single", label: "单选" },
  { value: "multiple", label: "多选" },
  { value: "judge", label: "判断" },
  { value: "blank", label: "填空" },
  { value: "short_answer", label: "简答" },
];

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

export default function QuestionBankPanel() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await listQuestionBank({
        page,
        page_size: pageSize,
        ...filters,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, [page, pageSize, filters]);

  const remove = async (item) => {
    try {
      await deleteQuestion(item.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    {
      title: "题型",
      dataIndex: "question_type",
      width: 80,
      render: (v, row) => <Tag bordered={false} color={TYPE_COLOR[v] || "default"}>{row.question_type_label}</Tag>,
    },
    {
      title: "题干",
      dataIndex: "stem",
      ellipsis: true,
      render: (text) => <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>,
    },
    { title: "分类", dataIndex: "category", width: 100 },
    { title: "标签", dataIndex: "tag", width: 100 },
    { title: "分值", dataIndex: "default_score", width: 70 },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (v) => (v === "active" ? <Tag color="green">启用</Tag> : <Tag>归档</Tag>),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 150,
      render: (_, row) => {
        const t = row.updated_at || row.created_at;
        return t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—";
      },
    },
    {
      title: "操作",
      key: "action",
      width: 160,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ mode: "edit", item: row })}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Select
          allowClear
          placeholder="按题型筛选"
          style={{ width: 140 }}
          options={QUESTION_TYPES}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, question_type: v })); }}
        />
        <Input.Search
          placeholder="按题干 / 标签 / 分类 关键词搜索"
          allowClear
          style={{ width: 260 }}
          onSearch={(v) => { setPage(1); setFilters((f) => ({ ...f, keyword: v })); }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mode: "create" })}>新增题目</Button>
        <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>批量导入</Button>
        <Dropdown
          menu={{
            items: [
              {
                key: "xlsx",
                label: (
                  <a href={buildImportTemplateUrl("xlsx")} target="_blank" rel="noreferrer">
                    Excel 模板（.xlsx）
                  </a>
                ),
              },
              {
                key: "docx",
                label: (
                  <a href={buildImportTemplateUrl("docx")} target="_blank" rel="noreferrer">
                    Word 模板（.docx）
                  </a>
                ),
              },
            ],
          }}
        >
          <Button icon={<DownloadOutlined />}>下载模板</Button>
        </Dropdown>
        <span style={{ color: "var(--text-mute)" }}>共 {total} 题</span>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
          pageSizeOptions: ["10", "20", "50", "100"],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        scroll={{ x: 1200 }}
      />

      {editing ? (
        <QuestionEditModal
          key={editing.mode === "edit" ? `edit-${editing.item.id}` : "create"}
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}

      <ImportQuestionsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCommitted={() => { setImportOpen(false); reload(); }}
      />
    </>
  );
}

// 用 key={...} 在父组件控制挂载，这里每次都是全新 Form.useForm() + initialValues，
// 避免 antd Modal destroyOnHidden + Form preserve={false} 下 setFieldsValue 的时序坑。
function QuestionEditModal({ editing, onCancel, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const watchedType = Form.useWatch("question_type", form);
  const watchedOptions = Form.useWatch("options", form);

  const initialValues = useMemo(() => {
    if (editing.mode === "create") {
      return {
        question_type: "single",
        default_score: 5,
        options: ["", "", "", ""],
        correct_answer: [],
        status: "active",
      };
    }
    const item = editing.item;
    return {
      question_type: item.question_type,
      stem: item.stem,
      options: item.question_type === "judge"
        ? ["对", "错"]
        : (item.options?.length ? item.options : ["", ""]),
      correct_answer: item.correct_answer,
      default_score: item.default_score,
      category: item.category,
      tag: item.tag,
      difficulty: item.difficulty,
      explanation: item.explanation,
      status: item.status,
    };
  }, [editing]);

  const handleTypeChange = (value) => {
    if (value === "judge") {
      form.setFieldsValue({ options: ["对", "错"], correct_answer: [] });
    } else if (value === "blank" || value === "short_answer") {
      form.setFieldsValue({ options: [], correct_answer: [] });
    } else {
      const cur = form.getFieldValue("options");
      if (!cur || cur.length < 2) form.setFieldsValue({ options: ["", "", "", ""], correct_answer: [] });
    }
  };

  const correctOptions = useMemo(() => {
    const opts = watchedOptions || [];
    return opts
      .map((o, idx) => ({ value: letterFor(idx), label: `${letterFor(idx)}. ${o || ""}` }))
      .filter((o) => (o.label || "").replace(/\s+/g, "") !== `${o.value}.`);
  }, [watchedOptions]);

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload = {
      ...values,
      options: (values.options || []).filter((o) => (o || "").trim()),
      correct_answer: values.correct_answer || [],
    };
    try {
      if (editing.mode === "create") {
        await createQuestion(payload);
        message.success("已新增。");
      } else {
        await updateQuestion(editing.item.id, payload);
        message.success("已更新。");
      }
      onSaved();
    } catch (err) {
      message.error(err?.message || "保存失败。");
    }
  };

  const showOptions = watchedType !== "blank" && watchedType !== "short_answer";
  const isChoice = watchedType === "single" || watchedType === "multiple";

  return (
    <Modal
      open
      title={editing.mode === "create" ? "新增题目" : "编辑题目"}
      onCancel={onCancel}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      width={720}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues}>
        <Form.Item label="题型" name="question_type" rules={[{ required: true }]}>
          <Select options={QUESTION_TYPES} onChange={handleTypeChange} />
        </Form.Item>
        <Form.Item label="题干" name="stem" rules={[{ required: true, message: "请输入题干" }]}>
          <Input.TextArea rows={3} maxLength={2000} showCount />
        </Form.Item>

        {showOptions ? (
          <Form.List name="options">
            {(fields, { add, remove: rm }) => (
              <>
                <div style={{ marginBottom: 6 }}>
                  选项 {watchedType === "judge" ? '（判断题：仅"对"/"错"，自动填充）' : ""}
                </div>
                {fields.map((field, idx) => (
                  <Space key={field.key} style={{ display: "flex", marginBottom: 8 }} align="baseline">
                    <Tag>{letterFor(idx)}</Tag>
                    <Form.Item
                      {...field}
                      name={field.name}
                      rules={isChoice ? [{ required: true, message: "选项不能为空" }] : []}
                      style={{ marginBottom: 0, flex: 1 }}
                    >
                      <Input style={{ width: 480 }} disabled={watchedType === "judge"} />
                    </Form.Item>
                    {watchedType !== "judge" && fields.length > 2 ? (
                      <Button type="link" danger onClick={() => rm(field.name)}>移除</Button>
                    ) : null}
                  </Space>
                ))}
                {watchedType !== "judge" ? (
                  <Button type="dashed" onClick={() => add("")} disabled={fields.length >= 6}>
                    <PlusOutlined /> 新增选项
                  </Button>
                ) : null}
              </>
            )}
          </Form.List>
        ) : null}

        {isChoice ? (
          <Form.Item
            label="正确答案"
            name="correct_answer"
            rules={[{ required: true, message: "请选择正确答案" }]}
            getValueProps={(v) => {
              if (watchedType === "multiple") return { value: Array.isArray(v) ? v : [] };
              return { value: Array.isArray(v) ? v[0] : v };
            }}
            normalize={(v) => {
              if (watchedType === "multiple") return Array.isArray(v) ? v : v ? [v] : [];
              return v ? [v] : [];
            }}
          >
            <Select
              mode={watchedType === "multiple" ? "multiple" : undefined}
              options={correctOptions}
              placeholder="选择正确答案对应的选项字母"
            />
          </Form.Item>
        ) : null}

        {watchedType === "judge" ? (
          <Form.Item
            label="正确答案"
            name="correct_answer"
            rules={[{ required: true, message: "请选择" }]}
            getValueProps={(v) => ({ value: Array.isArray(v) ? v[0] : v })}
            normalize={(v) => (Array.isArray(v) ? v : v ? [v] : [])}
          >
            <Select options={[{ value: "对", label: "对" }, { value: "错", label: "错" }]} />
          </Form.Item>
        ) : null}

        {watchedType === "blank" ? (
          <Form.List name="correct_answer">
            {(fields, { add, remove: rm }) => (
              <>
                <div style={{ marginBottom: 6 }}>参考答案（多个空各填一行；同一空多备选可在同一行用 / 分隔）</div>
                {fields.map((field, idx) => (
                  <Space key={field.key} style={{ display: "flex", marginBottom: 8 }} align="baseline">
                    <Tag>第{idx + 1}空</Tag>
                    <Form.Item {...field} name={field.name} style={{ marginBottom: 0 }}>
                      <Input style={{ width: 480 }} />
                    </Form.Item>
                    <Button type="link" danger onClick={() => rm(field.name)}>移除</Button>
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add("")}><PlusOutlined /> 新增空</Button>
              </>
            )}
          </Form.List>
        ) : null}

        {watchedType === "short_answer" ? (
          <Form.Item label="参考答案（可选，用于人工评分参考）">
            <Form.List name="correct_answer">
              {(fields, { add, remove: rm }) => (
                <>
                  {fields.map((field, idx) => (
                    <Space key={field.key} style={{ display: "flex", marginBottom: 8 }} align="baseline">
                      <Tag>{idx + 1}</Tag>
                      <Form.Item {...field} name={field.name} style={{ marginBottom: 0 }}>
                        <Input.TextArea rows={2} style={{ width: 480 }} />
                      </Form.Item>
                      <Button type="link" danger onClick={() => rm(field.name)}>移除</Button>
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add("")}><PlusOutlined /> 新增参考答案</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        ) : null}

        <Row gutter={12}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="分值" name="default_score" rules={[{ required: true }]}>
              <InputNumber min={0.5} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="分类" name="category">
              <Input placeholder="如 销售基础" maxLength={64} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="标签" name="tag">
              <Input placeholder="如 礼仪/客户" maxLength={120} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="难度" name="difficulty">
              <Select
                allowClear
                style={{ width: "100%" }}
                options={[
                  { value: "简单", label: "简单" },
                  { value: "中等", label: "中等" },
                  { value: "困难", label: "困难" },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="解析" name="explanation">
          <Input.TextArea rows={2} maxLength={1000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
