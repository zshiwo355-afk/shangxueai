import { EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, DatePicker, Drawer, Input, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { adminGetTrainingRecord, adminListTrainingRecords, adminListUsers } from "../../lib/api.admin";
import { adminListOptions } from "../../lib/api.options";
import ChatHistoryView from "../ChatHistoryView";
import ReviewView from "../ReviewView";

const { RangePicker } = DatePicker;
const { Text } = Typography;

const RESULT_OPTIONS = [
  { value: "成交", label: "成交" },
  { value: "意向客户", label: "意向客户" },
  { value: "未成交", label: "未成交" },
];

function resultColor(v) {
  if (v === "成交") return "success";
  if (v === "意向客户") return "processing";
  if (v === "未成交") return "default";
  return "default";
}

export default function TrainingRecordsPanel() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [options, setOptions] = useState({ training_type: [], difficulty: [], customer_type: [] });

  // filters
  const [keyword, setKeyword] = useState("");
  const [filterUserId, setFilterUserId] = useState();
  const [filterTrainingType, setFilterTrainingType] = useState();
  const [filterDifficulty, setFilterDifficulty] = useState();
  const [filterCustomerType, setFilterCustomerType] = useState();
  const [filterResult, setFilterResult] = useState();
  const [dateRange, setDateRange] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const params = useMemo(() => {
    const p = { page, page_size: pageSize };
    if (keyword.trim()) p.keyword = keyword.trim();
    if (filterUserId) p.user_id = filterUserId;
    if (filterTrainingType) p.training_type = filterTrainingType;
    if (filterDifficulty) p.difficulty = filterDifficulty;
    if (filterCustomerType) p.customer_type = filterCustomerType;
    if (filterResult) p.result = filterResult;
    if (dateRange?.[0]) p.date_from = dateRange[0].toISOString();
    if (dateRange?.[1]) p.date_to = dateRange[1].toISOString();
    return p;
  }, [page, pageSize, keyword, filterUserId, filterTrainingType, filterDifficulty, filterCustomerType, filterResult, dateRange]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListTrainingRecords(params);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [params]);

  useEffect(() => {
    Promise.all([
      adminListUsers().catch(() => []),
      adminListOptions("training_type").catch(() => []),
      adminListOptions("difficulty").catch(() => []),
      adminListOptions("customer_type").catch(() => []),
    ]).then(([userData, ttData, dffData, ctData]) => {
      setUsers(Array.isArray(userData) ? userData : []);
      setOptions({
        training_type: (ttData || []).filter((o) => o.enabled).map((o) => o.value),
        difficulty: (dffData || []).filter((o) => o.enabled).map((o) => o.value),
        customer_type: (ctData || []).filter((o) => o.enabled).map((o) => o.value),
      });
    });
  }, []);

  const userOptions = useMemo(
    () => users.filter((u) => u.role === "user").map((u) => ({
      value: u.id,
      label: `${u.real_name || u.display_name || u.username}（${u.username}）`,
    })),
    [users],
  );

  const openDetail = async (row) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await adminGetTrainingRecord(row.id);
      setDetail(data);
    } catch (err) {
      message.error(err?.message || "详情加载失败。");
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    {
      title: "训练人",
      key: "user",
      width: 180,
      render: (_, row) => (
        <div>
          <div>{row.user_display_name || row.user_username}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.user_username}{row.department ? ` · ${row.department}` : ""}</Text>
        </div>
      ),
    },
    { title: "训练类型", dataIndex: "training_type", width: 130, render: (v) => v || "—" },
    { title: "难度", dataIndex: "difficulty", width: 90, render: (v) => v || "—" },
    { title: "客户类型", dataIndex: "customer_type", width: 130, render: (v) => v || "—" },
    {
      title: "得分",
      dataIndex: "score",
      width: 80,
      render: (v) => v == null ? "—" : <strong>{Math.round(v)}</strong>,
    },
    {
      title: "结果",
      dataIndex: "result",
      width: 100,
      render: (v) => v ? <Tag bordered={false} color={resultColor(v)}>{v}</Tag> : "—",
    },
    {
      title: "合格",
      dataIndex: "is_pass",
      width: 70,
      render: (v) => v == null ? "—" : (v ? <Tag color="success" bordered={false}>合格</Tag> : <Tag color="error" bordered={false}>不合格</Tag>),
    },
    {
      title: "时间",
      dataIndex: "created_at",
      width: 150,
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "操作",
      key: "action",
      width: 90,
      fixed: "right",
      render: (_, row) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>查看</Button>
      ),
    },
  ];

  const resetFilters = () => {
    setKeyword("");
    setFilterUserId(undefined);
    setFilterTrainingType(undefined);
    setFilterDifficulty(undefined);
    setFilterCustomerType(undefined);
    setFilterResult(undefined);
    setDateRange(null);
    setPage(1);
  };

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="按用户名 / 姓名搜索"
          style={{ width: 220 }}
          value={keyword}
          onChange={(e) => { setPage(1); setKeyword(e.target.value); }}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="按训练人筛选"
          style={{ width: 220 }}
          options={userOptions}
          value={filterUserId}
          onChange={(v) => { setPage(1); setFilterUserId(v); }}
        />
        <Select
          allowClear
          placeholder="训练类型"
          style={{ width: 140 }}
          options={options.training_type.map((v) => ({ value: v, label: v }))}
          value={filterTrainingType}
          onChange={(v) => { setPage(1); setFilterTrainingType(v); }}
        />
        <Select
          allowClear
          placeholder="难度"
          style={{ width: 110 }}
          options={options.difficulty.map((v) => ({ value: v, label: v }))}
          value={filterDifficulty}
          onChange={(v) => { setPage(1); setFilterDifficulty(v); }}
        />
        <Select
          allowClear
          placeholder="客户类型"
          style={{ width: 140 }}
          options={options.customer_type.map((v) => ({ value: v, label: v }))}
          value={filterCustomerType}
          onChange={(v) => { setPage(1); setFilterCustomerType(v); }}
        />
        <Select
          allowClear
          placeholder="结果"
          style={{ width: 130 }}
          options={RESULT_OPTIONS}
          value={filterResult}
          onChange={(v) => { setPage(1); setFilterResult(v); }}
        />
        <RangePicker
          showTime={{ format: "HH:mm" }}
          value={dateRange}
          onChange={(v) => { setPage(1); setDateRange(v); }}
        />
        <Button onClick={resetFilters}>重置</Button>
        <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        <span style={{ color: "var(--text-mute)" }}>共 {total} 条记录</span>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
          pageSizeOptions: ["20", "50", "100"],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        scroll={{ x: 1200 }}
      />

      <Drawer
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        width={780}
        title={detail ? `${detail.training_type} · ${detail.difficulty} · ${detail.customer_type}` : "训练记录详情"}
        destroyOnHidden
      >
        {detailLoading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>加载中…</div>
        ) : detail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space wrap>
              <Tag bordered={false}>训练时间：{detail.created_at ? dayjs(detail.created_at).format("YYYY-MM-DD HH:mm") : "—"}</Tag>
              {detail.score != null ? <Tag bordered={false} color="blue">得分 {Math.round(detail.score)}</Tag> : null}
              {detail.result ? <Tag bordered={false} color={resultColor(detail.result)}>{detail.result}</Tag> : null}
              {detail.is_pass != null ? (
                detail.is_pass ? <Tag color="success" bordered={false}>合格</Tag> : <Tag color="error" bordered={false}>不合格</Tag>
              ) : null}
            </Space>
            {detail.review ? (
              <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>AI 复盘</Text>
                <ReviewView review={detail.review} />
              </div>
            ) : null}
            {Array.isArray(detail.chat_history) && detail.chat_history.length ? (
              <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>对话记录</Text>
                <ChatHistoryView messages={detail.chat_history} />
              </div>
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
