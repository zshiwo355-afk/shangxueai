import { DeleteOutlined, DownloadOutlined, EyeOutlined, PlusOutlined, RedoOutlined } from "@ant-design/icons";
import { Alert, Button, DatePicker, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Tabs, Tag, Table, Typography, App as AntdApp } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  adminBatchCreateExams,
  adminBulkDeleteExams,
  adminCreateExam,
  adminDeleteExam,
  adminGetExamDetail,
  adminListExams,
  adminListUsers,
  adminPushExamWecom,
} from "../../lib/api.admin";
import { adminListOptions } from "../../lib/api.options";
import { downloadCsv, todayStamp } from "../../lib/csvExport";
import ChatHistoryView from "../ChatHistoryView";
import DepartmentUserTreeSelect, { resolveDepartmentSelectionUserIds } from "../common/DepartmentUserTreeSelect";
import ReviewView from "../ReviewView";

const { Paragraph, Text } = Typography;

const STATUS_TAGS = {
  pending: { color: "warning", text: "待通关" },
  in_progress: { color: "processing", text: "进行中" },
  passed: { color: "success", text: "已通过" },
  failed: { color: "error", text: "未通过" },
};

const RANDOM_SENTINEL = "__random__";
const JOB_LEVEL_OPTIONS = [
  { value: "M线", label: "M线" },
  { value: "P线", label: "P线" },
  { value: "L线", label: "L线" },
];

function statusTag(status) {
  const cfg = STATUS_TAGS[status] || { color: "default", text: status };
  return <Tag bordered={false} color={cfg.color}>{cfg.text}</Tag>;
}

function statusText(status) {
  return STATUS_TAGS[status]?.text || status || "—";
}

const EXPORT_COLUMNS = [
  { title: "ID", key: "id" },
  { title: "应试者", value: (row) => row.user_display_name || row.user_username || "" },
  { title: "用户名", key: "user_username" },
  { title: "标题", key: "title" },
  { title: "训练类型", value: (row) => row.fixed_training_type || "随机" },
  { title: "难度", value: (row) => row.fixed_difficulty || "随机" },
  { title: "客户类型", value: (row) => row.fixed_customer_type || "随机" },
  { title: "分数", value: (row) => row.latest_score == null ? "" : Math.round(row.latest_score) },
  { title: "结果", value: (row) => row.latest_is_pass == null ? "" : (row.latest_is_pass ? "及格" : "不及格") },
  { title: "及格分", key: "pass_score" },
  { title: "状态", value: (row) => statusText(row.status) },
  { title: "已尝试次数", key: "attempt_count" },
  { title: "最大尝试次数", key: "max_attempts" },
  { title: "派发时间", value: (row) => row.created_at ? dayjs(row.created_at).format("YYYY-MM-DD HH:mm") : "" },
  { title: "截止时间", value: (row) => row.deadline_at ? dayjs(row.deadline_at).format("YYYY-MM-DD HH:mm") : "不限" },
];

export default function ExamAssignmentsPanel() {
  const [exams, setExams] = useState([]);
  const [examTotal, setExamTotal] = useState(0);
  const [users, setUsers] = useState([]);
  const [options, setOptions] = useState({ training_type: [], difficulty: [], customer_type: [], employment_status: [] });
  const [loading, setLoading] = useState(true);
  const [examLoading, setExamLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [createForm] = Form.useForm();
  const { message, modal } = AntdApp.useApp();
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pushingId, setPushingId] = useState(null);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const loadExams = async (overrides = {}) => {
    const p = overrides.page ?? page;
    const ps = overrides.pageSize ?? pageSize;
    const kw = overrides.keyword ?? keyword;
    const st = overrides.status ?? statusFilter;
    setExamLoading(true);
    try {
      const params = { page: p, page_size: ps };
      if (kw) params.keyword = kw;
      if (st && st !== "all") params.status = st;
      const data = await adminListExams(params);
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      const total = typeof data?.total === "number" ? data.total : items.length;
      setExams(items);
      setExamTotal(total);
    } catch (err) {
      message.error(err?.message || "通关列表加载失败。");
      setExams([]);
      setExamTotal(0);
    } finally {
      setExamLoading(false);
    }
  };

  const loadStatic = async () => {
    setLoading(true);
    try {
      const [userData, ttData, dffData, ctData, employmentStatusData] = await Promise.all([
        adminListUsers(),
        adminListOptions("training_type"),
        adminListOptions("difficulty"),
        adminListOptions("customer_type"),
        adminListOptions("employment_status"),
      ]);
      setUsers(Array.isArray(userData) ? userData : []);
      setOptions({
        training_type: (ttData || []).filter((o) => o.enabled).map((o) => o.value),
        difficulty: (dffData || []).filter((o) => o.enabled).map((o) => o.value),
        customer_type: (ctData || []).filter((o) => o.enabled).map((o) => o.value),
        employment_status: (employmentStatusData || []).filter((o) => o.enabled).map((o) => o.value),
      });
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  const reload = async () => {
    await Promise.all([loadStatic(), loadExams()]);
  };

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    loadExams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, keyword, statusFilter]);

  const exportFilteredExams = async () => {
    setExporting(true);
    try {
      const params = {};
      if (keyword) params.keyword = keyword;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      const data = await adminListExams(params);
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      if (!items.length) {
        message.warning("当前筛选条件下没有可导出的通关数据。");
        return;
      }
      downloadCsv(`AI对练考试_筛选结果_${todayStamp()}.csv`, EXPORT_COLUMNS, items);
      message.success(`已导出 ${items.length} 条筛选结果。`);
    } catch (err) {
      message.error(err?.message || "通关数据导出失败。");
    } finally {
      setExporting(false);
    }
  };

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    if (!resolvedUserIds.length) {
      message.warning("当前选择没有命中任何用户。");
      return;
    }
    const payload = {
      title: values.title,
      pass_score: Number(values.pass_score) || 60,
      max_attempts: Number(values.max_attempts) || 2,
    };
    if (values.deadline_at) {
      payload.deadline_at = values.deadline_at.toISOString();
    }
    if (values.fixed_training_type && values.fixed_training_type !== RANDOM_SENTINEL) {
      payload.fixed_training_type = values.fixed_training_type;
    }
    if (values.fixed_difficulty && values.fixed_difficulty !== RANDOM_SENTINEL) {
      payload.fixed_difficulty = values.fixed_difficulty;
    }
    if (values.fixed_customer_type && values.fixed_customer_type !== RANDOM_SENTINEL) {
      payload.fixed_customer_type = values.fixed_customer_type;
    }
    try {
      if (resolvedUserIds.length === 1 && dispatchMode === "user") {
        await adminCreateExam({ ...payload, user_id: resolvedUserIds[0] });
      } else {
        await adminBatchCreateExams({ ...payload, user_ids: resolvedUserIds });
      }
      message.success(`通关已派发到 ${resolvedUserIds.length} 位用户。`);
      setCreating(false);
      // 派发完跳到第一页看新派发的
      if (page !== 1) setPage(1); else loadExams({ page: 1 });
      loadStatic();
    } catch (err) {
      message.error(err?.message || "派发失败。");
    }
  };

  const remove = async (exam) => {
    try {
      await adminDeleteExam(exam.id);
      message.success("已删除。");
      loadExams();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const pushOne = async (exam) => {
    setPushingId(exam.id);
    try {
      const res = await adminPushExamWecom(exam.id);
      const sent = Number(res?.sent || 0);
      const failed = Number(res?.failed || 0);
      const skipped = Number(res?.skipped || 0);
      if (sent > 0) {
        message.success(`已推送 ${sent} 条。${failed ? `失败 ${failed}。` : ""}`);
      } else if (failed > 0) {
        message.error(`推送失败 ${failed} 条，请前往「推送监控」查看原因。`);
      } else {
        message.warning(skipped ? "推送被跳过：接收人未绑定企业微信或被禁用。" : "未触发推送。");
      }
    } catch (err) {
      message.error(err?.message || "推送失败。");
    } finally {
      setPushingId(null);
    }
  };

  const performBulkDelete = async (force) => {
    setBulkBusy(true);
    try {
      const res = await adminBulkDeleteExams(selectedIds, force);
      const deleted = Number(res?.deleted || 0);
      const skipped = Number(res?.skipped_count || 0);
      const deletedAttempts = Number(res?.deleted_attempts || 0);
      if (skipped > 0 && !force) {
        modal.confirm({
          title: `${skipped} 条通关已有尝试记录`,
          content: `已删除 ${deleted} 条；剩下 ${skipped} 条带有尝试记录，强制删除会同时清掉这些尝试与对应的会话。是否继续？`,
          okText: "强制删除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: async () => {
            try {
              const r2 = await adminBulkDeleteExams(res.skipped, true);
              const d2 = Number(r2?.deleted || 0);
              const da2 = Number(r2?.deleted_attempts || 0);
              message.success(`再删除 ${d2} 条通关（连同 ${da2} 条尝试记录）。`);
              setSelectedIds([]);
              loadExams();
              loadStatic();
            } catch (err) {
              message.error(err?.message || "强制删除失败。");
            }
          },
        });
      } else if (deleted > 0) {
        message.success(force && deletedAttempts > 0
          ? `已删除 ${deleted} 条通关（连同 ${deletedAttempts} 条尝试记录）。`
          : `已删除 ${deleted} 条通关。`);
      } else {
        message.warning("没有可删除的通关。");
      }
      setSelectedIds([]);
      loadExams();
      loadStatic();
    } catch (err) {
      message.error(err?.message || "批量删除失败。");
    } finally {
      setBulkBusy(false);
    }
  };

  const openDetail = async (exam) => {
    try {
      const data = await adminGetExamDetail(exam.id);
      setDetail(data);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    }
  };

  const assignableUsers = useMemo(
    () => users.filter((u) => u.role === "user" || u.role === "admin"),
    [users],
  );

  const userOptions = useMemo(
    () => assignableUsers.map((u) => ({
      value: u.id,
      label: `${u.display_name || u.username} (${u.username})`,
    })),
    [assignableUsers],
  );

  const userPool = assignableUsers;

  const positionOptions = useMemo(() => {
    const counts = new Map();
    userPool.forEach((u) => {
      const pos = (u.position || "").trim();
      if (!pos) return;
      counts.set(pos, (counts.get(pos) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([value, n]) => ({
      value,
      label: `${value}（${n}人）`,
    }));
  }, [userPool]);

  const employmentStatusOptions = useMemo(() => {
    const counts = new Map();
    userPool.forEach((u) => {
      const status = (u.employment_status || "").trim();
      if (!status) return;
      counts.set(status, (counts.get(status) || 0) + 1);
    });
    const orderedValues = options.employment_status.length
      ? options.employment_status
      : Array.from(counts.keys());
    return orderedValues
      .filter((value) => counts.has(value))
      .map((value) => ({
        value,
        label: `${value}（${counts.get(value) || 0}人）`,
      }));
  }, [options.employment_status, userPool]);

  const dispatchMode = Form.useWatch("dispatch_mode", createForm);
  const watchedUserIds = Form.useWatch("user_ids", createForm);
  const watchedDepartments = Form.useWatch("departments", createForm);
  const watchedPositions = Form.useWatch("positions", createForm);
  const watchedJobLevels = Form.useWatch("job_levels", createForm);
  const watchedEmploymentStatuses = Form.useWatch("employment_statuses", createForm);
  const watchedNewcomerOnly = Form.useWatch("newcomer_only", createForm);

  const resolvedUserIds = useMemo(() => {
    if (dispatchMode === "department") {
      return resolveDepartmentSelectionUserIds(watchedDepartments, userPool);
    }
    if (dispatchMode === "position") {
      const set = new Set(watchedPositions || []);
      if (!set.size) return [];
      return userPool
        .filter((u) => set.has((u.position || "").trim()))
        .map((u) => u.id);
    }
    if (dispatchMode === "employment_status") {
      const set = new Set(watchedEmploymentStatuses || []);
      if (!set.size) return [];
      return userPool
        .filter((u) => set.has((u.employment_status || "").trim()))
        .map((u) => u.id);
    }
    if (dispatchMode === "job_level") {
      const set = new Set(watchedJobLevels || []);
      if (!set.size) return [];
      return userPool
        .filter((u) => set.has(u.job_level || "M线"))
        .map((u) => u.id);
    }
    if (dispatchMode === "all") {
      return userPool
        .filter((u) => (watchedNewcomerOnly ? u.is_newcomer : true))
        .map((u) => u.id);
    }
    return Array.isArray(watchedUserIds) ? watchedUserIds : [];
  }, [dispatchMode, userPool, watchedUserIds, watchedDepartments, watchedPositions, watchedJobLevels, watchedEmploymentStatuses, watchedNewcomerOnly]);

  const buildOptionList = (values, label) => [
    { value: RANDOM_SENTINEL, label: `随机（每次重新抽取）` },
    ...values.filter((v) => v !== "随机").map((v) => ({ value: v, label: v })),
  ];

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    {
      title: "应试者",
      key: "user",
      render: (_, row) => (
        <span>
          {row.user_display_name || row.user_username}
          {row.user_username ? <span style={{ color: "var(--text-faint)" }}> ({row.user_username})</span> : null}
        </span>
      ),
    },
    { title: "标题", dataIndex: "title" },
    {
      title: "题目设置",
      key: "fixed",
      render: (_, row) => (
        <Space size={4} wrap>
          <Tag bordered={false} color={row.fixed_training_type ? "blue" : "default"}>
            类型：{row.fixed_training_type || "随机"}
          </Tag>
          <Tag bordered={false} color={row.fixed_difficulty ? "blue" : "default"}>
            难度：{row.fixed_difficulty || "随机"}
          </Tag>
          <Tag bordered={false} color={row.fixed_customer_type ? "blue" : "default"}>
            客户：{row.fixed_customer_type || "随机"}
          </Tag>
        </Space>
      ),
    },
    {
      title: "分数",
      dataIndex: "latest_score",
      width: 90,
      align: "center",
      render: (value) => value == null
        ? <Typography.Text type="secondary">—</Typography.Text>
        : <strong>{Math.round(value)}</strong>,
    },
    {
      title: "结果",
      dataIndex: "latest_is_pass",
      width: 100,
      align: "center",
      render: (value) => value == null
        ? <Typography.Text type="secondary">—</Typography.Text>
        : <Tag bordered={false} color={value ? "success" : "error"}>{value ? "及格" : "不及格"}</Tag>,
    },
    { title: "状态", dataIndex: "status", render: (v) => statusTag(v) },
    {
      title: "尝试",
      key: "attempts",
      render: (_, row) => `${row.attempt_count} / ${row.max_attempts}`,
    },
    {
      title: "派发时间",
      dataIndex: "created_at",
      width: 150,
      sorter: (a, b) => dayjs(a.created_at || 0).valueOf() - dayjs(b.created_at || 0).valueOf(),
      defaultSortOrder: "descend",
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "截止时间",
      dataIndex: "deadline_at",
      width: 150,
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : <Typography.Text type="secondary">不限</Typography.Text>,
    },
    {
      title: "操作",
      key: "action",
      width: 280,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>详情</Button>
          <Popconfirm title="确认向该用户推送企业微信通知？" onConfirm={() => pushOne(row)} okText="推送" cancelText="取消">
            <Button size="small" icon={<RedoOutlined />} loading={pushingId === row.id}>推送</Button>
          </Popconfirm>
          <Popconfirm title="确认删除该通关？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text-mute)" }}>共 {examTotal} 个通关</span>
          <Input.Search
            allowClear
            placeholder="搜索姓名 / 用户名 / 标题"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onSearch={(v) => {
              const kw = (v || "").trim();
              setKeyword(kw);
              setPage(1);
            }}
            style={{ width: 260 }}
            enterButton
          />
          <Select
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            style={{ width: 130 }}
            options={[
              { value: "all", label: "全部状态" },
              { value: "pending", label: "待通关" },
              { value: "in_progress", label: "进行中" },
              { value: "passed", label: "已通过" },
              { value: "failed", label: "未通过" },
            ]}
          />
        </div>
        <Space size={8} wrap>
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            disabled={loading || examLoading}
            onClick={exportFilteredExams}
          >
            导出筛选结果
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreating(true); }}>
            派发通关
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading || examLoading}
        dataSource={exams}
        columns={columns}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.map((k) => Number(k))),
          preserveSelectedRowKeys: true,
        }}
        pagination={{
          current: page,
          pageSize: pageSize,
          total: examTotal,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        scroll={{ x: 1100 }}
      />

      {selectedIds.length > 0 ? (
        <div className="bulk-action-bar">
          <span className="bulk-action-bar__count">
            已选 <strong>{selectedIds.length}</strong> 条通关
          </span>
          <div className="bulk-action-bar__actions">
            <Button onClick={() => setSelectedIds([])} disabled={bulkBusy}>取消选择</Button>
            <Popconfirm
              title={`确认删除选中的 ${selectedIds.length} 条通关？`}
              description="带尝试记录的通关会被跳过，可二次确认强制删除。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => performBulkDelete(false)}
            >
              <Button danger icon={<DeleteOutlined />} loading={bulkBusy}>批量删除</Button>
            </Popconfirm>
          </div>
        </div>
      ) : null}

      {/* 派发通关弹窗 */}
      <Modal
        open={creating}
        title="派发通关"
        onCancel={() => setCreating(false)}
        onOk={submitCreate}
        okText={`派发到 ${resolvedUserIds.length} 人`}
        okButtonProps={{ disabled: !resolvedUserIds.length }}
        cancelText="取消"
        width={620}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          preserve={false}
          initialValues={{ pass_score: 60, max_attempts: 2, dispatch_mode: "user", newcomer_only: false }}
        >
          <Form.Item label="派发维度" name="dispatch_mode">
            <Radio.Group
              options={[
                { value: "user", label: "指定用户" },
                { value: "department", label: "按部门" },
                { value: "position", label: "按岗位" },
                { value: "job_level", label: "按职级" },
                { value: "employment_status", label: "按在职状态" },
                { value: "all", label: "全员普通用户" },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>

          {dispatchMode === "user" || !dispatchMode ? (
            <Form.Item
              label="应试用户（可多选）"
              name="user_ids"
              rules={[{ required: true, message: "请选择用户" }]}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={userOptions}
                placeholder="选择 1 ~ N 个普通用户"
                maxTagCount="responsive"
              />
            </Form.Item>
          ) : null}

          {dispatchMode === "department" ? (
            <Form.Item
              label="选择部门 / 员工"
              name="departments"
              rules={[{ required: true, message: "请选择至少 1 个部门或员工" }]}
            >
              <DepartmentUserTreeSelect
                users={userPool}
                placeholder="选择部门会自动包含下级员工，可展开后取消个人"
              />
            </Form.Item>
          ) : null}

          {dispatchMode === "position" ? (
            <Form.Item
              label="选择岗位（可多选）"
              name="positions"
              rules={[{ required: true, message: "请选择至少 1 个岗位" }]}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={positionOptions}
                placeholder={positionOptions.length ? "选择岗位" : "暂无可用岗位（用户的「岗位」字段为空）"}
                disabled={!positionOptions.length}
                maxTagCount="responsive"
              />
            </Form.Item>
          ) : null}

          {dispatchMode === "employment_status" ? (
            <Form.Item
              label="选择在职状态（可多选）"
              name="employment_statuses"
              rules={[{ required: true, message: "请选择至少 1 个在职状态" }]}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={employmentStatusOptions}
                placeholder={employmentStatusOptions.length ? "选择在职状态" : "暂无可用状态（请先到「配置管理 → 在职状态」添加）"}
                disabled={!employmentStatusOptions.length}
                maxTagCount="responsive"
              />
            </Form.Item>
          ) : null}

          {dispatchMode === "job_level" ? (
            <Form.Item
              label="选择职级（可多选）"
              name="job_levels"
              rules={[{ required: true, message: "请选择至少 1 个职级" }]}
            >
              <Select
                mode="multiple"
                options={JOB_LEVEL_OPTIONS}
                placeholder="选择 M线 / P线"
                maxTagCount="responsive"
              />
            </Form.Item>
          ) : null}

          {dispatchMode === "all" ? (
            <Form.Item
              label="范围"
              name="newcomer_only"
              getValueProps={(v) => ({ value: v ? "newcomer" : "all" })}
              normalize={(v) => v === "newcomer"}
            >
              <Radio.Group
                options={[
                  { value: "all", label: "全部普通用户" },
                  { value: "newcomer", label: "仅新人（is_newcomer）" },
                ]}
                optionType="button"
              />
            </Form.Item>
          ) : null}

          <Alert
            type={resolvedUserIds.length ? "info" : "warning"}
            showIcon
            style={{ marginBottom: 16 }}
            message={resolvedUserIds.length
              ? `本次派发将命中 ${resolvedUserIds.length} 位用户`
              : "尚未命中任何用户"}
          />

          <Form.Item label="通关标题" name="title" initialValue="陪练通关">
            <Input placeholder="例如：销售认证一阶" />
          </Form.Item>
          <Form.Item label="训练类型（选『随机』则每次抽取）" name="fixed_training_type" initialValue={RANDOM_SENTINEL}>
            <Select options={buildOptionList(options.training_type)} />
          </Form.Item>
          <Form.Item label="难度" name="fixed_difficulty" initialValue={RANDOM_SENTINEL}>
            <Select options={buildOptionList(options.difficulty)} />
          </Form.Item>
          <Form.Item label="客户类型" name="fixed_customer_type" initialValue={RANDOM_SENTINEL}>
            <Select options={buildOptionList(options.customer_type)} />
          </Form.Item>
          <Space size={16} style={{ width: "100%" }} align="start">
            <Form.Item label="及格分" name="pass_score" rules={[{ required: true }]} style={{ flex: 1, minWidth: 0 }}>
              <InputNumber min={0} max={100} step={1} style={{ width: "100%" }} placeholder="例如 60" />
            </Form.Item>
            <Form.Item label="最多答题次数" name="max_attempts" rules={[{ required: true }]} style={{ flex: 1, minWidth: 0 }}>
              <InputNumber min={1} max={10} step={1} style={{ width: "100%" }} placeholder="例如 2" />
            </Form.Item>
          </Space>
          <Form.Item
            label="截止时间（不填则不限）"
            name="deadline_at"
            extra="到达截止前 24 小时时，未完成的学员会自动收到企业微信提醒。"
          >
            <DatePicker
              showTime={{ format: "HH:mm" }}
              format="YYYY-MM-DD HH:mm"
              style={{ width: "100%" }}
              placeholder="选择截止时间"
            />
          </Form.Item>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            用户提交后由 AI 即时给出最终分数，并按及格分自动判定结果。
          </Paragraph>
        </Form>
      </Modal>

      {/* 通关详情抽屉 */}
      <Drawer
        open={!!detail}
        title={detail?.exam ? `${detail.exam.title} · 详情` : "通关详情"}
        onClose={() => setDetail(null)}
        width={780}
      >
        {detail?.exam ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div>
              <Space size={[8, 8]} wrap>
                {statusTag(detail.exam.status)}
                <span>应试者：{detail.exam.user_display_name || detail.exam.user_username}</span>
                <span>已尝试 {detail.exam.attempt_count} / {detail.exam.max_attempts}</span>
                <span>及格 {detail.exam.pass_score} 分</span>
              </Space>
            </div>

            {(detail.attempts || []).length === 0 ? (
              <Empty description="该通关尚未开始" />
            ) : (
              <Tabs
                items={(detail.attempts || []).map((a) => ({
                  key: String(a.attempt_no),
                  label: (
                    <Space size={4}>
                      第 {a.attempt_no} 次
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Space size={[8, 8]} wrap>
                        {a.status === "in_progress" ? (
                          <Tag bordered={false} color="processing">进行中</Tag>
                        ) : a.final_is_pass ? (
                          <Tag bordered={false} color="success">及格</Tag>
                        ) : (
                          <Tag bordered={false} color="error">不及格</Tag>
                        )}
                        {a.final_score != null || a.score != null ? (
                          <span>得分 <strong style={{ color: "var(--accent-deep)" }}>{Math.round(a.final_score ?? a.score)}</strong></span>
                        ) : null}
                        <Tag bordered={false}>{a.training_type}</Tag>
                        <Tag bordered={false}>{a.customer_type}</Tag>
                        <Tag bordered={false}>{a.difficulty}</Tag>
                      </Space>

                      {a.review_json ? (
                        <Space direction="vertical" size={16} style={{ width: "100%" }}>
                          <ReviewView review={a.review_json} showHero={false} />
                          <ChatHistoryView messages={a.chat_history} />
                        </Space>
                      ) : (
                        <Empty description="复盘数据未生成" />
                      )}
                    </Space>
                  ),
                }))}
              />
            )}
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
