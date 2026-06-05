/**
 * 横向条形图（ECharts 版）：渐变填充、动态高度。
 */
import { useMemo } from "react";

import { echarts, useECharts } from "./useECharts";

const ROW_HEIGHT = 28;
const BASE_HEIGHT = 60;

export default function HorizontalBarChart({ data, color = "#426f9f", suffix = "" }) {
  const items = Array.isArray(data) ? data : [];

  const sorted = useMemo(
    () => [...items].sort((a, b) => Number(a.value || 0) - Number(b.value || 0)),
    [items],
  );

  const option = useMemo(() => {
    if (!sorted.length) return null;
    const labels = sorted.map((it) => it.label);
    const values = sorted.map((it) => Number(it.value || 0));
    const subs = sorted.map((it) => it.sub || "");

    return {
      animationDuration: 350,
      grid: { left: 130, right: 80, top: 8, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(31, 41, 51, 0.94)",
        borderWidth: 0,
        textStyle: { color: "#f4ede0", fontSize: 12 },
        padding: [8, 12],
        formatter: (params) => {
          const p = params?.[0];
          if (!p) return "";
          const sub = subs[p.dataIndex];
          return `<b>${p.name}</b><br/><span style="color:rgba(244,237,224,0.6)">${sub || "数值"}</span> <b style="letter-spacing:-0.02em">${Number(p.value || 0).toLocaleString()}${suffix || ""}</b>`;
        },
      },
      xAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "rgba(31, 41, 51, 0.06)", type: "dashed" } },
        axisLabel: {
          color: "#98a2b3",
          fontSize: 11,
          fontFamily: "Inter, system-ui, sans-serif",
        },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#1f2933",
          fontSize: 12,
          width: 110,
          overflow: "truncate",
        },
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 12,
          itemStyle: {
            borderRadius: [0, 3, 3, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: hexToRgba(color, 0.5) },
              { offset: 1, color },
            ]),
          },
          emphasis: {
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: hexToRgba(color, 0.7) },
                { offset: 1, color: shade(color, -0.1) },
              ]),
            },
          },
          label: {
            show: true,
            position: "right",
            color: "#1f2933",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "Inter, system-ui, sans-serif",
            formatter: (p) => `${Number(p.value || 0).toLocaleString()}${suffix || ""}`,
          },
        },
      ],
    };
  }, [sorted, color, suffix]);

  const ref = useECharts(option, [option]);
  const height = sorted.length ? BASE_HEIGHT + sorted.length * ROW_HEIGHT : 160;

  return (
    <div style={{ position: "relative", width: "100%", height, minHeight: height }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      {!sorted.length ? (
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

function shade(hex, percent) {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(v, 16);
  const adjust = (c) => Math.max(0, Math.min(255, Math.round(c + 255 * percent)));
  const r = adjust((num >> 16) & 0xff);
  const g = adjust((num >> 8) & 0xff);
  const b = adjust(num & 0xff);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
