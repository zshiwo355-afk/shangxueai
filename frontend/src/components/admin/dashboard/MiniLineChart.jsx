/**
 * 趋势折线图（ECharts 版）：渐变面积 + 平滑曲线。
 * 注意：ref 容器必须始终渲染，empty 状态做覆盖层——否则 useECharts 的 mount effect
 * 拿不到容器，data 后到时也不会重跑。
 */
import { useMemo } from "react";

import { echarts, useECharts } from "./useECharts";

export default function MiniLineChart({ data, color = "#426f9f", height = 220 }) {
  const items = Array.isArray(data) ? data : [];

  const option = useMemo(() => {
    if (!items.length) return null;
    return {
      animationDuration: 350,
      grid: { left: 44, right: 16, top: 18, bottom: 28 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(31, 41, 51, 0.94)",
        borderWidth: 0,
        textStyle: { color: "#f4ede0", fontSize: 12 },
        padding: [8, 12],
        formatter: (params) => {
          const p = params?.[0];
          if (!p) return "";
          return `<span style="color:rgba(244,237,224,0.6);letter-spacing:0.04em">${p.axisValueLabel}</span><br/><b style="font-size:14px;letter-spacing:-0.02em">${Number(p.data || 0).toLocaleString()}</b>`;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: items.map((it) => (it.date || "").slice(5)),
        axisLine: { lineStyle: { color: "rgba(31, 41, 51, 0.12)" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#98a2b3",
          fontSize: 11,
          fontFamily: "Inter, system-ui, sans-serif",
          interval: Math.max(0, Math.floor(items.length / 6) - 1),
        },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "rgba(31, 41, 51, 0.06)", type: "dashed" } },
        axisLabel: {
          color: "#98a2b3",
          fontSize: 11,
          fontFamily: "Inter, system-ui, sans-serif",
        },
        minInterval: 1,
      },
      series: [
        {
          type: "line",
          smooth: 0.4,
          symbol: "circle",
          symbolSize: 5,
          showSymbol: items.length <= 14,
          lineStyle: { color, width: 1.6 },
          itemStyle: { color, borderColor: "#fff", borderWidth: 1.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: hexToRgba(color, 0.18) },
              { offset: 1, color: hexToRgba(color, 0) },
            ]),
          },
          emphasis: { focus: "series" },
          data: items.map((it) => Number(it.count || 0)),
        },
      ],
    };
  }, [items, color]);

  const ref = useECharts(option, [option]);

  return (
    <div style={{ position: "relative", width: "100%", height, minHeight: height }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      {!items.length ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#bfbfbf",
            pointerEvents: "none",
          }}
        >
          暂无数据
        </div>
      ) : null}
    </div>
  );
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
