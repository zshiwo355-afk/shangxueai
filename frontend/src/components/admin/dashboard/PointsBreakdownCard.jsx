import { PieChartOutlined } from "@ant-design/icons";
import { Card, Empty, Spin } from "antd";
import { useEffect, useState } from "react";

import { fetchDashboardPointsBreakdown } from "../../../lib/api.dashboard";
import DonutChart from "./DonutChart";

// 中性灰阶 + 一抹主色，避免彩虹拼图
const CATEGORY_META = [
  { key: "training", label: "AI 对练", color: "#1677ff" },
  { key: "course", label: "课程视频", color: "#4096ff" },
  { key: "reading", label: "读书打卡", color: "#69b1ff" },
  { key: "paper", label: "考试试卷", color: "#91caff" },
  { key: "exam", label: "AI 通关", color: "#bae0ff" },
  { key: "manual", label: "手动调整", color: "#d9d9d9" },
];

export default function PointsBreakdownCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchDashboardPointsBreakdown()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const items = CATEGORY_META.map((m) => ({
    label: m.label,
    color: m.color,
    value: Number(data?.[m.key] || 0),
  }));
  const hasData = items.some((it) => it.value > 0);

  return (
    <Card
      size="small"
      title={(
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#595959" }}>
          <PieChartOutlined />
          <span>积分分类构成</span>
        </span>
      )}
      style={{ borderRadius: 8 }}
      bodyStyle={{ padding: 16 }}
    >
      <Spin spinning={loading}>
        {hasData ? (
          <DonutChart data={items} size={200} thickness={26} />
        ) : (
          <Empty description="暂无积分数据" />
        )}
      </Spin>
    </Card>
  );
}
