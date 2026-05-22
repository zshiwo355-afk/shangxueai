import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, DownloadOutlined, ImportOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  attachQuestionsToPaper,
  buildImportTemplateUrl,
  getPaperDetail,
  listQuestionBank,
  removePaperQuestion,
  reorderPaperQuestions,
} from "../../../lib/api.papers";
import ImportQuestionsModal from "./ImportQuestionsModal";

const { Text } = Typography;

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

export default function PaperEditorDrawer({ paperId, open, onClose, onChanged }) {
  const { message } = AntdApp.useApp();
  const [detail, setDetail] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const reload = async () => {
    if (!paperId) return;
    try {
      const data = await getPaperDetail(paperId);
      setDetail(data);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    }
  };

  useEffect(() => {
    if (open) reload();
    else setDetail(null);
  }, [open, paperId]);

  const move = async (idx, delta) => {
    if (!detail) return;
    const arr = [...detail.questions];
    const target = idx + delta;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    const items = arr.map((q, i) => ({
      id: q.id,
      sort_order: (i + 1) * 10,
    }));
    try {
      const updated = await reorderPaperQuestions(paperId, { items });
      setDetail(updated);
      onChanged?.();
    } catch (err) {
      message.error(err?.message || "调整顺序失败。");
    }
  };

  const updateScore = async (q, value) => {
    if (value === null || value === undefined) return;
    if (value <= 0) {
      message.warning("单题分值需大于 0。");
      return;
    }
    try {
      const updated = await reorderPaperQuestions(paperId, {
        items: [{ id: q.id, sort_order: q.sort_order, score_override: Number(value) }],
      });
      setDetail(updated);
      onChanged?.();
    } catch (err) {
      message.error(err?.message || "更新分值失败。");
    }
  };

  const remove = async (q) => {
    try {
      const updated = await removePaperQuestion(paperId, q.id);
      setDetail(updated);
      onChanged?.();
      message.success("已移除。");
    } catch (err) {
      message.error(err?.message || "移除失败。");
    }
  };

  const onAttach = async (ids) => {
    if (!ids?.length) return;
    try {
      const updated = await attachQuestionsToPaper(paperId, { question_ids: ids });
      setDetail(updated);
      setPickerOpen(false);
      onChanged?.();
      message.success(`已加入 ${ids.length} 题（重复题已跳过）。`);
    } catch (err) {
      message.error(err?.message || "加题失败。");
    }
  };

  const summary = detail?.paper;
  const questions = detail?.questions || [];

  const columns = [
    { title: "序号", width: 60, render: (_, __, i) => i + 1 },
    {
      title: "题型",
      width: 80,
      render: (_, row) => <Tag bordered={false} color={TYPE_COLOR[row.question_type]}>{row.question_type_label}</Tag>,
    },
    {
      title: "题干",
      ellipsis: true,
      render: (_, row) => <span style={{ whiteSpace: "pre-wrap" }}>{row.stem}</span>,
    },
    {
      title: "本卷分值",
      width: 110,
      render: (_, row) => (
        <InputNumber
          size="small"
          min={0.5}
          step={0.5}
          defaultValue={row.score}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v) && v !== row.score) updateScore(row, v);
          }}
          style={{ width: 80 }}
        />
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 200,
      render: (_, row, idx) => (
        <Space>
          <Button size="small" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => move(idx, -1)} />
          <Button size="small" icon={<ArrowDownOutlined />} disabled={idx === questions.length - 1} onClick={() => move(idx, 1)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(row)}>移除</Button>
        </Space>
      ),
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={1080}
      title={summary ? `${summary.title} · 组卷` : "组卷"}
      destroyOnHidden
    >
      {summary ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Tag color="blue">题数 {summary.question_count}</Tag>
            <Tag color="green">合计 {summary.total_score} 分</Tag>
            <Tag>及格 {summary.pass_score} 分</Tag>
            <Tag color="purple">客观 {summary.objective_count}</Tag>
            <Tag color="orange">简答 {summary.subjective_count}</Tag>
            {summary.needs_manual_review ? <Tag color="gold">含人工复核</Tag> : null}
          </Space>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <Text type="secondary">
              支持两种方式加题：从「题库挑题」勾选已有题目，或直接上传 Excel/Word 文件，导入后自动加入本卷。
            </Text>
            <Space wrap>
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
              <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
                直接导入题目
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setPickerOpen(true)}>
                题库挑题
              </Button>
            </Space>
          </div>

          {questions.length ? (
            <Table rowKey="id" dataSource={questions} columns={columns} pagination={false} size="small" />
          ) : (
            <Empty description="尚未挑题" />
          )}
        </Space>
      ) : null}

      <QuestionPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onAttach={onAttach} excludeIds={questions.map((q) => q.question_id)} />

      <ImportQuestionsModal
        open={importOpen}
        paperId={paperId}
        title="导入题目并加入本试卷"
        onClose={() => setImportOpen(false)}
        onCommitted={() => {
          setImportOpen(false);
          reload();
          onChanged?.();
        }}
      />
    </Drawer>
  );
}

function QuestionPicker({ open, onClose, onAttach, excludeIds }) {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState([]);

  const reload = async () => {
    setLoading(true);
    try {
      const d = await listQuestionBank({ page, page_size: pageSize, ...filters });
      setData({ items: d.items || [], total: d.total || 0 });
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
    else { setSelected([]); setFilters({}); setPage(1); }
  }, [open, page, pageSize, filters]);

  const excludeSet = useMemo(() => new Set(excludeIds || []), [excludeIds]);

  const columns = [
    { title: "ID", dataIndex: "id", width: 60 },
    {
      title: "题型",
      width: 80,
      render: (_, row) => <Tag bordered={false} color={TYPE_COLOR[row.question_type]}>{row.question_type_label}</Tag>,
    },
    {
      title: "题干",
      ellipsis: true,
      render: (_, row) => row.stem,
    },
    { title: "分类", dataIndex: "category", width: 100 },
    { title: "默认分", dataIndex: "default_score", width: 70 },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={() => onAttach(selected)}
      okText={`加入本卷（${selected.length}）`}
      okButtonProps={{ disabled: !selected.length }}
      cancelText="取消"
      width={900}
      title="题库挑题"
      destroyOnHidden
    >
      <Space style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <Select
          allowClear
          placeholder="按题型筛选"
          style={{ width: 140 }}
          options={QUESTION_TYPES}
          onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, question_type: v })); }}
        />
        <Input.Search
          placeholder="按题干 / 标签 关键词"
          allowClear
          style={{ width: 240 }}
          onSearch={(v) => { setPage(1); setFilters((f) => ({ ...f, keyword: v })); }}
        />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data.items}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: setSelected,
          getCheckboxProps: (row) => ({ disabled: excludeSet.has(row.id) }),
        }}
      />
    </Modal>
  );
}
