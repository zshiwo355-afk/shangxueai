import { DeleteOutlined, DownloadOutlined, EditOutlined, ImportOutlined, InboxOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
  App as AntdApp,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  adminBulkImportUsers,
  adminBulkDeleteUsers,
  adminCreateUser,
  adminDeleteUser,
  adminGetUserDetail,
  adminListDepartments,
  adminSearchUsers,
  adminUpdateUser,
  buildUsersTemplateUrl,
} from "../../lib/api.admin";
import { getCurrentUser, isSuperAdmin } from "../../lib/auth";
import { fetchOptions } from "../../lib/api.options";

const { Dragger } = Upload;

export default function UsersTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const canManageSuperAdmin = isSuperAdmin();
  const currentUser = getCurrentUser();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [department, setDepartment] = useState();
  const [departments, setDepartments] = useState([]);
  const [employmentStatus, setEmploymentStatus] = useState();
  const [employmentStatusOptions, setEmploymentStatusOptions] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("create");
  const [editingUser, setEditingUser] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();
  const fillTickRef = useRef(0);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminSearchUsers({
        page,
        page_size: pageSize,
        keyword,
        department,
        employment_status: employmentStatus,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  const reloadDepartments = async () => {
    try {
      const data = await adminListDepartments();
      setDepartments(Array.isArray(data) ? data : []);
    } catch {
      // 忽略：部门列表是辅助筛选用的
    }
  };

  const reloadEmploymentStatusOptions = async () => {
    try {
      const data = await fetchOptions();
      setEmploymentStatusOptions(Array.isArray(data?.employment_status) ? data.employment_status : []);
    } catch {
      // 忽略：在职状态字典是辅助筛选用的
    }
  };

  useEffect(() => { reload(); }, [page, pageSize, keyword, department, employmentStatus]);
  useEffect(() => { reloadDepartments(); }, []);
  useEffect(() => { reloadEmploymentStatusOptions(); }, []);

  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: d, label: d })),
    [departments],
  );

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
        employment_status: "",
        status: "active",
        disabled: false,
      });
      return;
    }
    if (mode === "edit" && editingUser) {
      const normalizedStatus = editingUser.disabled
        ? "inactive"
        : (editingUser.status || "active");
      form.resetFields();
      form.setFieldsValue({
        username: editingUser.username || "",
        password: "",
        display_name: editingUser.display_name || "",
        real_name: editingUser.real_name || "",
        department: editingUser.department || "",
        position: editingUser.position || "",
        role: editingUser.role || "user",
        is_newcomer: Boolean(editingUser.is_newcomer),
        employment_status: editingUser.employment_status || "",
        status: normalizedStatus,
        disabled: Boolean(editingUser.disabled),
      });
    }
  };

  const handleCreate = () => {
    setMode("create");
    setEditingUser(null);
    setModalOpen(true);
  };

  const handleEdit = async (user) => {
    try {
      setModalLoading(true);
      const detail = await adminGetUserDetail(user.id);
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
      reloadDepartments();
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
      setSelectedIds((prev) => prev.filter((id) => id !== user.id));
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const bulkDelete = async () => {
    try {
      const res = await adminBulkDeleteUsers(selectedIds);
      const deleted = Number(res?.deleted || 0);
      const skipped = Number(res?.skipped || 0);
      if (deleted > 0 && skipped > 0) {
        message.success(`已删除 ${deleted} 个用户，跳过 ${skipped} 个不可删除账号。`);
      } else if (deleted > 0) {
        message.success(`已删除 ${deleted} 个用户。`);
      } else {
        message.warning("所选账号均不可删除。");
      }
      setSelectedIds([]);
      reload();
    } catch (err) {
      message.error(err?.message || "批量删除失败。");
    }
  };

  const isProtectedRow = (row) => (
    row.id === currentUser?.id || (row.role === "super_admin" && !canManageSuperAdmin)
  );

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "用户名", dataIndex: "username", width: 130 },
    {
      title: "姓名",
      dataIndex: "display_name",
      width: 130,
      render: (_, row) => row.display_name || row.real_name || row.username,
    },
    { title: "部门", dataIndex: "department", width: 130, render: (v) => v || "—" },
    { title: "岗位", dataIndex: "position", width: 130, render: (v) => v || "—" },
    {
      title: "角色",
      dataIndex: "role",
      width: 90,
      render: (v) => {
        if (v === "super_admin") return <Tag bordered={false} color="purple">VIP 超级管理员</Tag>;
        if (v === "admin") return <Tag bordered={false} color="red">管理员</Tag>;
        return <Tag bordered={false}>普通用户</Tag>;
      },
    },
    {
      title: "新人",
      dataIndex: "is_newcomer",
      width: 70,
      render: (v) => v ? <Tag bordered={false} color="gold">新人</Tag> : "—",
    },
    {
      title: "在职状态",
      dataIndex: "employment_status",
      width: 100,
      render: (v) => v ? <Tag bordered={false} color="blue">{v}</Tag> : "—",
    },
    {
      title: "状态",
      width: 80,
      render: (_, row) => {
        if (row.disabled) return <Tag bordered={false} color="default">已禁用</Tag>;
        return row.status === "inactive" ? <Tag bordered={false} color="warning">停用</Tag> : <Tag bordered={false} color="success">正常</Tag>;
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      width: 150,
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      fixed: "right",
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} disabled={row.role === "super_admin" && !canManageSuperAdmin} loading={modalLoading && editingUser?.id === row.id} onClick={() => handleEdit(row)}>编辑</Button>
          <Popconfirm title="确认删除该用户？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger disabled={isProtectedRow(row)} icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Input.Search
          placeholder="按用户名 / 姓名搜索"
          allowClear
          enterButton={<SearchOutlined />}
          style={{ width: 260 }}
          onSearch={(v) => { setPage(1); setKeyword(v.trim()); }}
        />
        <Select
          allowClear
          showSearch
          placeholder="按部门筛选"
          style={{ width: 200 }}
          options={departmentOptions}
          value={department}
          onChange={(v) => { setPage(1); setDepartment(v); }}
        />
        <Select
          allowClear
          placeholder="按在职状态筛选"
          style={{ width: 160 }}
          options={employmentStatusOptions.map((s) => ({ value: s, label: s }))}
          value={employmentStatus}
          onChange={(v) => { setPage(1); setEmploymentStatus(v); }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建用户</Button>
        <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>批量导入</Button>
        <Button icon={<DownloadOutlined />} href={buildUsersTemplateUrl()} target="_blank">下载模板</Button>
        <span style={{ color: "var(--text-mute)" }}>共 {total} 个账号</span>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: setSelectedIds,
          preserveSelectedRowKeys: true,
          getCheckboxProps: (row) => ({
            disabled: isProtectedRow(row),
          }),
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
        scroll={{ x: 1200 }}
      />

      {selectedIds.length > 0 ? (
        <div className="bulk-action-bar">
          <span className="bulk-action-bar__count">
            已选择 <strong>{selectedIds.length}</strong> 个账号
          </span>
          <div className="bulk-action-bar__actions">
            <Button onClick={() => setSelectedIds([])}>取消选择</Button>
            <Popconfirm
              title={`确认删除选中的 ${selectedIds.length} 个账号？`}
              description="该操作不可撤销。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={bulkDelete}
            >
              <Button danger icon={<DeleteOutlined />}>批量删除</Button>
            </Popconfirm>
          </div>
        </div>
      ) : null}

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
        destroyOnHidden={false}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
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
                ...(canManageSuperAdmin ? [{ value: "super_admin", label: "VIP 超级管理员" }] : []),
              ]}
            />
          </Form.Item>
          <Form.Item label="是否新人" name="is_newcomer" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="在职状态" name="employment_status">
            <Select
              allowClear
              placeholder="（可选）从字典中选择"
              options={employmentStatusOptions.map((s) => ({ value: s, label: s }))}
            />
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

      <BulkImportUsersModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { setImportOpen(false); reload(); reloadDepartments(); }}
      />
    </>
  );
}

function BulkImportUsersModal({ open, onClose, onDone }) {
  const { message } = AntdApp.useApp();
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState(null);

  const handleUpload = async (file) => {
    setUploading(true);
    try {
      const data = await adminBulkImportUsers(file);
      setSummary(data);
      if ((data?.created ?? 0) > 0) {
        message.success(`已成功导入 ${data.created} 位用户。`);
      } else if ((data?.skipped ?? 0) > 0) {
        message.warning("所有用户名都已存在，未新增。");
      } else {
        message.error("没有可导入的用户。");
      }
    } catch (err) {
      message.error(err?.message || "导入失败。");
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleClose = () => {
    onClose?.();
    setTimeout(() => setSummary(null), 250);
  };

  return (
    <Modal
      open={open}
      title="批量导入用户"
      onCancel={handleClose}
      footer={
        <Space>
          <Button onClick={handleClose}>关闭</Button>
          {summary && summary.created > 0 ? (
            <Button type="primary" onClick={() => { onDone?.(); }}>完成并刷新</Button>
          ) : null}
        </Space>
      }
      width={680}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        message={<>请先<a href={buildUsersTemplateUrl()} target="_blank" rel="noreferrer">下载 Excel 模板</a>，按列填好后再上传。仅支持 .xlsx；用户名重复将自动跳过。</>}
        style={{ marginBottom: 16 }}
      />

      {!summary ? (
        <Dragger
          multiple={false}
          accept=".xlsx,.xls"
          beforeUpload={handleUpload}
          showUploadList={false}
          disabled={uploading}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 Excel 文件到此区域</p>
          <p className="ant-upload-hint">仅接受 .xlsx，单文件 ≤ 10MB</p>
        </Dragger>
      ) : (
        <>
          <Space size={8} wrap style={{ marginBottom: 12 }}>
            <Tag color="blue">共 {summary.total} 行</Tag>
            <Tag color="success">成功 {summary.created}</Tag>
            <Tag color="default">跳过 {summary.skipped}</Tag>
            <Tag color="error">失败 {summary.failed}</Tag>
          </Space>
          {summary.errors?.length ? (
            <Alert
              type="error"
              showIcon
              message={`错误信息（${summary.errors.length}）`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflow: "auto" }}>
                  {summary.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              }
            />
          ) : (
            <Alert type="success" showIcon message="导入完成，没有错误。" />
          )}
        </>
      )}
    </Modal>
  );
}
