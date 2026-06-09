import { ReloadOutlined } from "@ant-design/icons";
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  App as AntdApp,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  adminGetSyncBatchEntries,
  adminListSyncBatches,
} from "../../lib/api.admin";

const ACTION_LABELS = {
  update_bound: "更新已绑定账号",
  bind_by_mobile: "按姓名手机号绑定",
  update_by_name: "同名更新手机号",
  pending_create: "新建本地账号",
  local_unbound: "仅提示",
  mark_left: "置为离职",
  conflict: "冲突需处理",
  skip_missing_identity: "跳过",
};

const ACTION_COLORS = {
  update_bound: "blue",
  bind_by_mobile: "cyan",
  update_by_name: "geekblue",
  pending_create: "green",
  local_unbound: "default",
  mark_left: "orange",
  conflict: "red",
  skip_missing_identity: "default",
};

const STATUS_LABELS = {
  applied: "已应用",
  created: "已新建",
  skipped: "跳过",
  pending: "待处理",
};

const STATUS_COLORS = {
  applied: "success",
  created: "green",
  skipped: "default",
  pending: "orange",
};

const MODE_LABELS = {
  manual: "手动",
  scheduled: "定时",
};

const COUNT_FIELDS = [
  { key: "matched_count", label: "匹配", color: "blue" },
  { key: "bound_count", label: "绑定", color: "cyan" },
  { key: "updated_count", label: "更新", color: "geekblue" },
  { key: "created_count", label: "新建", color: "green" },
  { key: "left_count", label: "离职", color: "orange" },
  { key: "disabled_count", label: "禁用", color: "volcano" },
  { key: "conflict_count", label: "冲突", color: "red" },
  { key: "skipped_count", label: "跳过", color: "default" },
];

const SNAPSHOT_FIELDS = [
  { key: "username", label: "用户名" },
  { key: "real_name", label: "姓名" },
  { key: "department", label: "部门" },
  { key: "position", label: "岗位" },
  { key: "employment_status", label: "在职状态" },
  { key: "status", label: "账号状态" },
  { key: "disabled", label: "禁用" },
  { key: "wecom_userid", label: "企微 userid" },
];

function fmtTime(value) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—";
}

function renderSnapshotValue(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function SnapshotDiff({ before, after }) {
  if (!before && !after) {
    return <span style={{ color: "#999" }}>无快照</span>;
  }
  const rows = SNAPSHOT_FIELDS.map((field) => {
    const b = before ? before[field.key] : undefined;
    const a = after ? after[field.key] : undefined;
    const changed = JSON.stringify(b ?? null) !== JSON.stringify(a ?? null);
    return { ...field, b, a, changed };
  });
  return (
    <Descriptions
      bordered
      size="small"
      column={1}
      styles={{ label: { width: 120 } }}
    >
      {rows.map((row) => (
        <Descriptions.Item key={row.key} label={row.label}>
          {row.changed ? (
            <Space size={6}>
              <span style={{ color: "#999", textDecoration: "line-through" }}>
                {renderSnapshotValue(row.b)}
              </span>
              <span>→</span>
              <span style={{ color: "#cf1322", fontWeight: 600 }}>
                {renderSnapshotValue(row.a)}
              </span>
            </Space>
          ) : (
            <span>{renderSnapshotValue(row.a ?? row.b)}</span>
          )}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

export default function SyncLogsTab() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeBatch, setActiveBatch] = useState(null);
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState();

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListSyncBatches({ page, page_size: pageSize });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      message.error(err?.message || "同步记录加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const loadEntries = async (batch) => {
    setActiveBatch(batch);
    setActionFilter(undefined);
    setDrawerOpen(true);
    setEntriesLoading(true);
    try {
      const data = await adminGetSyncBatchEntries(batch.id);
      setEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "同步明细加载失败。");
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  };

  const filteredEntries = useMemo(() => {
    if (!actionFilter) return entries;
    return entries.filter((e) => e.action === actionFilter);
  }, [entries, actionFilter]);

  const actionOptions = useMemo(() => {
    const present = Array.from(new Set(entries.map((e) => e.action)));
    return present.map((a) => ({
      value: a,
      label: ACTION_LABELS[a] || a,
    }));
  }, [entries]);

  const batchColumns = [
    { title: "批次号", dataIndex: "id", width: 90, render: (v) => `#${v}` },
    {
      title: "模式",
      dataIndex: "mode",
      width: 130,
      render: (mode, row) => (
        <Space size={4}>
          <Tag color={mode === "scheduled" ? "purple" : "blue"}>
            {MODE_LABELS[mode] || mode}
          </Tag>
          {row.initial_mode ? <Tag color="gold">初始化</Tag> : null}
        </Space>
      ),
    },
    { title: "外部员工", dataIndex: "total_wecom_users", width: 90 },
    {
      title: "处理结果",
      key: "counts",
      render: (_, row) => (
        <Space size={[4, 4]} wrap>
          {COUNT_FIELDS.filter((f) => Number(row[f.key] || 0) > 0).map((f) => (
            <Tag key={f.key} color={f.color}>
              {f.label} {row[f.key]}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "执行人",
      dataIndex: "executed_by_name",
      width: 120,
      render: (name) => name || <span style={{ color: "#999" }}>定时任务</span>,
    },
    {
      title: "开始时间",
      dataIndex: "started_at",
      width: 170,
      render: fmtTime,
    },
    {
      title: "结束时间",
      dataIndex: "finished_at",
      width: 170,
      render: fmtTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => loadEntries(row)}>
          查看明细
        </Button>
      ),
    },
  ];

  const entryColumns = [
    {
      title: "姓名 / 手机号",
      key: "identity",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.before?.real_name || row.after?.real_name || "—"}</span>
          <span style={{ color: "#999", fontSize: 12 }}>{row.mobile || "—"}</span>
        </Space>
      ),
    },
    {
      title: "动作",
      dataIndex: "action",
      width: 150,
      render: (action) => (
        <Tag color={ACTION_COLORS[action] || "default"}>
          {ACTION_LABELS[action] || action}
        </Tag>
      ),
    },
    {
      title: "结果",
      dataIndex: "status",
      width: 100,
      render: (status) => (
        <Tag color={STATUS_COLORS[status] || "default"}>
          {STATUS_LABELS[status] || status}
        </Tag>
      ),
    },
    {
      title: "原因",
      dataIndex: "reason",
      ellipsis: true,
      render: (reason) =>
        reason ? (
          <Tooltip title={reason}>
            <span>{reason}</span>
          </Tooltip>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
          刷新
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={batchColumns}
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Drawer
        width={960}
        open={drawerOpen}
        title={activeBatch ? `同步明细 · 批次 #${activeBatch.id}` : "同步明细"}
        onClose={() => setDrawerOpen(false)}
      >
        <Space style={{ marginBottom: 16 }} wrap>
          <span style={{ fontWeight: 600 }}>动作筛选</span>
          <Select
            allowClear
            placeholder="全部动作"
            style={{ minWidth: 200 }}
            value={actionFilter}
            onChange={setActionFilter}
            options={actionOptions}
          />
          <span style={{ color: "#999" }}>
            当前显示 {filteredEntries.length} 条
          </span>
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={entriesLoading}
          dataSource={filteredEntries}
          columns={entryColumns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无明细" /> }}
          expandable={{
            expandedRowRender: (row) => (
              <SnapshotDiff before={row.before} after={row.after} />
            ),
            rowExpandable: (row) => Boolean(row.before || row.after),
          }}
        />
      </Drawer>
    </div>
  );
}
