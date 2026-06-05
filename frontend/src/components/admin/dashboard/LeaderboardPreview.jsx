import { Card, Empty, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchDashboardLeaderboardPreview } from "../../../lib/api.dashboard";
import { LEADERBOARD_BAR, LEADERBOARD_MEDAL } from "./palette";
import { echarts, useECharts } from "./useECharts";

const ROW_HEIGHT = 30;
const BASE_HEIGHT = 40;

function LeaderboardChart({ items }) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => Number(a.total_points || 0) - Number(b.total_points || 0)),
    [items],
  );

  const option = useMemo(() => {
    if (!sorted.length) return null;
    const labels = sorted.map((it) => {
      const rank = it.rank;
      const tag = rank <= 3 ? `#${rank} ` : `${rank}. `;
      return `${tag}${it.name}`;
    });
    const values = sorted.map((it) => Number(it.total_points || 0));
    const departments = sorted.map((it) => it.department || "");

    return {
      animationDuration: 350,
      grid: { left: 150, right: 80, top: 8, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(38,38,38,0.92)",
        borderWidth: 0,
        textStyle: { color: "#fff", fontSize: 12 },
        padding: [6, 10],
        formatter: (params) => {
          const p = params?.[0];
          if (!p) return "";
          const dept = departments[p.dataIndex];
          return `${p.name}${dept ? `<br/><span style="color:#bfbfbf">${dept}</span>` : ""}<br/><b>${Number(p.value || 0).toLocaleString()} 分</b>`;
        },
      },
      xAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f5f5f5" } },
        axisLabel: { color: "#bfbfbf", fontSize: 11 },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#262626",
          fontSize: 12,
          width: 130,
          overflow: "truncate",
        },
      },
      series: [
        {
          type: "bar",
          data: sorted.map((it, idx) => {
            const rank = it.rank;
            const isMedal = rank <= 3;
            const medalColor = LEADERBOARD_MEDAL[rank - 1];
            return {
              value: values[idx],
              itemStyle: {
                borderRadius: [0, 4, 4, 0],
                color: isMedal
                  ? medalColor
                  : new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                      { offset: 0, color: hexToRgba(LEADERBOARD_BAR, 0.45) },
                      { offset: 1, color: LEADERBOARD_BAR },
                    ]),
              },
            };
          }),
          barMaxWidth: 14,
          label: {
            show: true,
            position: "right",
            color: "#262626",
            fontSize: 12,
            fontWeight: 500,
            formatter: (p) => `${Number(p.value || 0).toLocaleString()} 分`,
          },
        },
      ],
    };
  }, [sorted]);

  const ref = useECharts(option, [option]);
  const height = BASE_HEIGHT + sorted.length * ROW_HEIGHT;
  return <div ref={ref} style={{ width: "100%", height }} />;
}

function hexToRgba(hex, alpha) {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(v, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function LeaderboardPreview() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchDashboardLeaderboardPreview(10)
      .then((data) => { if (!cancelled) setItems(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card
      size="small"
      className="dash-card dash-card--leaderboard"
      title={(
        <div className="dash-card__title">
          <span className="dash-card__title-eyebrow">Champions</span>
          <span className="dash-card__title-text">学习达人 Top 10</span>
        </div>
      )}
      extra={(
        <a onClick={() => navigate("/admin/points")} style={{ fontSize: 12 }}>
          完整排行 →
        </a>
      )}
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
      styles={{
        body: {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
        },
      }}
    >
      <Spin spinning={loading} style={{ flex: 1 }}>
        {items.length === 0 ? (
          <div
            style={{
              flex: 1,
              minHeight: 260,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Empty description="暂无积分数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <LeaderboardChart items={items} />
        )}
      </Spin>
    </Card>
  );
}
