import { App as AntdApp, Button, Form, InputNumber, Input, Modal, Space, Switch, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { adminListPointRules, adminUpdatePointRule } from "../../../lib/api.points";

const CATEGORY_LABELS = {
  training: { label: "AI对练", color: "blue" },
  course: { label: "课程", color: "green" },
  reading: { label: "读书打卡", color: "purple" },
  paper: { label: "考试", color: "magenta" },
  exam: { label: "AI通关", color: "volcano" },
  manual: { label: "手动", color: "default" },
};

export default function RulesTab() {
  const { message } = AntdApp.useApp();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListPointRules();
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const toggleEnabled = async (rule, enabled) => {
    try {
      await adminUpdatePointRule(rule.id, { enabled });
      setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    } catch (err) {
      message.error(err?.message || "更新失败。");
    }
  };

  const columns = [
    {
      title: "分类",
      dataIndex: "category",
      width: 120,
      render: (v) => {
        const meta = CATEGORY_LABELS[v] || { label: v || "未分类", color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: "标识符", dataIndex: "code", width: 180, render: (v) => <code style={{ fontSize: 12 }}>{v}</code> },
    { title: "名称", dataIndex: "name" },
    {
      title: "积分",
      dataIndex: "points",
      width: 90,
      render: (v) => (
        <span style={{ color: v >= 0 ? "#1677ff" : "#ff4d4f", fontWeight: 600 }}>
          {v >= 0 ? `+${v}` : v}
        </span>
      ),
    },
    {
      title: "每日上限",
      dataIndex: "daily_limit",
      width: 100,
      render: (v) => (v > 0 ? `${v} 次` : "不限"),
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (v, row) => (
        <Switch
          checked={!!v}
          onChange={(c) => toggleEnabled(row, c)}
          disabled={row.code === "manual_adjust"}
        />
      ),
    },
    { title: "说明", dataIndex: "description", ellipsis: true },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_, row) => (
        <Button size="small" onClick={() => setEditing(row)}>编辑</Button>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 12, color: "var(--text-mute)" }}>
        修改积分值或启用状态会立即生效，仅影响新事件；已入账的流水不受影响。规则标识符（code）由系统维护，不可修改。
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rules}
        columns={columns}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `共 ${total} 条规则`,
        }}
      />
      {editing ? (
        <RuleEditModal
          rule={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
    </>
  );
}

function RuleEditModal({ rule, onCancel, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const initial = useMemo(() => ({
    name: rule.name,
    points: rule.points,
    daily_limit: rule.daily_limit,
    enabled: rule.enabled,
    description: rule.description || "",
  }), [rule]);

  const submit = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSubmitting(true);
    try {
      await adminUpdatePointRule(rule.id, {
        name: values.name,
        points: Number(values.points || 0),
        daily_limit: Number(values.daily_limit || 0),
        enabled: !!values.enabled,
        description: values.description || "",
      });
      message.success("已更新。");
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
      title={`编辑规则：${rule.name}`}
      onCancel={onCancel}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={initial} preserve={false}>
        <Form.Item label="标识符 (code)">
          <Input value={rule.code} disabled />
        </Form.Item>
        <Form.Item label="规则名称" name="name" rules={[{ required: true, message: "请输入" }]}>
          <Input maxLength={128} />
        </Form.Item>
        <Form.Item label="默认积分（可负数表示扣分）" name="points" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="每日上限（0 表示不限）" name="daily_limit">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="规则说明" name="description">
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
