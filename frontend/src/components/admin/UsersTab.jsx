import { DeleteOutlined, DownloadOutlined, EditOutlined, ExclamationCircleOutlined, ImportOutlined, InboxOutlined, PlusOutlined, SearchOutlined, SyncOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
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
  adminExecuteEmployeeSync,
  adminGetUserDetail,
  adminListDepartments,
  adminPreviewEmployeeSync,
  adminSearchExternalEmployees,
  adminSearchUsers,
  adminUpdateUser,
  buildUsersTemplateUrl,
} from "../../lib/api.admin";
import { getCurrentUser, isSuperAdmin } from "../../lib/auth";
import { fetchOptions } from "../../lib/api.options";

const { Dragger } = Upload;

const EMPLOYEE_SYNC_ACTION_LABELS = {
  update_bound: "更新已绑定账号",
  bind_by_mobile: "按姓名手机号绑定",
  update_by_name: "同名更新手机号",
  pending_create: "新建本地账号",
  local_unbound: "仅提示",
  mark_left: "置为离职",
  conflict: "冲突需处理",
  skip_missing_identity: "跳过",
};

const EMPLOYEE_SYNC_ACTION_COLORS = {
  update_bound: "blue",
  bind_by_mobile: "cyan",
  update_by_name: "geekblue",
  pending_create: "green",
  local_unbound: "default",
  mark_left: "orange",
  conflict: "red",
  skip_missing_identity: "default",
};

const EMPLOYEE_SYNC_SUMMARY_LABELS = {
  update_bound: "已绑定更新",
  bind_by_mobile: "姓名手机号绑定",
  update_by_name: "同名改号更新",
  pending_create: "待新建",
  local_unbound: "仅提示",
  mark_left: "将离职",
  conflict: "冲突",
  skipped: "跳过",
};

const USER_SYNC_ISSUE_LABELS = {
  conflict: "冲突待处理",
  local_unbound: "待确认",
  update_by_name: "改号未完成",
  pending_create: "待新建",
};

const USER_SYNC_ISSUE_COLORS = {
  conflict: "red",
  local_unbound: "orange",
  update_by_name: "gold",
  pending_create: "blue",
};

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
  const [wecomPreviewOpen, setWecomPreviewOpen] = useState(false);
  const [wecomPreviewLoading, setWecomPreviewLoading] = useState(false);
  const [wecomSyncRunning, setWecomSyncRunning] = useState(false);
  const [wecomInitialMode, setWecomInitialMode] = useState(true);
  const [wecomPreview, setWecomPreview] = useState(null);
  const [wecomPreviewActionFilter, setWecomPreviewActionFilter] = useState();
  const [externalSearchOpen, setExternalSearchOpen] = useState(false);
  const [externalSearchLoading, setExternalSearchLoading] = useState(false);
  const [externalSearchItems, setExternalSearchItems] = useState([]);
  const [externalSearchForm] = Form.useForm();
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();
  const fillTickRef = useRef(0);
  const previewTickRef = useRef(0);

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

  const loadWecomPreview = async (initialMode = wecomInitialMode) => {
    const requestId = previewTickRef.current + 1;
    previewTickRef.current = requestId;
    setWecomInitialMode(initialMode);
    setWecomPreviewLoading(true);
    try {
      const data = await adminPreviewEmployeeSync(initialMode);
      if (requestId !== previewTickRef.current) return;
      setWecomPreview(data);
      setWecomInitialMode(Boolean(data?.initial_mode));
      setWecomPreviewOpen(true);
    } catch (err) {
      if (requestId === previewTickRef.current) {
        message.error(err?.message || "员工同步预览失败。");
      }
    } finally {
      if (requestId === previewTickRef.current) {
        setWecomPreviewLoading(false);
      }
    }
  };

  const runWecomSync = async () => {
    setWecomSyncRunning(true);
    try {
      const effectiveInitialMode = Boolean(wecomPreview?.initial_mode ?? wecomInitialMode);
      const result = await adminExecuteEmployeeSync(effectiveInitialMode, wecomPreview?.preview_token || "");
      message.success(`员工同步已执行，批次 #${result.batch_id}`);
      await loadWecomPreview(effectiveInitialMode);
      await reload();
      await reloadDepartments();
    } catch (err) {
      message.error(err?.message || "员工同步执行失败。");
    } finally {
      setWecomSyncRunning(false);
    }
  };

  const searchExternalEmployees = async () => {
    const values = externalSearchForm.getFieldsValue();
    const params = {
      name: values.name?.trim() || undefined,
      mobile: values.mobile?.trim() || undefined,
      external_user_id: values.external_user_id || undefined,
    };
    setExternalSearchLoading(true);
    try {
      const data = await adminSearchExternalEmployees(params);
      setExternalSearchItems(Array.isArray(data?.items) ? data.items : []);
      setExternalSearchOpen(true);
    } catch (err) {
      message.error(err?.message || "第三方员工查询失败。");
    } finally {
      setExternalSearchLoading(false);
    }
  };

  const isProtectedRow = (row) => (
    row.id === currentUser?.id || (row.role === "super_admin" && !canManageSuperAdmin)
  );

  const filteredWecomPreviewItems = useMemo(() => {
    const rows = Array.isArray(wecomPreview?.items) ? wecomPreview.items : [];
    if (!wecomPreviewActionFilter) return rows;
    return rows.filter((row) => row.action === wecomPreviewActionFilter);
  }, [wecomPreview, wecomPreviewActionFilter]);

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
      title: "同步标识",
      dataIndex: "sync_issue_action",
      width: 150,
      render: (_, row) => {
        if (!row.sync_issue_action) return "—";
        const label = USER_SYNC_ISSUE_LABELS[row.sync_issue_action] || "待处理";
        const color = USER_SYNC_ISSUE_COLORS[row.sync_issue_action] || "orange";
        return (
          <Tooltip title={row.sync_issue_reason || label}>
            <Tag bordered={false} color={color} icon={<ExclamationCircleOutlined />}>
              {label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "鍒涘缓鏃堕棿",
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
        <Button icon={<SearchOutlined />} loading={externalSearchLoading} onClick={() => setExternalSearchOpen(true)}>查第三方员工</Button>
        <Button icon={<SyncOutlined />} loading={wecomPreviewLoading} onClick={() => loadWecomPreview(wecomInitialMode)}>员工同步预览</Button>
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
        open={wecomPreviewOpen}
        title="员工同步预览"
        onCancel={() => setWecomPreviewOpen(false)}
        onOk={runWecomSync}
        okText="执行同步"
        cancelText="关闭"
        confirmLoading={wecomSyncRunning}
        width="92vw"
        style={{ top: 24 }}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Space wrap align="center">
            <span style={{ fontWeight: 600 }}>同步模式</span>
            <Segmented
              value={wecomInitialMode ? "initial" : "daily"}
              options={[
                { label: "首次初始化", value: "initial" },
                { label: "日常同步", value: "daily" },
              ]}
              onChange={(value) => {
                const nextInitialMode = value === "initial";
                setWecomInitialMode(nextInitialMode);
                loadWecomPreview(nextInitialMode);
              }}
            />
            <Tag color={wecomInitialMode ? "blue" : "orange"}>
              {wecomInitialMode ? "不会置离职" : "会处理离职"}
            </Tag>
          </Space>
          <Alert
            type="info"
            showIcon
            message={wecomInitialMode ? "初始化模式：先显示第三方员工的匹配/新建结果，再显示本地多出来的账号；本地多出来的账号只提示，不处理。" : "日常模式：继续更新、新建员工；已绑定但第三方缺失的普通账号会置为离职/禁用，受保护状态会跳过。"}
          />
          {wecomPreview ? (
            <Space wrap>
              <Tag color="blue">外部员工 {wecomPreview.total_source_users || 0}</Tag>
              {Object.entries(wecomPreview.summary || {}).map(([key, value]) => (
                <Tag key={key}>{EMPLOYEE_SYNC_SUMMARY_LABELS[key] || key}: {value}</Tag>
              ))}
            </Space>
          ) : null}
          <Space wrap>
            <Select
              allowClear
              placeholder="筛选处理结果"
              value={wecomPreviewActionFilter}
              onChange={setWecomPreviewActionFilter}
              style={{ width: 180 }}
              options={Object.entries(EMPLOYEE_SYNC_ACTION_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <span style={{ color: "var(--text-mute)" }}>
              当前显示 {filteredWecomPreviewItems.length} 条
            </span>
          </Space>
          <Table
            rowKey={(row) => `${row.action}-${row.local_user_id || 0}-${row.wecom_userid || row.mobile || "x"}`}
            loading={wecomPreviewLoading}
            dataSource={filteredWecomPreviewItems}
            size="small"
            pagination={{ pageSize: 8 }}
            scroll={{ x: 1280 }}
            columns={[
              {
                title: "处理结果",
                dataIndex: "action",
                width: 150,
                render: (value) => (
                  <Tag color={EMPLOYEE_SYNC_ACTION_COLORS[value] || "default"}>
                    {EMPLOYEE_SYNC_ACTION_LABELS[value] || value || "未知"}
                  </Tag>
                ),
              },
              { title: "本地账号", dataIndex: "local_username", width: 220, render: (_, row) => row.local_name ? `${row.local_name} / ${row.local_username || "—"}` : (row.local_username || "—") },
              { title: "第三方员工", dataIndex: "wecom_name", width: 240, render: (_, row) => row.wecom_name ? `${row.wecom_name} / ${row.wecom_userid || "—"}` : (row.wecom_userid || "—") },
              { title: "手机号", dataIndex: "mobile", width: 130, render: (value) => value || "—" },
              { title: "部门", dataIndex: "department", width: 260, render: (value) => value || "—" },
              { title: "说明", dataIndex: "reason", width: 420, render: (value) => value || "将更新本地账号信息。" },
            ]}
          />
        </Space>
      </Modal>

      <Modal
        open={externalSearchOpen}
        title="查第三方员工"
        onCancel={() => setExternalSearchOpen(false)}
        footer={<Button onClick={() => setExternalSearchOpen(false)}>关闭</Button>}
        width={980}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Form form={externalSearchForm} layout="inline" onFinish={searchExternalEmployees}>
            <Form.Item name="name" label="姓名">
              <Input allowClear placeholder="模糊搜索" style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="mobile" label="手机号">
              <Input allowClear placeholder="模糊搜索" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="external_user_id" label="员工ID">
              <Input allowClear placeholder="精确查询" style={{ width: 130 }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={externalSearchLoading}>查询</Button>
            </Form.Item>
          </Form>
          <Table
            rowKey={(row) => row.external_user_id || `${row.mobile}-${row.wecom_userid}`}
            loading={externalSearchLoading}
            dataSource={externalSearchItems}
            size="small"
            pagination={{ pageSize: 8 }}
            scroll={{ x: 1000 }}
            columns={[
              { title: "员工ID", dataIndex: "external_user_id", width: 90 },
              { title: "姓名", dataIndex: "name", width: 100 },
              { title: "手机号", dataIndex: "mobile", width: 130 },
              { title: "部门", dataIndex: "department_name", width: 260, render: (value) => value || "—" },
              { title: "岗位", dataIndex: "position", width: 130, render: (value) => value || "—" },
              { title: "花名册状态", dataIndex: "status", width: 110, render: (value) => value === 2 ? "试用期" : "在职" },
              { title: "企微状态", dataIndex: "employment_status", width: 110, render: (value) => value === 1 ? "在职" : value === 2 ? "禁用" : value === 3 ? "离职" : "未绑定" },
              { title: "企微 userid", dataIndex: "wecom_userid", width: 220, render: (value) => value || "—" },
            ]}
          />
        </Space>
      </Modal>

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
        width={860}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", columnGap: 16 }}
        >
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
