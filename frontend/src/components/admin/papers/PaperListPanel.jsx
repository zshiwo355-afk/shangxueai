import { DeleteOutlined, EditOutlined, EyeOutlined, InboxOutlined, PlusOutlined, RedoOutlined, SendOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  bulkDeletePapers,
  bulkSetPaperStatus,
  createPaper,
  deletePaper,
  listPapers,
  publishPaper,
  updatePaper,
} from "../../../lib/api.papers";
import dayjs from "dayjs";
import PaperEditorDrawer from "./PaperEditorDrawer";

const STATUS_TAG = {
  draft: { color: "default", text: "草稿" },
  published: { color: "green", text: "已发布" },
  archived: { color: "default", text: "已归档" },
};

export default function PaperListPanel() {
  const { message, modal } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editingPaperId, setEditingPaperId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await listPapers({ page, page_size: pageSize });
      setItems(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
      setTotal(Number(data?.total ?? (Array.isArray(data) ? data.length : 0)));
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [page, pageSize]);

  const remove = async (item) => {
    try {
      await deletePaper(item.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const setStatus = async (item, status) => {
    try {
      await updatePaper(item.id, { status });
      message.success(status === "archived" ? "已归档。" : status === "published" ? "已重新发布。" : "已恢复为草稿。");
      reload();
    } catch (err) {
      message.error(err?.message || "更新状态失败。");
    }
  };

  const publish = async (item) => {
    if (item.question_count <= 0) {
      message.warning("尚未挑题，无法发布。");
      return;
    }
    modal.confirm({
      title: "确认发布该试卷？",
      content: "发布后才能派发给用户。",
      okText: "发布",
      cancelText: "取消",
      onOk: async () => {
        try {
          await publishPaper(item.id);
          message.success("已发布。");
          reload();
        } catch (err) {
          message.error(err?.message || "发布失败。");
        }
      },
    });
  };

  const runBulkStatus = async (status, label) => {
    try {
      const res = await bulkSetPaperStatus(selectedIds, status);
      const updated = Number(res?.updated || 0);
      const skipped = Number(res?.skipped_count || 0);
      if (updated > 0) {
        message.success(skipped > 0 ? `${label} ${updated} 份；${skipped} 份被跳过。` : `已${label} ${updated} 份试卷。`);
      } else if (skipped > 0) {
        message.warning(`全部 ${skipped} 份被跳过（发布需先挑题）。`);
      }
      setSelectedIds([]);
      reload();
    } catch (err) {
      message.error(err?.message || "批量更新失败。");
    }
  };

  const runBulkDelete = async () => {
    try {
      const res = await bulkDeletePapers(selectedIds);
      const deleted = Number(res?.deleted || 0);
      const skipped = Number(res?.skipped_count || 0);
      if (deleted > 0) {
        message.success(skipped > 0 ? `已删除 ${deleted} 份；${skipped} 份已派发，请改用归档。` : `已删除 ${deleted} 份试卷。`);
      } else if (skipped > 0) {
        message.warning(`全部 ${skipped} 份已派发，无法删除（请改用归档）。`);
      }
      setSelectedIds([]);
      reload();
    } catch (err) {
      message.error(err?.message || "批量删除失败。");
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 60 },
    { title: "标题", dataIndex: "title", width: 220, ellipsis: true },
    { title: "题数", dataIndex: "question_count", width: 70 },
    {
      title: "题型分布",
      key: "types",
      width: 130,
      render: (_, row) => (
        <Space size={4}>
          <Tag color="blue" bordered={false}>客观 {row.objective_count}</Tag>
          <Tag color="orange" bordered={false}>简答 {row.subjective_count}</Tag>
        </Space>
      ),
    },
    { title: "总分", dataIndex: "total_score", width: 70 },
    { title: "及格", dataIndex: "pass_score", width: 70 },
    {
      title: "需复核",
      dataIndex: "needs_manual_review",
      width: 80,
      render: (v) => v ? <Tag color="gold">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v) => {
        const cfg = STATUS_TAG[v] || { color: "default", text: v };
        return <Tag color={cfg.color} bordered={false}>{cfg.text}</Tag>;
      },
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 150,
      sorter: (a, b) => dayjs(a.updated_at || a.created_at || 0).valueOf() - dayjs(b.updated_at || b.created_at || 0).valueOf(),
      defaultSortOrder: "descend",
      render: (_, row) => {
        const t = row.updated_at || row.created_at;
        return t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—";
      },
    },
    {
      title: "操作",
      key: "action",
      width: 380,
      fixed: "right",
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setEditingPaperId(row.id)}>组卷</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ mode: "edit", item: row })}>编辑</Button>
          {row.status === "draft" ? (
            <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => publish(row)}>发布</Button>
          ) : null}
          {row.status === "published" ? (
            <Popconfirm title="确认归档该试卷？" description="归档后不再出现在派发列表中。" onConfirm={() => setStatus(row, "archived")} okText="归档" cancelText="取消">
              <Button size="small" icon={<InboxOutlined />}>归档</Button>
            </Popconfirm>
          ) : null}
          {row.status === "archived" ? (
            <Button size="small" icon={<RedoOutlined />} onClick={() => setStatus(row, "published")}>重新发布</Button>
          ) : null}
          <Popconfirm title="确认删除该试卷？" description="已派发的试卷请改为归档。" onConfirm={() => remove(row)} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-mute)" }}>共 {items.length} 份试卷</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mode: "create" })}>新建试卷</Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: setSelectedIds,
          preserveSelectedRowKeys: true,
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
          pageSizeOptions: ["10", "20", "50", "100"],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        scroll={{ x: 1320 }}
      />

      {selectedIds.length > 0 ? (
        <div className="bulk-action-bar">
          <span className="bulk-action-bar__count">
            已选 <strong>{selectedIds.length}</strong> 份试卷
          </span>
          <div className="bulk-action-bar__actions">
            <Button onClick={() => setSelectedIds([])}>取消选择</Button>
            <Button icon={<SendOutlined />} onClick={() => runBulkStatus("published", "发布")}>批量发布</Button>
            <Button icon={<InboxOutlined />} onClick={() => runBulkStatus("archived", "归档")}>批量归档</Button>
            <Button icon={<RedoOutlined />} onClick={() => runBulkStatus("draft", "改为草稿")}>转为草稿</Button>
            <Popconfirm
              title={`确认删除选中的 ${selectedIds.length} 份试卷？`}
              description="已派发的试卷会被自动跳过；该操作不可撤销。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={runBulkDelete}
            >
              <Button danger icon={<DeleteOutlined />}>批量删除</Button>
            </Popconfirm>
          </div>
        </div>
      ) : null}

      {editing ? (
        <PaperEditModal
          key={editing.mode === "edit" ? `edit-${editing.item.id}` : "create"}
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            reload();
            if (created?.id) setEditingPaperId(created.id);
          }}
        />
      ) : null}

      <PaperEditorDrawer
        paperId={editingPaperId}
        open={!!editingPaperId}
        onClose={() => setEditingPaperId(null)}
        onChanged={reload}
      />
    </>
  );
}

function PaperEditModal({ editing, onCancel, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  const initialValues = useMemo(() => {
    if (editing.mode === "create") {
      return {
        pass_score: 60,
        duration_minutes: 0,
        auto_grade_objective: true,
        manual_review_subjective: false,
        shuffle_questions: false,
        show_answer_after: "after_submit",
      };
    }
    const item = editing.item;
    return {
      title: item.title,
      description: item.description,
      pass_score: item.pass_score,
      duration_minutes: item.duration_minutes,
      auto_grade_objective: item.auto_grade_objective,
      manual_review_subjective: item.manual_review_subjective,
      shuffle_questions: item.shuffle_questions,
      show_answer_after: item.show_answer_after,
    };
  }, [editing]);

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      if (editing.mode === "create") {
        const created = await createPaper(values);
        message.success("已创建。");
        onSaved(created);
      } else {
        await updatePaper(editing.item.id, values);
        message.success("已更新。");
        onSaved(null);
      }
    } catch (err) {
      message.error(err?.message || "保存失败。");
    }
  };

  return (
    <Modal
      open
      title={editing.mode === "create" ? "新建试卷" : "编辑试卷"}
      onCancel={onCancel}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      width={620}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues}>
        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
          <Input placeholder="如：销售认证模拟考 2026Q2" maxLength={120} />
        </Form.Item>
        <Form.Item label="说明" name="description">
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item label="及格分" name="pass_score" rules={[{ required: true }]}>
              <InputNumber min={0} step={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="限时（分钟，0=不限）" name="duration_minutes">
              <InputNumber min={0} step={5} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Space wrap size={24}>
          <Form.Item label="客观题自动判分" name="auto_grade_objective" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="简答题人工复核" name="manual_review_subjective" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="题目顺序打乱" name="shuffle_questions" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <div style={{ marginTop: 4, color: "var(--text-secondary, #6b7280)", fontSize: 13, lineHeight: 1.7 }}>
          说明：关闭主观题人工复核后，学员提交会优先采用 AI 评分直接出成绩；开启后，主观题需要管理员复核后才会生成最终成绩。
        </div>
      </Form>
    </Modal>
  );
}
