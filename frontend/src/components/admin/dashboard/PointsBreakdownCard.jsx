import { Card, Empty, Spin } from "antd";
import { useEffect, useState } from "react";

import { fetchDashboardPointsBreakdown } from "../../../lib/api.dashboard";
import DonutChart from "./DonutChart";
import { CATEGORY_COLORS } from "./palette";

const CATEGORY_META = [
  { key: "training", label: "AI 对练", color: CATEGORY_COLORS.training },
  { key: "course", label: "课程视频", color: CATEGORY_COLORS.course },
  { key: "reading", label: "读书打卡", color: CATEGORY_COLORS.reading },
  { key: "paper", label: "考试试卷", color: CATEGORY_COLORS.paper },
  { key: "exam", label: "AI 通关", color: CATEGORY_COLORS.exam },
  { key: "manual", label: "手动调整", color: CATEGORY_COLORS.manual },
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
      className="dash-card"
      title={(
        <div className="dash-card__title">
          <span className="dash-card__title-eyebrow">Composition</span>
          <span className="dash-card__title-text">积分分类构成</span>
        </div>
      )}
    >
      <Spin spinning={loading}>
        {hasData ? (
          <DonutChart data={items} size={220} thickness={28} />
        ) : (
          <div className="dash-empty">
            <Empty description="暂无积分数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </Spin>
    </Card>
  );
}
