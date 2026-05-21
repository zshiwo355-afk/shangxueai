import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tabs, Tag, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import {
  adminCreateOption,
  adminDeleteOption,
  adminListOptions,
  adminUpdateOption,
} from "../../lib/api.options";

const CATEGORY_TABS = [
  { key: "training_type", label: "训练类型" },
  { key: "difficulty", label: "难度" },
  { key: "customer_type", label: "客户类型" },
];

function CategoryTable({ category }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListOptions(category);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [category]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ enabled: true, sort_order: (items.length + 1) * 10 });
    setEditing({ mode: "create" });
  };
  const openEdit = (item) => {
    form.resetFields();
    form.setFieldsValue({ value: item.value, sort_order: item.sort_order, enabled: item.enabled });
    setEditing({ mode: "edit", item });
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing.mode === "create") {
        await adminCreateOption({ category, ...values });
        message.success("已新增。");
      } else {
        await adminUpdateOption(editing.item.id, values);
        message.success("已更新。");
      }
      setEditing(null);
      reload();
    } catch (err) {
      message.error(err?.message || "保存失败。");
    }
  };

  const toggleEnabled = async (item, enabled) => {
    try {
      await adminUpdateOption(item.id, { enabled });
      reload();
    } catch (err) {
      message.error(err?.message || "更新失败。");
    }
  };

  const remove = async (item) => {
    try {
      await adminDeleteOption(item.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 80 },
    { title: "选项值", dataIndex: "value" },
    { title: "排序", dataIndex: "sort_order", width: 80 },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 100,
      render: (v, row) => <Switch checked={!!v} onChange={(checked) => toggleEnabled(row, checked)} />,
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm title="确认删除该选项？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-mute)" }}>共 {items.length} 项</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增选项</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={false} />

      <Modal
        open={!!editing}
        title={editing?.mode === "create" ? "新增选项" : "编辑选项"}
        onCancel={() => setEditing(null)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="选项值" name="value" rules={[{ required: true, message: "请输入" }]}>
            <Input placeholder="例如：初购转化" />
          </Form.Item>
          <Form.Item label="排序（升序）" name="sort_order" initialValue={0}>
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function OptionsTab() {
  const [activeKey, setActiveKey] = useState("training_type");

  return (
    <Tabs
      activeKey={activeKey}
      onChange={setActiveKey}
      items={CATEGORY_TABS.map((t) => ({
        key: t.key,
        label: t.label,
        children: <CategoryTable category={t.key} />,
      }))}
    />
  );
}
