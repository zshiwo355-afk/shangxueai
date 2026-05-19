import { DeleteOutlined, EyeOutlined, FileSearchOutlined, PlusOutlined } from "@ant-design/icons";
import { Badge, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Slider, Space, Tabs, Tag, Table, Typography, App as AntdApp } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
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
  pending: { color: "warning", text: "待考试" },
  in_progress: { color: "processing", text: "进行中" },
  pending_review: { color: "gold", text: "待复核" },
  passed: { color: "success", text: "已通过" },
  failed: { color: "error", text: "未通过" },
};

const RANDOM_SENTINEL = "__random__";

function statusTag(status) {
  const cfg = STATUS_TAGS[status] || { color: "default", text: status };
  return <Tag color={cfg.color}>{cfg.text}</Tag>;
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
  const [reviewForm] = Form.useForm();
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
    const payload = {
      user_id: values.user_id,
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
      await adminCreateExam(payload);
      message.success("考试已派发。");
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
    reviewForm.resetFields();
    reviewForm.setFieldsValue({
      admin_score: Math.round(attempt.score || 0),
      admin_comment: "",
    });
    setReviewingAttempt({ attempt, exam });
  };

  const submitReview = async () => {
    const values = await reviewForm.validateFields();
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
          <Tag color={row.fixed_training_type ? "blue" : "default"}>
            类型：{row.fixed_training_type || "随机"}
          </Tag>
          <Tag color={row.fixed_difficulty ? "blue" : "default"}>
            难度：{row.fixed_difficulty || "随机"}
          </Tag>
          <Tag color={row.fixed_customer_type ? "blue" : "default"}>
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
      title: "操作",
      key: "action",
      width: 200,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>详情</Button>
          <Popconfirm title="确认删除该考试？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
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
          <span style={{ color: "var(--text-mute)" }}>共 {exams.length} 个考试</span>
          {pendingCount > 0 ? (
            <Badge count={pendingCount} style={{ backgroundColor: "#f59e0b" }}>
              <Tag icon={<FileSearchOutlined />} color="gold" style={{ margin: 0 }}>
                {pendingCount} 个待复核
              </Tag>
            </Badge>
          ) : null}
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreating(true); }}>
          派发考试
        </Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={exams} columns={columns} pagination={{ pageSize: 20 }} />

      {/* 派发考试弹窗 */}
      <Modal
        open={creating}
        title="派发考试"
        onCancel={() => setCreating(false)}
        onOk={submitCreate}
        okText="派发"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" preserve={false} initialValues={{ ai_weight: 0.5 }}>
          <Form.Item label="应试用户" name="user_id" rules={[{ required: true, message: "请选择" }]}>
            <Select
              showSearch
              placeholder="选择一个普通用户"
              options={userOptions}
              filterOption={(input, opt) => (opt?.label || "").toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item label="考试标题" name="title" initialValue="陪练考试">
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

      {/* 考试详情抽屉 */}
      <Drawer
        open={!!detail}
        title={detail?.exam ? `${detail.exam.title} · 详情` : "考试详情"}
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
              <Empty description="该考试尚未开始" />
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
                          <Tag color="processing">进行中</Tag>
                        ) : a.review_pending ? (
                          <Tag color="gold">待复核</Tag>
                        ) : a.final_is_pass ? (
                          <Tag color="success">合格</Tag>
                        ) : (
                          <Tag color="error">不合格</Tag>
                        )}
                        {a.score != null ? <span>AI 分 <strong>{Math.round(a.score)}</strong></span> : null}
                        {a.admin_score != null ? <span>老师分 <strong>{Math.round(a.admin_score)}</strong></span> : null}
                        {a.final_score != null ? <span>综合 <strong style={{ color: "var(--accent-deep)" }}>{Math.round(a.final_score)}</strong></span> : null}
                        <Tag>{a.training_type}</Tag>
                        <Tag>{a.customer_type}</Tag>
                        <Tag>{a.difficulty}</Tag>
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
      <Modal
        open={!!reviewingAttempt}
        title={reviewingAttempt ? `复核第 ${reviewingAttempt.attempt.attempt_no} 次（AI 分 ${Math.round(reviewingAttempt.attempt.score || 0)}）` : "复核"}
        onCancel={() => setReviewingAttempt(null)}
        onOk={submitReview}
        okText="提交复核"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={reviewForm} layout="vertical" preserve={false}>
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
          {reviewingAttempt ? (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              本场考试 AI 占比 {Math.round(reviewingAttempt.exam.ai_weight * 100)}% / 老师占比 {Math.round((1 - reviewingAttempt.exam.ai_weight) * 100)}%；
              及格 {reviewingAttempt.exam.pass_score} 分。
            </Paragraph>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}
