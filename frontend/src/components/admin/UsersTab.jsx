import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, App as AntdApp } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  adminCreateUser,
  adminDeleteUser,
  adminGetUserDetail,
  adminListUsers,
  adminUpdateUser,
} from "../../lib/api.admin";

export default function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("create");
  const [editingUser, setEditingUser] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();
  const fillTickRef = useRef(0);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const fillForm = () => {
    if (mode === "create") {
      form.resetFields();
      form.setFieldsValue({
        username: "",
        password: "",
        display_name: "",
        real_name: "",
        department: "",
        position: "",
        role: "user",
        is_newcomer: false,
        status: "active",
        disabled: false,
      });
      return;
    }

    if (mode === "edit" && editingUser) {
      const normalizedStatus = editingUser.disabled
        ? "inactive"
        : (editingUser.status || "active");
      const values = {
        username: editingUser.username || "",
        password: "",
        display_name: editingUser.display_name || "",
        real_name: editingUser.real_name || "",
        department: editingUser.department || "",
        position: editingUser.position || "",
        role: editingUser.role || "user",
        is_newcomer: Boolean(editingUser.is_newcomer),
        status: normalizedStatus,
        disabled: Boolean(editingUser.disabled),
      };
      console.log("set edit form values:", values);
      form.resetFields();
      form.setFieldsValue(values);
      window.setTimeout(() => {
        console.log("form values after set:", form.getFieldsValue());
      }, 0);
    }
  };

  const handleCreate = () => {
    setMode("create");
    setEditingUser(null);
    setModalOpen(true);
  };

  const handleEdit = async (user) => {
    console.log("edit user record:", user);
    try {
      setModalLoading(true);
      const detail = await adminGetUserDetail(user.id);
      console.log("edit user detail:", detail);
      setMode("edit");
      setEditingUser(detail);
      setModalOpen(true);
    } catch (err) {
      message.error(err?.message || "用户详情加载失败。");
    } finally {
      setModalLoading(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setMode("create");
    setEditingUser(null);
    form.resetFields();
  };

  const disabledValue = Form.useWatch("disabled", form);
  const statusValue = Form.useWatch("status", form);

  useEffect(() => {
    if (!modalOpen) return;
    if (disabledValue && statusValue !== "inactive") {
      form.setFieldValue("status", "inactive");
    }
  }, [disabledValue, form, modalOpen, statusValue]);

  const submit = async () => {
    const values = await form.validateFields();
    try {
      setSaving(true);
      const payload = {
        ...values,
        disabled: Boolean(values.disabled),
        status: values.disabled ? "inactive" : (values.status || "active"),
      };
      if (!payload.password) delete payload.password;

      if (mode === "create") {
        await adminCreateUser(payload);
        message.success("已创建用户。");
      } else {
        await adminUpdateUser(editingUser.id, payload);
        message.success("已更新。");
      }
      closeModal();
      await reload();
    } catch (err) {
      message.error(err?.message || "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user) => {
    try {
      await adminDeleteUser(user.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 80 },
    { title: "用户名", dataIndex: "username" },
    { title: "姓名", dataIndex: "display_name", render: (_, row) => row.display_name || row.real_name || row.username },
    { title: "部门", dataIndex: "department", render: (v) => v || "—" },
    { title: "岗位", dataIndex: "position", render: (v) => v || "—" },
    {
      title: "角色",
      dataIndex: "role",
      render: (v) => v === "admin" ? <Tag color="red">管理员</Tag> : <Tag>普通用户</Tag>,
    },
    {
      title: "新人",
      dataIndex: "is_newcomer",
      render: (v) => v ? <Tag color="gold">新人</Tag> : "—",
    },
    {
      title: "状态",
      render: (_, row) => {
        if (row.disabled) return <Tag color="default">已禁用</Tag>;
        return row.status === "inactive" ? <Tag color="warning">停用</Tag> : <Tag color="success">正常</Tag>;
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      render: (v) => v ? v.slice(0, 16).replace("T", " ") : "—",
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} loading={modalLoading && editingUser?.id === row.id} onClick={() => handleEdit(row)}>编辑</Button>
          <Popconfirm title="确认删除该用户？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-mute)" }}>共 {users.length} 个账号</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建用户</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={users} columns={columns} pagination={{ pageSize: 20 }} />

      <Modal
        open={modalOpen}
        title={mode === "create" ? "新建用户" : "编辑用户"}
        onCancel={closeModal}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        afterOpenChange={(open) => {
          if (!open) return;
          fillTickRef.current += 1;
          fillForm();
        }}
        destroyOnClose={false}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input disabled={mode === "edit"} placeholder="登录用户名" />
          </Form.Item>
          <Form.Item
            label={mode === "edit" ? "密码（留空表示不修改）" : "密码"}
            name="password"
            rules={mode === "create" ? [{ required: true, message: "请输入密码" }] : []}
          >
            <Input.Password placeholder="明文密码，前端会做 md5 后传给后端" />
          </Form.Item>
          <Form.Item label="显示名" name="display_name">
            <Input placeholder="用户在前端显示的名字（可空）" />
          </Form.Item>
          <Form.Item label="真实姓名" name="real_name">
            <Input placeholder="例如：张三" />
          </Form.Item>
          <Form.Item label="部门" name="department">
            <Input placeholder="例如：销售一部" />
          </Form.Item>
          <Form.Item label="岗位" name="position">
            <Input placeholder="例如：招商主管" />
          </Form.Item>
          <Form.Item label="角色" name="role">
            <Select
              options={[
                { value: "user", label: "普通用户" },
                { value: "admin", label: "管理员" },
              ]}
            />
          </Form.Item>
          <Form.Item label="是否新人" name="is_newcomer" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="账号状态" name="status">
            <Select
              options={[
                { value: "active", label: "正常" },
                { value: "inactive", label: "停用" },
              ]}
              disabled={Boolean(disabledValue)}
            />
          </Form.Item>
          <Form.Item label="禁用" name="disabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
