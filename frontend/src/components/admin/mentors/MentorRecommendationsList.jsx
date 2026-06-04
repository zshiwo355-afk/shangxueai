import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { useEffect, useState } from "react";

import {
  adminCreateMentorRecommendation,
  adminDeleteMentorRecommendation,
  adminListMentorRecommendations,
  adminUpdateMentorRecommendation,
} from "../../../lib/api.mentors";

const TARGET_TYPE_OPTIONS = [
  { label: "课程视频", value: "video" },
  { label: "读书内容", value: "reading" },
  { label: "考试试卷", value: "paper" },
  { label: "外部链接", value: "link" },
];

const TARGET_COLOR = {
  video: "blue",
  reading: "purple",
  paper: "magenta",
  link: "default",
};

export default function MentorRecommendationsList({ mentorId }) {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListMentorRecommendations(mentorId);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [mentorId]);

  const remove = async (row) => {
    try {
      await adminDeleteMentorRecommendation(mentorId, row.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const columns = [
    {
      title: "类型",
      dataIndex: "target_type",
      width: 100,
      render: (v) => {
        const meta = TARGET_TYPE_OPTIONS.find((o) => o.value === v);
        return <Tag color={TARGET_COLOR[v] || "default"}>{meta?.label || v}</Tag>;
      },
    },
    {
      title: "目标",
      key: "target",
      render: (_, r) => {
        if (r.target_type === "link") {
          return <a href={r.link_url} target="_blank" rel="noopener noreferrer">{r.link_url}</a>;
        }
        return <span>#{r.target_id || "—"}</span>;
      },
    },
    { title: "标题", dataIndex: "title", render: (v) => v || <span style={{ color: "var(--text-mute)" }}>使用资源原标题</span> },
    { title: "导师寄语", dataIndex: "note", ellipsis: true },
    { title: "排序", dataIndex: "sort_order", width: 80 },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (v) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: "操作",
      key: "action",
      width: 160,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(row)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <strong>推荐内容</strong>
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ __new: true })}>
          新增推荐
        </Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
      />
      {editing ? (
        <RecommendationEditModal
          key={editing.__new ? "new" : `e-${editing.id}`}
          mentorId={mentorId}
          record={editing.__new ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
    </div>
  );
}

function RecommendationEditModal({ mentorId, record, onCancel, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [targetType, setTargetType] = useState(record?.target_type || "video");

  const initial = {
    target_type: record?.target_type || "video",
    target_id: record?.target_id || undefined,
    link_url: record?.link_url || "",
    title: record?.title || "",
    note: record?.note || "",
    sort_order: record?.sort_order ?? 100,
    enabled: record ? !!record.enabled : true,
  };

  const submit = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSubmitting(true);
    try {
      const payload = {
        target_type: values.target_type,
        target_id: values.target_type === "link" ? null : Number(values.target_id || 0),
        link_url: values.target_type === "link" ? (values.link_url || "").trim() : "",
        title: (values.title || "").trim(),
        note: (values.note || "").trim(),
        sort_order: Number(values.sort_order || 0),
        enabled: !!values.enabled,
      };
      if (record) {
        await adminUpdateMentorRecommendation(mentorId, record.id, payload);
        message.success("已更新。");
      } else {
        await adminCreateMentorRecommendation(mentorId, payload);
        message.success("已新增。");
      }
      onSaved();
    } catch (err) {
      message.error(err?.message || "保存失败。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title={record ? "编辑推荐" : "新增推荐"}
      onCancel={onCancel}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={initial}>
        <Form.Item label="类型" name="target_type" rules={[{ required: true }]}>
          <Select options={TARGET_TYPE_OPTIONS} onChange={setTargetType} />
        </Form.Item>
        {targetType !== "link" ? (
          <Form.Item
            label="资源 ID"
            name="target_id"
            rules={[{ required: true, message: "请输入" }]}
            extra="可在对应资源管理页面查看 ID。"
          >
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
        ) : (
          <Form.Item
            label="外部链接"
            name="link_url"
            rules={[{ required: true, message: "请输入完整 URL" }]}
          >
            <Input maxLength={2048} placeholder="https://..." />
          </Form.Item>
        )}
        <Form.Item label="展示标题（可选）" name="title" extra="留空则使用目标资源的原标题。">
          <Input maxLength={255} />
        </Form.Item>
        <Form.Item label="导师寄语（可选）" name="note">
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
        <Form.Item label="排序" name="sort_order">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
