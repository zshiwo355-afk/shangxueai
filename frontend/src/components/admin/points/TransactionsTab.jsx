import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { useEffect, useState } from "react";

import {
  adminListPointTransactions,
  adminListPointRules,
  adminManualAdjustPoints,
} from "../../../lib/api.points";

const CATEGORY_COLOR = {
  training: "blue",
  course: "green",
  reading: "purple",
  paper: "magenta",
  exam: "volcano",
  manual: "default",
};

export default function TransactionsTab() {
  const { message } = AntdApp.useApp();
  const [filter, setFilter] = useState({ keyword: "", rule_code: "", category: "", days: 30 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState([]);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const result = await adminListPointTransactions({ ...filter, page, page_size: pageSize });
      setData({ items: result.items || [], total: result.total || 0 });
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [page, pageSize, filter]);

  useEffect(() => {
    adminListPointRules()
      .then((list) => setRules(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  const columns = [
    { title: "时间", dataIndex: "created_at", width: 170, render: (v) => v ? v.replace("T", " ").slice(0, 19) : "—" },
    { title: "用户", dataIndex: "user_label", width: 120, render: (v, r) => v || `#${r.user_id}` },
    {
      title: "分类",
      dataIndex: "category",
      width: 100,
      render: (v) => v ? <Tag color={CATEGORY_COLOR[v] || "default"}>{v}</Tag> : "—",
    },
    {
      title: "规则",
      dataIndex: "rule_code",
      width: 180,
      render: (v) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: "积分",
      dataIndex: "points",
      width: 90,
      render: (v) => (
        <strong style={{ color: v >= 0 ? "#52c41a" : "#ff4d4f" }}>{v >= 0 ? `+${v}` : v}</strong>
      ),
    },
    {
      title: "业务",
      key: "business",
      width: 180,
      render: (_, r) => (
        r.business_type ? (
          <span style={{ color: "var(--text-mute)" }}>
            {r.business_type}{r.business_id ? ` #${r.business_id}` : ""}
          </span>
        ) : "—"
      ),
    },
    { title: "备注", dataIndex: "remark", ellipsis: true },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="姓名/工号关键字"
            style={{ width: 200 }}
            value={filter.keyword}
            onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
            onPressEnter={() => { setPage(1); reload(); }}
          />
          <Select
            placeholder="规则"
            style={{ width: 200 }}
            allowClear
            value={filter.rule_code || undefined}
            onChange={(v) => { setFilter((f) => ({ ...f, rule_code: v || "" })); setPage(1); }}
            options={rules.map((r) => ({ label: `${r.name} (${r.code})`, value: r.code }))}
          />
          <Select
            placeholder="分类"
            style={{ width: 130 }}
            allowClear
            value={filter.category || undefined}
            onChange={(v) => { setFilter((f) => ({ ...f, category: v || "" })); setPage(1); }}
            options={["training", "course", "reading", "paper", "exam", "manual"].map((c) => ({ label: c, value: c }))}
          />
          <Select
            value={filter.days}
            style={{ width: 110 }}
            onChange={(v) => { setFilter((f) => ({ ...f, days: v })); setPage(1); }}
            options={[
              { label: "近 7 天", value: 7 },
              { label: "近 30 天", value: 30 },
              { label: "近 90 天", value: 90 },
              { label: "近 365 天", value: 365 },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdjustOpen(true)}>
            手动调分
          </Button>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `共 ${total} 条`,
          onChange: (p, ps) => {
            setPage(p);
            if (ps !== pageSize) setPageSize(ps);
          },
        }}
      />

      {adjustOpen ? (
        <ManualAdjustModal
          onCancel={() => setAdjustOpen(false)}
          onSaved={() => { setAdjustOpen(false); reload(); }}
        />
      ) : null}
    </div>
  );
}

function ManualAdjustModal({ onCancel, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    if (!values.points || Number(values.points) === 0) {
      message.warning("积分不能为 0。");
      return;
    }
    setSubmitting(true);
    try {
      await adminManualAdjustPoints({
        user_id: Number(values.user_id),
        points: Number(values.points),
        remark: values.remark.trim(),
      });
      message.success("已调分。");
      onSaved();
    } catch (err) {
      message.error(err?.message || "操作失败。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title="手动调分"
      onCancel={onCancel}
      onOk={submit}
      okText="提交"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={{ points: 10 }}>
        <Form.Item
          label="用户 ID"
          name="user_id"
          rules={[{ required: true, message: "请输入" }]}
          extra="可在用户管理中查看具体 ID。"
        >
          <InputNumber style={{ width: "100%" }} min={1} />
        </Form.Item>
        <Form.Item
          label="积分（可负数表示扣分）"
          name="points"
          rules={[{ required: true, message: "请输入" }]}
        >
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          label="备注（必填）"
          name="remark"
          rules={[{ required: true, message: "请填写原因" }]}
        >
          <Input.TextArea rows={3} maxLength={500} placeholder="例如：补偿 4 月份漏算训练分" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
