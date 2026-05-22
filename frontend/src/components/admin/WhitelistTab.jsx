import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  adminCreateWhitelist,
  adminDeleteWhitelist,
  adminListUsers,
  adminListWhitelist,
  adminUpdateWhitelist,
} from "../../lib/api.admin";

export default function WhitelistTab() {
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const userOptions = useMemo(
    () => users
      .filter((item) => item.role === "user")
      .map((item) => ({
        value: item.id,
        label: `${item.real_name || item.display_name || item.username} (${item.username})`,
      })),
    [users],
  );

  const reload = async () => {
    setLoading(true);
    try {
      const [userData, whitelistData] = await Promise.all([
        adminListUsers(),
        adminListWhitelist(),
      ]);
      setUsers(Array.isArray(userData) ? userData : []);
      setRows(Array.isArray(whitelistData) ? whitelistData : []);
    } catch (error) {
      message.error(error?.message || "白名单加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      auto_checkin_enabled: false,
      course_exempt_enabled: false,
      allow_video_seek: false,
      auto_answer_correct: false,
      remark: "",
    });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      user_id: row.user_id,
      enabled: Boolean(row.enabled),
      auto_checkin_enabled: Boolean(row.auto_checkin_enabled),
      course_exempt_enabled: Boolean(row.course_exempt_enabled),
      allow_video_seek: Boolean(row.allow_video_seek),
      auto_answer_correct: Boolean(row.auto_answer_correct),
      remark: row.remark || "",
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      setSaving(true);
      if (editing?.id) {
        await adminUpdateWhitelist(editing.id, values);
        message.success("白名单已更新。");
      } else {
        await adminCreateWhitelist(values);
        message.success("白名单已创建。");
      }
      closeModal();
      await reload();
    } catch (error) {
      message.error(error?.message || "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    try {
      await adminDeleteWhitelist(row.id);
      message.success("已删除。");
      await reload();
    } catch (error) {
      message.error(error?.message || "删除失败。");
    }
  };

  const columns = [
    { title: "用户", dataIndex: "user_name" },
    { title: "用户名", dataIndex: "username" },
    { title: "部门", dataIndex: "department", render: (value) => value || "—" },
    {
      title: "状态",
      dataIndex: "enabled",
      render: (value) => value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: "能力",
      render: (_, row) => (
        <Space size={[4, 4]} wrap>
          {row.auto_checkin_enabled ? <Tag color="blue">读书自动打卡</Tag> : null}
          {row.course_exempt_enabled ? <Tag color="purple">课程豁免完成</Tag> : null}
          {row.allow_video_seek ? <Tag color="gold">允许拖动</Tag> : null}
          {row.auto_answer_correct ? <Tag color="green">答题默认正确</Tag> : null}
        </Space>
      ),
    },
    { title: "备注", dataIndex: "remark", render: (value) => value || "—" },
    {
      title: "操作",
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm title="确认删除该白名单？" onConfirm={() => remove(row)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-mute)" }}>共 {rows.length} 条白名单记录</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增白名单</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={{ pageSize: 20 }} />

      <Modal
        open={modalOpen}
        title={editing ? "编辑白名单" : "新增白名单"}
        onCancel={closeModal}
        onOk={submit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="用户" name="user_id" rules={[{ required: true, message: "请选择用户" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={Boolean(editing)}
              options={userOptions}
              placeholder="选择普通员工"
            />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="读书自动打卡" name="auto_checkin_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="课程豁免完成" name="course_exempt_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="视频允许拖动" name="allow_video_seek" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="答题默认正确" name="auto_answer_correct" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} placeholder="备注（选填）" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
