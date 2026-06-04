import { DownloadOutlined, LineChartOutlined } from "@ant-design/icons";
import { Button, Card, Segmented, Spin } from "antd";
import { useEffect, useState } from "react";

import { fetchDashboardTrend } from "../../../lib/api.dashboard";
import { downloadCsv, todayStamp } from "../../../lib/csvExport";
import MiniLineChart from "./MiniLineChart";

const METRIC_OPTIONS = [
  { label: "AI 对练", value: "training" },
  { label: "课程视频", value: "video" },
  { label: "读书打卡", value: "reading" },
  { label: "试卷提交", value: "paper" },
];

const DAYS_OPTIONS = [
  { label: "7 天", value: 7 },
  { label: "30 天", value: 30 },
  { label: "60 天", value: 60 },
];

export default function TrendChart() {
  const [metric, setMetric] = useState("training");
  const [days, setDays] = useState(30);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDashboardTrend(metric, days)
      .then((items) => { if (!cancelled) setData(Array.isArray(items) ? items : []); })
      .catch(() => { if (!cancelled) setData([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [metric, days]);

  const meta = METRIC_OPTIONS.find((m) => m.value === metric) || METRIC_OPTIONS[0];
  const total = data.reduce((s, it) => s + Number(it.count || 0), 0);
  const unit = meta.label === "AI 对练" || meta.label === "试卷提交" ? "次" : "条";

  const handleExport = () => {
    const columns = [
      { title: "日期", key: "date" },
      { title: `${meta.label}(${unit})`, key: "count" },
    ];
    downloadCsv(`趋势_${meta.label}_近${days}天_${todayStamp()}.csv`, columns, data);
  };

  return (
    <Card
      size="small"
      title={(
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#595959" }}>
          <LineChartOutlined />
          <span>近 {days} 天 · {meta.label} 趋势</span>
        </span>
      )}
      extra={(
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Segmented size="small" options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
          <Segmented size="small" options={DAYS_OPTIONS} value={days} onChange={setDays} />
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={!data.length || loading}
            onClick={handleExport}
          >
            导出 CSV
          </Button>
        </div>
      )}
      style={{ borderRadius: 8, width: "100%", display: "flex", flexDirection: "column" }}
      bodyStyle={{ padding: "12px 16px 16px", flex: 1, display: "flex", flexDirection: "column" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 600, color: "#262626" }}>
          {total.toLocaleString()}
        </span>
        <span style={{ fontSize: 12, color: "#8c8c8c" }}>
          {unit} · 累计
        </span>
      </div>
      <Spin spinning={loading}>
        <MiniLineChart data={data} height={220} />
      </Spin>
    </Card>
  );
}
