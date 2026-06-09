import { DeleteOutlined, EyeOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { adminListUsers } from "../../../lib/api.admin";
import { fetchOptions } from "../../../lib/api.options";
import {
  bulkDeleteAssignments,
  bulkPushAssignmentsWeCom,
  createAssignments,
  deleteAssignment,
  listAssignments,
  listPapers,
  listSubmissions,
  pushAssignmentWeCom,
} from "../../../lib/api.papers";
import DepartmentUserTreeSelect, { resolveDepartmentSelectionUserIds } from "../../common/DepartmentUserTreeSelect";
import GradeSubmissionDrawer from "./GradeSubmissionDrawer";

const STATUS_TAG = {
  pending: { color: "default", text: "未开始" },
  in_progress: { color: "processing", text: "进行中" },
  pending_review: { color: "gold", text: "待复核" },
  graded: { color: "success", text: "已评分" },
  expired: { color: "red", text: "已过期" },
};

const PUSH_TAG = {
  none: { color: "default", text: "未推送" },
  pending: { color: "blue", text: "已加入队列" },
  sent: { color: "success", text: "已送达" },
  failed: { color: "error", text: "失败" },
};

const SUB_STATUS_TAG = {
  in_progress: { color: "processing", text: "进行中" },
  submitted: { color: "gold", text: "待复核" },
  graded: { color: "success", text: "已评分" },
};
const JOB_LEVEL_OPTIONS = [
  { value: "M线", label: "M线" },
  { value: "P线", label: "P线" },
  { value: "L线", label: "L线" },
];

export default function AssignmentsPanel() {
  const { message, modal } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [papers, setPapers] = useState([]);
  const [users, setUsers] = useState([]);
  const [createForm] = Form.useForm();
  const [submissionsOpen, setSubmissionsOpen] = useState(null); // assignment row
  const [submissions, setSubmissions] = useState([]);
  const [gradingId, setGradingId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [employmentStatusOptions, setEmploymentStatusOptions] = useState([]);

  const reload = async () => {
    setLoading(true);
    try {
      const [a, p, u, opt] = await Promise.all([
        listAssignments({ page, page_size: pageSize }),
        listPapers({ status: "published" }).catch(() => []),
        adminListUsers().catch(() => []),
        fetchOptions().catch(() => ({})),
      ]);
      setItems(Array.isArray(a?.items) ? a.items : (Array.isArray(a) ? a : []));
      setTotal(Number(a?.total ?? (Array.isArray(a) ? a.length : 0)));
      setEmploymentStatusOptions(Array.isArray(opt?.employment_status) ? opt.employment_status : []);
      setPapers(Array.isArray(p) ? p : []);
      setUsers(Array.isArray(u) ? u : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [page, pageSize]);

  const assignableUsers = useMemo(
    () => users.filter((u) => u.role === "user" || u.role === "admin"),
    [users],
  );

  const userOptions = useMemo(
    () => assignableUsers.map((u) => ({
      value: u.id,
      label: `${u.real_name || u.display_name || u.username}（${u.username}）${u.department ? ` · ${u.department}` : ""}`,
    })),
    [assignableUsers],
  );

  // 阅卷人仅允许管理员账号
  const reviewerOptions = useMemo(
    () => users
      .filter((u) => u.role === "admin")
      .map((u) => ({
        value: u.id,
        label: `${u.real_name || u.display_name || u.username} (${u.username})${u.department ? ` · ${u.department}` : ""}`,
      })),
    [users],
  );

  const positionOptions = useMemo(() => {
    const counts = new Map();
    assignableUsers.forEach((u) => {
      const pos = (u.position || "").trim();
      if (!pos) return;
      counts.set(pos, (counts.get(pos) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([value, n]) => ({
      value,
      label: `${value}（${n}人）`,
    }));
  }, [assignableUsers]);

  const dispatchMode = Form.useWatch("dispatch_mode", createForm);
  const watchedUserIds = Form.useWatch("user_ids", createForm);
  const watchedDepartments = Form.useWatch("departments", createForm);
  const watchedPositions = Form.useWatch("positions", createForm);
  const watchedJobLevels = Form.useWatch("job_levels", createForm);
  const watchedEmploymentStatuses = Form.useWatch("employment_statuses", createForm);
  const watchedNewcomerOnly = Form.useWatch("newcomer_only", createForm);

  const resolvedUserIds = useMemo(() => {
    if (dispatchMode === "department") {
      return resolveDepartmentSelectionUserIds(watchedDepartments, assignableUsers);
    }
    if (dispatchMode === "position") {
      const set = new Set(watchedPositions || []);
      if (!set.size) return [];
      return assignableUsers
        .filter((u) => set.has((u.position || "").trim()))
        .map((u) => u.id);
    }
    if (dispatchMode === "employment_status") {
      const set = new Set(watchedEmploymentStatuses || []);
      if (!set.size) return [];
      return assignableUsers
        .filter((u) => set.has((u.employment_status || "").trim()))
        .map((u) => u.id);
    }
    if (dispatchMode === "job_level") {
      const set = new Set(watchedJobLevels || []);
      if (!set.size) return [];
      return assignableUsers
        .filter((u) => set.has(u.job_level || "M线"))
        .map((u) => u.id);
    }
    if (dispatchMode === "all") {
      return assignableUsers
        .filter((u) => (watchedNewcomerOnly ? u.is_newcomer : true))
        .map((u) => u.id);
    }
    return Array.isArray(watchedUserIds) ? watchedUserIds : [];
  }, [dispatchMode, assignableUsers, watchedUserIds, watchedDepartments, watchedPositions, watchedJobLevels, watchedEmploymentStatuses, watchedNewcomerOnly]);

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    if (!resolvedUserIds.length) {
      message.warning("当前选择没有命中任何用户。");
      return;
    }
    try {
      await createAssignments({
        paper_id: values.paper_id,
        user_ids: resolvedUserIds,
        reviewer_id: values.reviewer_id || null,
        reward_points: Number(values.reward_points ?? 30),
        max_attempts: values.max_attempts,
        deadline_at: values.deadline_at ? dayjs(values.deadline_at).toISOString() : null,
      });
      message.success(`已派发到 ${resolvedUserIds.length} 位用户。`);
      setCreating(false);
      reload();
    } catch (err) {
      message.error(err?.message || "派发失败。");
    }
  };

  const remove = async (row, force = false) => {
    try {
      await deleteAssignment(row.id, force);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const push = async (row) => {
    try {
      const updated = await pushAssignmentWeCom(row.id);
      if (updated.wecom_push_status === "sent") {
        message.success("企业微信推送成功。");
      } else if (updated.wecom_push_status === "failed") {
        message.warning(updated.wecom_push_error || "企业微信推送失败，已记录失败原因。");
      } else {
        message.info("企业微信推送状态已更新。");
      }
      setItems((arr) => arr.map((it) => (it.id === updated.id ? updated : it)));
    } catch (err) {
      message.error(err?.message || "推送失败。");
    }
  };

  const runBulkPush = async () => {
    setBulkBusy(true);
    try {
      const res = await bulkPushAssignmentsWeCom(selectedIds);
      const sent = Number(res?.sent || 0);
      const failed = Number(res?.failed || 0);
      if (sent > 0 && failed === 0) {
        message.success(`已加入推送队列：${sent} 条。`);
      } else if (sent > 0 && failed > 0) {
        message.warning(`成功 ${sent} 条，失败 ${failed} 条；详情见列表「企微推送」列。`);
      } else {
        message.error(`全部 ${failed} 条推送失败。`);
      }
      setSelectedIds([]);
      reload();
    } catch (err) {
      message.error(err?.message || "批量推送失败。");
    } finally {
      setBulkBusy(false);
    }
  };

  const performBulkDelete = async (force) => {
    setBulkBusy(true);
    try {
      const res = await bulkDeleteAssignments(selectedIds, force);
      const deleted = Number(res?.deleted || 0);
      const skipped = Number(res?.skipped_count || 0);
      const deletedSubs = Number(res?.deleted_submissions || 0);
      if (skipped > 0 && !force) {
        modal.confirm({
          title: `${skipped} 条派发已有提交记录`,
          content: `已删除 ${deleted} 条；剩下 ${skipped} 条带有提交，强制删除会同时清掉这些提交（共约 ${res?.skipped?.length || skipped} 条）。是否继续？`,
          okText: "强制删除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: async () => {
            // 用 skipped 列表重新强删
            try {
              const r2 = await bulkDeleteAssignments(res.skipped, true);
              const d2 = Number(r2?.deleted || 0);
              const ds2 = Number(r2?.deleted_submissions || 0);
              message.success(`再删除 ${d2} 条派发（连同 ${ds2} 条提交）。`);
              setSelectedIds([]);
              reload();
            } catch (err) {
              message.error(err?.message || "强制删除失败。");
            }
          },
        });
      } else if (deleted > 0) {
        message.success(force && deletedSubs > 0
          ? `已删除 ${deleted} 条派发（连同 ${deletedSubs} 条提交）。`
          : `已删除 ${deleted} 条派发。`);
      } else {
        message.warning("没有可删除的派发任务。");
      }
      setSelectedIds([]);
      reload();
    } catch (err) {
      message.error(err?.message || "批量删除失败。");
    } finally {
      setBulkBusy(false);
    }
  };

  const openSubmissions = async (row) => {
    setSubmissionsOpen(row);
    setSubmissions([]);
    try {
      const data = await listSubmissions(row.id);
      setSubmissions(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载提交记录失败。");
    }
  };

  const reloadSubmissions = async () => {
    if (!submissionsOpen) return;
    try {
      const data = await listSubmissions(submissionsOpen.id);
      setSubmissions(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载提交记录失败。");
    }
    reload();
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "试卷", dataIndex: "paper_title", ellipsis: true },
    { title: "应试者", dataIndex: "user_display_name", width: 150 },
    {
      title: "奖励积分",
      dataIndex: "reward_points",
      width: 100,
      render: (value) => value ?? "规则默认",
    },
    {
      key: "reviewer",
      title: "阅卷人",
      dataIndex: "reviewer_display_name",
      width: 130,
      render: (value) => value || "未指定",
    },
    {
      title: "尝试",
      key: "attempts",
      width: 80,
      render: (_, row) => `${row.attempt_count}/${row.max_attempts}`,
    },
    {
      title: "截止",
      dataIndex: "deadline_at",
      width: 180,
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v) => {
        const cfg = STATUS_TAG[v] || { color: "default", text: v };
        return <Tag color={cfg.color} bordered={false}>{cfg.text}</Tag>;
      },
    },
    {
      title: "提交",
      key: "subs",
      width: 100,
      render: (_, row) => (
        <Space size={4}>
          <Tag bordered={false}>共 {row.submission_count}</Tag>
          {row.pending_review_count > 0 ? <Badge count={row.pending_review_count} color="#f59e0b" /> : null}
        </Space>
      ),
    },
    {
      title: "成绩",
      key: "score",
      width: 100,
      render: (_, row) => row.last_final_score == null ? "—" : (
        <Space size={4}>
          <strong style={{ color: "var(--accent-deep, #1677ff)" }}>{Math.round(row.last_final_score)}</strong>
          {row.last_is_pass != null ? (
            row.last_is_pass ? <Tag color="success" bordered={false}>合格</Tag> : <Tag color="error" bordered={false}>不合格</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: "企微推送",
      dataIndex: "wecom_push_status",
      width: 110,
      render: (v, row) => {
        const cfg = PUSH_TAG[v] || { color: "default", text: v };
        const tag = <Tag color={cfg.color} bordered={false}>{cfg.text}</Tag>;
        if (v !== "failed" || !row.wecom_push_error) return tag;
        return <Tooltip title={row.wecom_push_error}>{tag}</Tooltip>;
      },
    },
    {
      title: "派发时间",
      dataIndex: "created_at",
      width: 160,
      sorter: (a, b) => dayjs(a.created_at || 0).valueOf() - dayjs(b.created_at || 0).valueOf(),
      defaultSortOrder: "descend",
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "操作",
      key: "action",
      width: 280,
      render: (_, row) => {
        const hasSubs = row.submission_count > 0;
        return (
          <Space wrap>
            <Button size="small" icon={<EyeOutlined />} onClick={() => openSubmissions(row)}>复核</Button>
            <Button size="small" icon={<SendOutlined />} onClick={() => push(row)}>推送企微</Button>
            <Popconfirm
              title={hasSubs ? "强制删除会同时清掉提交记录" : "确认删除该派发？"}
              description={hasSubs ? `该派发有 ${row.submission_count} 条提交记录，确认级联删除？` : null}
              okText={hasSubs ? "强制删除" : "删除"}
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => remove(row, hasSubs)}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                {hasSubs ? "强删" : "删除"}
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const subsColumns = [
    { title: "次数", dataIndex: "attempt_no", width: 60 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v) => {
        const cfg = SUB_STATUS_TAG[v] || { color: "default", text: v };
        return <Tag color={cfg.color} bordered={false}>{cfg.text}</Tag>;
      },
    },
    { title: "AI 分", dataIndex: "auto_score", width: 70, render: (v) => v == null ? "—" : Math.round(v) },
    { title: "人工分", dataIndex: "manual_score", width: 70, render: (v) => v == null ? "—" : Math.round(v) },
    {
      title: "最终",
      dataIndex: "final_score",
      width: 80,
      render: (v) => v == null ? "—" : <strong>{Math.round(v)}</strong>,
    },
    {
      title: "结果",
      dataIndex: "is_pass",
      width: 80,
      render: (v) => v == null ? "—" : (v ? <Tag color="success" bordered={false}>合格</Tag> : <Tag color="error" bordered={false}>不合格</Tag>),
    },
    {
      title: "提交时间",
      dataIndex: "submitted_at",
      width: 160,
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_, row) => (
        <Button size="small" type={row.status === "submitted" ? "primary" : "default"} onClick={() => setGradingId(row.id)}>
          复核
        </Button>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-mute)" }}>共 {items.length} 个派发任务</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreating(true); }}>
          派发试卷
        </Button>
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
        scroll={{ x: 1280 }}
      />

      {selectedIds.length > 0 ? (
        <div className="bulk-action-bar">
          <span className="bulk-action-bar__count">
            已选 <strong>{selectedIds.length}</strong> 条派发
          </span>
          <div className="bulk-action-bar__actions">
            <Button onClick={() => setSelectedIds([])} disabled={bulkBusy}>取消选择</Button>
            <Button
              icon={<SendOutlined />}
              loading={bulkBusy}
              onClick={runBulkPush}
            >
              批量推送企微
            </Button>
            <Popconfirm
              title={`确认删除选中的 ${selectedIds.length} 条派发？`}
              description="带提交记录的派发会被跳过，可二次确认强制删除。"
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

      <Modal
        open={creating}
        title="派发试卷"
        onCancel={() => setCreating(false)}
        onOk={submitCreate}
        okText={`派发到 ${resolvedUserIds.length} 人`}
        okButtonProps={{ disabled: !resolvedUserIds.length }}
        cancelText="取消"
        width={640}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          preserve={false}
          initialValues={{ max_attempts: 1, reward_points: 30, dispatch_mode: "user", newcomer_only: false }}
        >
          <Form.Item label="选择试卷（仅已发布）" name="paper_id" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={papers.map((p) => ({ value: p.id, label: `${p.title}（${p.question_count}题/${p.total_score}分）` }))}
              placeholder="选择一份已发布的试卷"
            />
          </Form.Item>

          <Form.Item
            label="阅卷人"
            name="reviewer_id"
            rules={[{ required: true, message: "请选择阅卷人" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={reviewerOptions}
              placeholder="选择提交提醒接收人"
            />
          </Form.Item>

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
                users={assignableUsers}
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
                optionFilterProp="label"
                options={employmentStatusOptions.map((s) => ({ value: s, label: s }))}
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
              : "尚未命中任何用户（已派发过的用户会被自动跳过）"}
          />

          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item label="最大答题次数" name="max_attempts">
                <InputNumber min={1} max={10} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label="通过奖励积分"
                name="reward_points"
                rules={[{ required: true, message: "请填写奖励积分" }]}
              >
                <InputNumber min={0} max={100000} step={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="截止时间（可空）" name="deadline_at">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Drawer
        open={!!submissionsOpen}
        onClose={() => setSubmissionsOpen(null)}
        width={780}
        title={submissionsOpen ? `${submissionsOpen.paper_title} · ${submissionsOpen.user_display_name} 的提交` : ""}
        destroyOnHidden
      >
        {submissions.length ? (
          <Table rowKey="id" size="small" pagination={false} dataSource={submissions} columns={subsColumns} />
        ) : (
          <Empty description="尚无提交记录" />
        )}
      </Drawer>

      <GradeSubmissionDrawer
        submissionId={gradingId}
        open={!!gradingId}
        onClose={() => setGradingId(null)}
        onGraded={reloadSubmissions}
      />
    </>
  );
}
