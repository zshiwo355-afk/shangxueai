import { DownloadOutlined, TableOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Segmented, Spin, Switch, Table } from "antd";
import { useEffect, useMemo, useState } from "react";

import { fetchDashboardDepartmentStats } from "../../../lib/api.dashboard";
import { downloadCsv, todayStamp } from "../../../lib/csvExport";
import HorizontalBarChart from "./HorizontalBarChart";
import { DEPARTMENT_COLORS } from "./palette";

const DAYS_OPTIONS = [
  { label: "近 7 天", value: 7 },
  { label: "近 30 天", value: 30 },
  { label: "近 90 天", value: 90 },
];

const METRIC_OPTIONS = [
  { label: "累计积分", value: "total_points", suffix: "分" },
  { label: "训练次数", value: "training_count", suffix: "次" },
  { label: "打卡次数", value: "reading_count", suffix: "次" },
  { label: "活跃率", value: "active_rate", suffix: "%" },
];

const TOP_OPTIONS = [
  { label: "Top 10", value: 10 },
  { label: "Top 20", value: 20 },
  { label: "全部", value: 0 },
];

const DEPARTMENT_NAME_PREFIXES = ["怀仁产业发展集团"];

function formatDepartmentName(value) {
  const original = String(value || "").trim();
  if (!original) return "未分配";
  let display = original;
  for (const prefix of DEPARTMENT_NAME_PREFIXES) {
    if (display.startsWith(prefix)) {
      display = display.slice(prefix.length).replace(/^[\s/\\|｜>＞\-—–_]+/, "").trim();
      break;
    }
  }
  return display || original;
}

export default function DepartmentChart() {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState("total_points");
  const [topN, setTopN] = useState(10);
  const [showTable, setShowTable] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDashboardDepartmentStats(days)
      .then((data) => { if (!cancelled) setItems(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const meta = METRIC_OPTIONS.find((m) => m.value === metric) || METRIC_OPTIONS[0];

  const handleExport = () => {
    const columns = [
      { title: "部门", value: (r) => formatDepartmentName(r.department) },
      { title: "在职人数", key: "headcount" },
      { title: "活跃人数", key: "active_count" },
      {
        title: "活跃率(%)",
        value: (r) => (r.headcount > 0 ? Math.round(100 * r.active_count / r.headcount) : 0),
      },
      { title: "训练次数", key: "training_count" },
      {
        title: "训练均分",
        value: (r) => (r.training_avg_score > 0 ? r.training_avg_score.toFixed(1) : ""),
      },
      { title: "打卡次数", key: "reading_count" },
      { title: "累计积分", key: "total_points" },
    ];
    downloadCsv(`部门维度透视_近${days}天_${todayStamp()}.csv`, columns, items);
  };

  const chartData = useMemo(() => {
    const list = items.map((it) => {
      let value;
      let sub = "";
      if (metric === "active_rate") {
        value = it.headcount > 0 ? Math.round(100 * it.active_count / it.headcount) : 0;
        sub = `${it.active_count}/${it.headcount}`;
      } else {
        value = Number(it[metric] || 0);
        sub = `${it.headcount} 人`;
      }
      return {
        label: formatDepartmentName(it.department),
        value,
        sub,
      };
    });
    list.sort((a, b) => b.value - a.value);
    return topN > 0 ? list.slice(0, topN) : list;
  }, [items, metric, topN]);

  const columns = [
    { title: "部门", dataIndex: "department", render: (v) => formatDepartmentName(v) },
    { title: "在职人数", dataIndex: "headcount", width: 100, sorter: (a, b) => a.headcount - b.headcount },
    {
      title: "活跃率",
      key: "active_rate",
      width: 140,
      render: (_, r) => {
        const rate = r.headcount > 0 ? Math.round(100 * r.active_count / r.headcount) : 0;
        return `${r.active_count}/${r.headcount}（${rate}%）`;
      },
    },
    { title: "训练次数", dataIndex: "training_count", width: 100 },
    {
      title: "训练均分",
      dataIndex: "training_avg_score",
      width: 100,
      render: (v) => v > 0 ? v.toFixed(1) : "—",
    },
    { title: "打卡次数", dataIndex: "reading_count", width: 100 },
    {
      title: "累计积分",
      dataIndex: "total_points",
      width: 100,
      render: (v) => <strong>{v}</strong>,
    },
  ];

  return (
    <Card
      size="small"
      className="dash-card dash-card--department"
      title={(
        <div className="dash-card__title">
          <span className="dash-card__title-eyebrow">By Department · 近 {days} 天</span>
          <span className="dash-card__title-text">{meta.label}</span>
        </div>
      )}
      extra={(
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Segmented size="small" options={METRIC_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} value={metric} onChange={setMetric} />
          <Segmented size="small" options={TOP_OPTIONS} value={topN} onChange={setTopN} />
          <Segmented size="small" options={DAYS_OPTIONS} value={days} onChange={setDays} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8c8c8c" }}>
            <TableOutlined />
            <Switch size="small" checked={showTable} onChange={setShowTable} />
          </span>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={!items.length || loading}
            onClick={handleExport}
          >
            导出 CSV
          </Button>
        </div>
      )}
    >
      <Spin spinning={loading}>
        {chartData.length ? (
          <HorizontalBarChart data={chartData} color={DEPARTMENT_COLORS[metric] || "#426f9f"} suffix={meta.suffix} />
        ) : (
          <div className="dash-empty">
            <Empty description="暂无部门数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </Spin>

      {showTable ? (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--dash-line, rgba(31,41,51,0.08))" }}>
          <Table
            rowKey="department"
            size="small"
            loading={loading}
            dataSource={items}
            columns={columns}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 个部门`,
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}
