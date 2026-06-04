import { PieChartOutlined } from "@ant-design/icons";
import { Card, Empty, Spin } from "antd";
import { useEffect, useState } from "react";

import { fetchDashboardPointsBreakdown } from "../../../lib/api.dashboard";
import DonutChart from "./DonutChart";

const CATEGORY_META = [
  { key: "training", label: "AI 对练", color: "#1677ff" },
  { key: "course", label: "课程视频", color: "#722ed1" },
  { key: "reading", label: "读书打卡", color: "#13c2c2" },
  { key: "paper", label: "考试试卷", color: "#fa8c16" },
  { key: "exam", label: "AI 通关", color: "#eb2f96" },
  { key: "manual", label: "手动调整", color: "#bfbfbf" },
];

export default function PointsBreakdownCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardPointsBreakdown()
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
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
      title={<><PieChartOutlined /> 积分分类构成</>}
      style={{ borderRadius: 12 }}
    >
      <Spin spinning={loading}>
        {hasData ? (
          <DonutChart data={items} size={200} thickness={28} />
        ) : (
          <Empty description="暂无积分数据" />
        )}
      </Spin>
    </Card>
  );
}
