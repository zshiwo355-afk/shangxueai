import { DeleteOutlined, EyeOutlined, FileSearchOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Slider, Space, Tabs, Tag, Table, Typography, App as AntdApp } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  adminBatchCreateExams,
  adminCreateExam,
  adminDeleteExam,
  adminGetExamDetail,
  adminListExams,
  adminListPendingReview,
  adminListUsers,
  adminSubmitReview,
} from "../../lib/api.admin";
import { adminListOptions } from "../../lib/api.options";
import ChatHistoryView from "../ChatHistoryView";
import ReviewView from "../ReviewView";

const { Paragraph, Text } = Typography;

const STATUS_TAGS = {
  pending: { color: "warning", text: "待通关" },
  in_progress: { color: "processing", text: "进行中" },
  pending_review: { color: "gold", text: "待复核" },
  passed: { color: "success", text: "已通过" },
  failed: { color: "error", text: "未通过" },
};

const RANDOM_SENTINEL = "__random__";

function statusTag(status) {
  const cfg = STATUS_TAGS[status] || { color: "default", text: status };
  return <Tag bordered={false} color={cfg.color}>{cfg.text}</Tag>;
}

export default function ExamsTab() {
  const [exams, setExams] = useState([]);
  const [users, setUsers] = useState([]);
  const [options, setOptions] = useState({ training_type: [], difficulty: [], customer_type: [] });
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [reviewingAttempt, setReviewingAttempt] = useState(null); // {attempt, exam}
  const [createForm] = Form.useForm();
  const { message } = AntdApp.useApp();

  const reload = async () => {
    setLoading(true);
    try {
      const [examData, userData, ttData, dffData, ctData, pending] = await Promise.all([
        adminListExams(),
        adminListUsers(),
        adminListOptions("training_type"),
        adminListOptions("difficulty"),
        adminListOptions("customer_type"),
        adminListPendingReview().catch(() => []),
      ]);
      setExams(Array.isArray(examData) ? examData : []);
      setUsers(Array.isArray(userData) ? userData : []);
      setOptions({
        training_type: (ttData || []).filter((o) => o.enabled).map((o) => o.value),
        difficulty: (dffData || []).filter((o) => o.enabled).map((o) => o.value),
        customer_type: (ctData || []).filter((o) => o.enabled).map((o) => o.value),
      });
      setPendingCount(Array.isArray(pending) ? pending.length : 0);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    if (!resolvedUserIds.length) {
      message.warning("当前选择没有命中任何用户。");
      return;
    }
    const payload = {
      title: values.title,
      ai_weight: typeof values.ai_weight === "number" ? values.ai_weight : 0.5,
    };
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
      reload();
    } catch (err) {
      message.error(err?.message || "派发失败。");
    }
  };

  const remove = async (exam) => {
    try {
      await adminDeleteExam(exam.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
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

  const openReview = (attempt, exam) => {
    setReviewingAttempt({ attempt, exam });
  };

  const submitReview = async (values) => {
    try {
      const data = await adminSubmitReview(reviewingAttempt.attempt.id, {
        admin_score: values.admin_score,
        admin_comment: values.admin_comment || "",
      });
      message.success(`复核已提交。最终成绩 ${Math.round(data.attempt.final_score || 0)} 分，${data.attempt.final_is_pass ? "合格 ✓" : "不合格 ✗"}`);
      setReviewingAttempt(null);
      reload();
      if (detail) {
        openDetail({ id: detail.exam.id });
      }
    } catch (err) {
      message.error(err?.message || "复核失败。");
    }
  };

  const userOptions = useMemo(
    () => users.filter((u) => u.role === "user").map((u) => ({
      value: u.id,
      label: `${u.display_name || u.username} (${u.username})`,
    })),
    [users],
  );

  const userPool = useMemo(() => users.filter((u) => u.role === "user"), [users]);

  const departmentOptions = useMemo(() => {
    const counts = new Map();
    userPool.forEach((u) => {
      const dept = (u.department || "").trim();
      if (!dept) return;
      counts.set(dept, (counts.get(dept) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([value, n]) => ({
      value,
      label: `${value}（${n}人）`,
    }));
  }, [userPool]);

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

  const dispatchMode = Form.useWatch("dispatch_mode", createForm);
  const watchedUserIds = Form.useWatch("user_ids", createForm);
  const watchedDepartments = Form.useWatch("departments", createForm);
  const watchedPositions = Form.useWatch("positions", createForm);
  const watchedNewcomerOnly = Form.useWatch("newcomer_only", createForm);

  const resolvedUserIds = useMemo(() => {
    if (dispatchMode === "department") {
      const set = new Set(watchedDepartments || []);
      if (!set.size) return [];
      return userPool
        .filter((u) => set.has((u.department || "").trim()))
        .map((u) => u.id);
    }
    if (dispatchMode === "position") {
      const set = new Set(watchedPositions || []);
      if (!set.size) return [];
      return userPool
        .filter((u) => set.has((u.position || "").trim()))
        .map((u) => u.id);
    }
    if (dispatchMode === "all") {
      return userPool
        .filter((u) => (watchedNewcomerOnly ? u.is_newcomer : true))
        .map((u) => u.id);
    }
    return Array.isArray(watchedUserIds) ? watchedUserIds : [];
  }, [dispatchMode, userPool, watchedUserIds, watchedDepartments, watchedPositions, watchedNewcomerOnly]);

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
      title: "AI / 老师 权重",
      dataIndex: "ai_weight",
      width: 120,
      render: (v) => `${Math.round((v || 0.5) * 100)}% / ${Math.round((1 - (v || 0.5)) * 100)}%`,
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
      title: "操作",
      key: "action",
      width: 200,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>详情</Button>
          <Popconfirm title="确认删除该通关？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Space>
          <span style={{ color: "var(--text-mute)" }}>共 {exams.length} 个通关</span>
          {pendingCount > 0 ? (
            <Badge count={pendingCount} style={{ backgroundColor: "#f59e0b" }}>
              <Tag bordered={false} icon={<FileSearchOutlined />} color="gold" style={{ margin: 0 }}>
                {pendingCount} 个待复核
              </Tag>
            </Badge>
          ) : null}
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreating(true); }}>
          派发通关
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={exams}
        columns={columns}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
        }}
        scroll={{ x: 1100 }}
      />

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
          initialValues={{ ai_weight: 0.5, dispatch_mode: "user", newcomer_only: false }}
        >
          <Form.Item label="派发维度" name="dispatch_mode">
            <Radio.Group
              options={[
                { value: "user", label: "指定用户" },
                { value: "department", label: "按部门" },
                { value: "position", label: "按岗位" },
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
              label="选择部门（可多选）"
              name="departments"
              rules={[{ required: true, message: "请选择至少 1 个部门" }]}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={departmentOptions}
                placeholder={departmentOptions.length ? "选择部门，按部门批量推送" : "暂无可用部门（用户的「部门」字段为空）"}
                disabled={!departmentOptions.length}
                maxTagCount="responsive"
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
          <Form.Item
            label={
              <Space>
                <span>AI 评分占比</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  最终成绩 = AI 分 × 此值 + 老师分 × (1 - 此值)
                </Text>
              </Space>
            }
            name="ai_weight"
          >
            <Slider
              min={0}
              max={1}
              step={0.05}
              marks={{ 0: "全凭老师", 0.5: "各 50%", 1: "全凭 AI" }}
              tooltip={{ formatter: (v) => `AI ${Math.round(v * 100)}% / 老师 ${Math.round((1 - v) * 100)}%` }}
            />
          </Form.Item>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            及格分 60；最多 2 次机会；用户提交后会进入「待复核」状态，需老师人工评分后才决定通过与否。
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
                <span>AI {Math.round(detail.exam.ai_weight * 100)}% / 老师 {Math.round((1 - detail.exam.ai_weight) * 100)}%</span>
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
                      {a.review_pending ? <Badge dot color="gold" /> : null}
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Space size={[8, 8]} wrap>
                        {a.status === "in_progress" ? (
                          <Tag bordered={false} color="processing">进行中</Tag>
                        ) : a.review_pending ? (
                          <Tag bordered={false} color="gold">待复核</Tag>
                        ) : a.final_is_pass ? (
                          <Tag bordered={false} color="success">合格</Tag>
                        ) : (
                          <Tag bordered={false} color="error">不合格</Tag>
                        )}
                        {a.score != null ? <span>AI 分 <strong>{Math.round(a.score)}</strong></span> : null}
                        {a.admin_score != null ? <span>老师分 <strong>{Math.round(a.admin_score)}</strong></span> : null}
                        {a.final_score != null ? <span>综合 <strong style={{ color: "var(--accent-deep)" }}>{Math.round(a.final_score)}</strong></span> : null}
                        <Tag bordered={false}>{a.training_type}</Tag>
                        <Tag bordered={false}>{a.customer_type}</Tag>
                        <Tag bordered={false}>{a.difficulty}</Tag>
                      </Space>

                      {a.review_pending ? (
                        <Button type="primary" onClick={() => openReview(a, detail.exam)}>
                          填写复核分数
                        </Button>
                      ) : a.admin_comment ? (
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          老师评语：{a.admin_comment}
                        </Paragraph>
                      ) : null}

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

      {/* 复核弹窗 */}
      {reviewingAttempt ? (
        <ReviewAttemptModal
          key={reviewingAttempt.attempt.id}
          reviewing={reviewingAttempt}
          onCancel={() => setReviewingAttempt(null)}
          onSubmit={submitReview}
        />
      ) : null}
    </>
  );
}

function ReviewAttemptModal({ reviewing, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const initialValues = useMemo(() => ({
    admin_score: Math.round(reviewing.attempt.score || 0),
    admin_comment: "",
  }), [reviewing]);

  const handleOk = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    await onSubmit(values);
  };

  return (
    <Modal
      open
      title={`复核第 ${reviewing.attempt.attempt_no} 次（AI 分 ${Math.round(reviewing.attempt.score || 0)}）`}
      onCancel={onCancel}
      onOk={handleOk}
      okText="提交复核"
      cancelText="取消"
      width={520}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues}>
        <Form.Item
          label="老师评分（0-100）"
          name="admin_score"
          rules={[
            { required: true, message: "请填分" },
            { type: "number", min: 0, max: 100, message: "0-100 之间" },
          ]}
        >
          <InputNumber min={0} max={100} step={1} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="评语（可选）" name="admin_comment">
          <Input.TextArea rows={4} placeholder="给学员一些反馈" maxLength={1000} showCount />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          本场通关 AI 占比 {Math.round(reviewing.exam.ai_weight * 100)}% / 老师占比 {Math.round((1 - reviewing.exam.ai_weight) * 100)}%；
          及格 {reviewing.exam.pass_score} 分。
        </Typography.Paragraph>
      </Form>
    </Modal>
  );
}
