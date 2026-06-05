/**
 * 环形图（ECharts 版）：圆角扇区 + 内嵌总分 + 自定义图例。
 */
import { useMemo } from "react";

import { useECharts } from "./useECharts";

export default function DonutChart({ data, size = 220, thickness = 28 }) {
  const items = Array.isArray(data) ? data.filter((it) => Number(it.value || 0) > 0) : [];
  const total = items.reduce((s, it) => s + Number(it.value || 0), 0);

  const option = useMemo(() => {
    if (!total) return null;
    return {
      animationDuration: 400,
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(31, 41, 51, 0.94)",
        borderWidth: 0,
        textStyle: { color: "#f4ede0", fontSize: 12 },
        padding: [8, 12],
        formatter: (p) => {
          const pct = total ? ((100 * p.value) / total).toFixed(1) : "0";
          return `${p.marker} ${p.name}<br/><b style="font-size:14px;letter-spacing:-0.02em">${Number(p.value || 0).toLocaleString()}</b> · ${pct}%`;
        },
      },
      title: {
        text: total.toLocaleString(),
        subtext: "总积分",
        left: "center",
        top: "center",
        itemGap: 6,
        textStyle: {
          fontSize: 26,
          fontWeight: 600,
          color: "#1f2933",
          fontFamily: "Inter, system-ui, sans-serif",
        },
        subtextStyle: {
          fontSize: 11,
          color: "#98a2b3",
          letterSpacing: "0.18em",
        },
      },
      series: [
        {
          type: "pie",
          radius: [`${((size - thickness * 2) / size) * 50}%`, "70%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: false,
          padAngle: 1.5,
          itemStyle: {
            borderRadius: 4,
            borderColor: "#fff",
            borderWidth: 2,
          },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 4,
            itemStyle: { shadowBlur: 16, shadowColor: "rgba(31, 41, 51, 0.16)" },
          },
          data: items.map((it) => ({
            name: it.label,
            value: Number(it.value || 0),
            itemStyle: { color: it.color },
          })),
        },
      ],
    };
  }, [items, total, size, thickness]);

  const ref = useECharts(option, [option]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <div ref={ref} style={{ width: "100%", height: "100%" }} />
        {!total ? (
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
      {total ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
          {items.map((it, idx) => {
            const pct = (100 * Number(it.value || 0) / total).toFixed(1);
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  padding: "4px 0",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    background: it.color,
                    borderRadius: 3,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, color: "#262626" }}>{it.label}</span>
                <span style={{ color: "#8c8c8c", fontSize: 12, minWidth: 44, textAlign: "right" }}>{pct}%</span>
                <span style={{ color: "#262626", minWidth: 60, textAlign: "right", fontWeight: 500 }}>
                  {Number(it.value || 0).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
