import { EyeOutlined, ReloadOutlined, SearchOutlined, CheckCircleFilled, CloseCircleFilled, ClockCircleFilled, BellOutlined, DeleteOutlined, RedoOutlined } from "@ant-design/icons";
import { App as AntdApp, Alert, Badge, Button, Card, Col, DatePicker, Drawer, Descriptions, Input, Popconfirm, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  adminBulkDeleteNotifications,
  adminBulkResendNotifications,
  adminGetNotificationDetail,
  adminGetNotificationStats,
  adminListNotificationEventTypes,
  adminListNotifications,
  adminResendNotification,
} from "../../lib/api.notifications";

const { RangePicker } = DatePicker;
const { Text, Paragraph } = Typography;

const STATUS_OPTIONS = [
  { value: "sent", label: "已发送" },
  { value: "failed", label: "失败" },
  { value: "pending", label: "待发送" },
];

const BUSINESS_TYPE_OPTIONS = [
  { value: "paper_assignment", label: "试卷派发" },
  { value: "paper_submission", label: "试卷提交" },
  { value: "exam", label: "AI通关" },
];

function statusTag(status, label) {
  const norm = String(status || "pending").toLowerCase();
  if (norm === "sent") return <Tag color="success" bordered={false} icon={<CheckCircleFilled />}>{label || "已发送"}</Tag>;
  if (norm === "failed") return <Tag color="error" bordered={false} icon={<CloseCircleFilled />}>{label || "失败"}</Tag>;
  return <Tag color="warning" bordered={false} icon={<ClockCircleFilled />}>{label || "待发送"}</Tag>;
}

function tryPrettyJson(jsonStr) {
  if (!jsonStr) return "";
  try {
    return JSON.stringify(JSON.parse(jsonStr), null, 2);
  } catch {
    return jsonStr;
  }
}

function stripHtml(text) {
  if (!text) return "";
  return String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default function NotificationsTab() {
  const { message } = AntdApp.useApp();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState(null);
  const [eventTypes, setEventTypes] = useState([]);

  // filters
  const [filterStatus, setFilterStatus] = useState();
  const [filterEventType, setFilterEventType] = useState();
  const [filterBusinessType, setFilterBusinessType] = useState();
  const [keyword, setKeyword] = useState("");
  const [dateRange, setDateRange] = useState(null);

  // detail
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // bulk
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [resendBusyId, setResendBusyId] = useState(null);
  const [bulkResendBusy, setBulkResendBusy] = useState(false);

  const params = useMemo(() => {
    const p = { page, page_size: pageSize };
    if (filterStatus) p.status = filterStatus;
    if (filterEventType) p.event_type = filterEventType;
    if (filterBusinessType) p.business_type = filterBusinessType;
    if (keyword.trim()) p.keyword = keyword.trim();
    if (dateRange?.[0]) p.start_time = dateRange[0].toISOString();
    if (dateRange?.[1]) p.end_time = dateRange[1].toISOString();
    return p;
  }, [page, pageSize, filterStatus, filterEventType, filterBusinessType, keyword, dateRange]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListNotifications(params);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  const reloadStats = async () => {
    try {
      const data = await adminGetNotificationStats();
      setStats(data);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => { reload(); }, [params]);

  useEffect(() => {
    reloadStats();
    adminListNotificationEventTypes()
      .then((rows) => setEventTypes(Array.isArray(rows) ? rows : []))
      .catch(() => setEventTypes([]));
  }, []);

  const eventTypeOptions = useMemo(
    () => eventTypes.map((row) => ({
      value: row.value,
      label: row.count > 0 ? `${row.label}（${row.count}）` : row.label,
    })),
    [eventTypes],
  );

  const openDetail = async (row) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await adminGetNotificationDetail(row.id);
      setDetail(data);
    } catch (err) {
      message.error(err?.message || "详情加载失败。");
    } finally {
      setDetailLoading(false);
    }
  };

  const resetFilters = () => {
    setFilterStatus(undefined);
    setFilterEventType(undefined);
    setFilterBusinessType(undefined);
    setKeyword("");
    setDateRange(null);
    setPage(1);
  };

  const refreshAll = () => {
    reload();
    reloadStats();
  };

  const bulkDelete = async () => {
    if (!selectedIds.length) return;
    setBulkBusy(true);
    try {
      const res = await adminBulkDeleteNotifications(selectedIds);
      const deleted = Number(res?.deleted || 0);
      message.success(deleted > 0 ? `已删除 ${deleted} 条推送记录。` : "未删除任何记录。");
      setSelectedIds([]);
      refreshAll();
    } catch (err) {
      message.error(err?.message || "批量删除失败。");
    } finally {
      setBulkBusy(false);
    }
  };

  const resendOne = async (row) => {
    setResendBusyId(row.id);
    try {
      const res = await adminResendNotification(row.id);
      const status = String(res?.status || "").toLowerCase();
      if (status === "sent") {
        message.success("已重新发送。");
      } else if (status === "skipped") {
        message.warning(res?.message || "已跳过：业务对象不存在或不可重推。");
      } else {
        message.error(res?.message || "重推失败。");
      }
      refreshAll();
    } catch (err) {
      message.error(err?.message || "重推失败。");
    } finally {
      setResendBusyId(null);
    }
  };

  const bulkResend = async () => {
    if (!selectedIds.length) return;
    setBulkResendBusy(true);
    try {
      const res = await adminBulkResendNotifications(selectedIds);
      const sent = Number(res?.sent || 0);
      const failed = Number(res?.failed || 0);
      const skipped = Number(res?.skipped || 0);
      const parts = [];
      if (sent) parts.push(`成功 ${sent}`);
      if (failed) parts.push(`失败 ${failed}`);
      if (skipped) parts.push(`跳过 ${skipped}`);
      const summary = parts.join(" · ") || "无可处理记录";
      if (failed > 0 && sent === 0) {
        message.error(`批量重推：${summary}`);
      } else if (sent > 0) {
        message.success(`批量重推完成：${summary}`);
      } else {
        message.warning(`批量重推：${summary}`);
      }
      setSelectedIds([]);
      refreshAll();
    } catch (err) {
      message.error(err?.message || "批量重推失败。");
    } finally {
      setBulkResendBusy(false);
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 80 },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (_, row) => statusTag(row.status, row.status_label),
    },
    {
      title: "类型",
      key: "event",
      width: 170,
      render: (_, row) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.4 }}>
          <span>{row.event_label || row.event_type}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.event_type}</Text>
        </Space>
      ),
    },
    {
      title: "标题 / 摘要",
      key: "title",
      ellipsis: true,
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.title || "—"}</div>
          {row.description ? (
            <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
              {stripHtml(row.description)}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      title: "接收人",
      key: "recipient",
      width: 200,
      render: (_, row) => {
        const name = row.recipient_display_name || row.recipient_username;
        if (!name && !row.recipient_wecom_userid) return <Text type="secondary">—</Text>;
        return (
          <div style={{ lineHeight: 1.4 }}>
            <div>{name || "（未绑定用户）"}</div>
            {row.recipient_wecom_userid ? (
              <Text type="secondary" style={{ fontSize: 12 }}>userid: {row.recipient_wecom_userid}</Text>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "业务",
      key: "business",
      width: 160,
      render: (_, row) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.4 }}>
          <Text style={{ fontSize: 12 }}>{row.business_type || "—"}</Text>
          {row.business_id != null ? <Text type="secondary" style={{ fontSize: 12 }}>#{row.business_id}</Text> : null}
        </Space>
      ),
    },
    {
      title: "失败原因",
      dataIndex: "error",
      width: 220,
      render: (v) => v ? (
        <Text type="danger" style={{ fontSize: 12 }} ellipsis={{ tooltip: v }}>{v}</Text>
      ) : <Text type="secondary">—</Text>,
    },
    {
      title: "创建 / 发送时间",
      key: "time",
      width: 180,
      render: (_, row) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.4, fontSize: 12 }}>
          <span>建：{row.created_at ? dayjs(row.created_at).format("MM-DD HH:mm:ss") : "—"}</span>
          <Text type="secondary">发：{row.sent_at ? dayjs(row.sent_at).format("MM-DD HH:mm:ss") : "—"}</Text>
        </Space>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 160,
      fixed: "right",
      render: (_, row) => {
        const status = String(row.status || "").toLowerCase();
        const canResend = status === "failed" || status === "pending";
        return (
          <Space size={4}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>详情</Button>
            {canResend ? (
              <Button
                size="small"
                type="link"
                icon={<RedoOutlined />}
                loading={resendBusyId === row.id}
                onClick={() => resendOne(row)}
              >
                重推
              </Button>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const failedHint = stats && stats.failed_recent_24h > 0 ? (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message={`最近 24 小时有 ${stats.failed_recent_24h} 条推送失败`}
      description={
        <span>
          建议优先查看 <a onClick={() => { setFilterStatus("failed"); setPage(1); }}>失败列表</a>，
          排查是否是企业微信「可信 IP 白名单」未配置（错误码 60020）或接收人未绑定 wecom_userid。
        </span>
      }
    />
  ) : null;

  return (
    <>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" bordered>
            <Statistic title="累计推送" value={stats?.total ?? "—"} prefix={<BellOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" bordered>
            <Statistic title="成功" valueStyle={{ color: "#16a34a" }} value={stats?.sent ?? "—"} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" bordered>
            <Statistic title="失败" valueStyle={{ color: "#dc2626" }} value={stats?.failed ?? "—"} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" bordered>
            <Statistic title="待发送" valueStyle={{ color: "#d97706" }} value={stats?.pending ?? "—"} />
          </Card>
        </Col>
      </Row>

      {failedHint}

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="推送状态"
          style={{ width: 140 }}
          options={STATUS_OPTIONS}
          value={filterStatus}
          onChange={(v) => { setPage(1); setFilterStatus(v); }}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="内容类型"
          style={{ width: 220 }}
          options={eventTypeOptions}
          value={filterEventType}
          onChange={(v) => { setPage(1); setFilterEventType(v); }}
        />
        <Select
          allowClear
          placeholder="业务模块"
          style={{ width: 160 }}
          options={BUSINESS_TYPE_OPTIONS}
          value={filterBusinessType}
          onChange={(v) => { setPage(1); setFilterBusinessType(v); }}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="标题 / 错误信息 / userid"
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => { setPage(1); setKeyword(e.target.value); }}
        />
        <RangePicker
          showTime={{ format: "HH:mm" }}
          value={dateRange}
          onChange={(v) => { setPage(1); setDateRange(v); }}
        />
        <Button onClick={resetFilters}>重置</Button>
        <Button icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
        <Popconfirm
          title={`确认重新推送选中的 ${selectedIds.length} 条记录？`}
          description="已成功的记录会被自动跳过；其余记录会按所属业务重新走一次推送流程。"
          okText="重推"
          cancelText="取消"
          disabled={!selectedIds.length}
          onConfirm={bulkResend}
        >
          <Button
            type="primary"
            icon={<RedoOutlined />}
            disabled={!selectedIds.length}
            loading={bulkResendBusy}
          >
            批量重推{selectedIds.length ? `（${selectedIds.length}）` : ""}
          </Button>
        </Popconfirm>
        <Popconfirm
          title={`确认删除选中的 ${selectedIds.length} 条推送记录？`}
          description="该操作不可撤销，仅清理推送日志，不影响业务数据。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          disabled={!selectedIds.length}
          onConfirm={bulkDelete}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={!selectedIds.length}
            loading={bulkBusy}
          >
            批量删除{selectedIds.length ? `（${selectedIds.length}）` : ""}
          </Button>
        </Popconfirm>
        <span style={{ color: "var(--text-mute)" }}>
          共 <Badge count={total} overflowCount={9999} showZero color="#3b82f6" /> 条记录
        </span>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.map((k) => Number(k))),
          preserveSelectedRowKeys: true,
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
          pageSizeOptions: ["20", "50", "100"],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        scroll={{ x: 1280 }}
      />

      <Drawer
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        width={680}
        title={detail ? `推送详情 #${detail.id}` : "推送详情"}
        destroyOnHidden
      >
        {detailLoading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-mute)" }}>加载中…</div>
        ) : detail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space wrap>
              {statusTag(detail.status, detail.status_label)}
              <Tag bordered={false}>{detail.event_label || detail.event_type}</Tag>
              {detail.business_type ? (
                <Tag bordered={false} color="geekblue">
                  {detail.business_type}{detail.business_id != null ? ` · #${detail.business_id}` : ""}
                </Tag>
              ) : null}
            </Space>

            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="标题">{detail.title || "—"}</Descriptions.Item>
              <Descriptions.Item label="正文">
                <div style={{ whiteSpace: "pre-line" }}>{stripHtml(detail.description) || "—"}</div>
              </Descriptions.Item>
              <Descriptions.Item label="渠道">{detail.channel}</Descriptions.Item>
              <Descriptions.Item label="接收人">
                {detail.recipient_display_name || detail.recipient_username || "（未绑定）"}
                {detail.recipient_wecom_userid ? `（${detail.recipient_wecom_userid}）` : ""}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {detail.created_at ? dayjs(detail.created_at).format("YYYY-MM-DD HH:mm:ss") : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="发送时间">
                {detail.sent_at ? dayjs(detail.sent_at).format("YYYY-MM-DD HH:mm:ss") : "—"}
              </Descriptions.Item>
            </Descriptions>

            {detail.error ? (
              <Alert
                type="error"
                showIcon
                message="推送失败"
                description={detail.error}
              />
            ) : null}

            {detail.payload_json ? (
              <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>请求 payload</Text>
                <pre style={{
                  background: "var(--surface-mute, #f5f5f5)",
                  padding: 12,
                  borderRadius: 6,
                  maxHeight: 240,
                  overflow: "auto",
                  fontSize: 12,
                }}>{tryPrettyJson(detail.payload_json)}</pre>
              </div>
            ) : null}

            {detail.response_json ? (
              <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>企微返回</Text>
                <pre style={{
                  background: "var(--surface-mute, #f5f5f5)",
                  padding: 12,
                  borderRadius: 6,
                  maxHeight: 240,
                  overflow: "auto",
                  fontSize: 12,
                }}>{tryPrettyJson(detail.response_json)}</pre>
              </div>
            ) : null}
          </Space>
        ) : (
          <Paragraph type="secondary">无数据</Paragraph>
        )}
      </Drawer>
    </>
  );
}
