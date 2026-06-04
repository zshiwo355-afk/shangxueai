import { Card, Segmented, Spin } from "antd";
import { useEffect, useState } from "react";

import { fetchDashboardTrend } from "../../../lib/api.dashboard";
import MiniLineChart from "./MiniLineChart";

const METRIC_OPTIONS = [
  { label: "AI 对练", value: "training", color: "#1677ff" },
  { label: "课程视频", value: "video", color: "#722ed1" },
  { label: "读书打卡", value: "reading", color: "#13c2c2" },
  { label: "试卷提交", value: "paper", color: "#fa8c16" },
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

  return (
    <Card
      size="small"
      title={`近 ${days} 天 · ${meta.label} 趋势`}
      extra={(
        <div style={{ display: "flex", gap: 8 }}>
          <Segmented
            size="small"
            options={METRIC_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            value={metric}
            onChange={setMetric}
          />
          <Segmented
            size="small"
            options={DAYS_OPTIONS}
            value={days}
            onChange={setDays}
          />
        </div>
      )}
      style={{ borderRadius: 12 }}
    >
      <Spin spinning={loading}>
        <MiniLineChart data={data} color={meta.color} height={220} />
      </Spin>
      <div style={{ marginTop: 8, color: "var(--text-mute)", fontSize: 12 }}>
        合计 {data.reduce((s, it) => s + Number(it.count || 0), 0)} {meta.label === "AI 对练" || meta.label === "试卷提交" ? "次" : "条"}
      </div>
    </Card>
  );
}
