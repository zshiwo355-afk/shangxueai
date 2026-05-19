import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminUpdateUser,
} from "../../lib/api.admin";

export default function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | { mode: 'create' | 'edit', user }
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();

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

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ role: "user", is_newcomer: false, status: "active", disabled: false });
    setEditing({ mode: "create" });
  };
  const openEdit = (user) => {
    form.resetFields();
    form.setFieldsValue({
      username: user.username,
      display_name: user.display_name,
      real_name: user.real_name,
      department: user.department,
      position: user.position,
      role: user.role,
      is_newcomer: user.is_newcomer,
      status: user.status,
      disabled: user.disabled,
    });
    setEditing({ mode: "edit", user });
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing.mode === "create") {
        await adminCreateUser(values);
        message.success("已创建用户。");
      } else {
        const patch = { ...values };
        if (!patch.password) delete patch.password;
        await adminUpdateUser(editing.user.id, patch);
        message.success("已更新。");
      }
      setEditing(null);
      reload();
    } catch (err) {
      message.error(err?.message || "保存失败。");
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
    { title: "姓名", dataIndex: "real_name", render: (_, row) => row.real_name || row.display_name || row.username },
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
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建用户</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={users} columns={columns} pagination={{ pageSize: 20 }} />

      <Modal
        open={!!editing}
        title={editing?.mode === "create" ? "新建用户" : "编辑用户"}
        onCancel={() => setEditing(null)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input disabled={editing?.mode === "edit"} placeholder="登录用户名" />
          </Form.Item>
          <Form.Item
            label={editing?.mode === "edit" ? "重置密码（留空表示不修改）" : "密码"}
            name="password"
            rules={editing?.mode === "create" ? [{ required: true, message: "请输入密码" }] : []}
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
          <Form.Item label="角色" name="role" initialValue="user">
            <Select
              options={[
                { value: "user", label: "普通用户" },
                { value: "admin", label: "管理员" },
              ]}
            />
          </Form.Item>
          <Form.Item label="是否新人" name="is_newcomer" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
          <Form.Item label="账号状态" name="status" initialValue="active">
            <Select
              options={[
                { value: "active", label: "正常" },
                { value: "inactive", label: "停用" },
              ]}
            />
          </Form.Item>
          <Form.Item label="禁用" name="disabled" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
