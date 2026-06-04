/**
 * 极简 SVG 折线图：避免引入 recharts/echarts。
 * Props:
 *   data: [{date, count}]
 *   color: 描边色
 *   height: 纵向高度（默认 180）
 */
export default function MiniLineChart({ data, color = "#1677ff", height = 180 }) {
  const items = Array.isArray(data) ? data : [];
  if (!items.length) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-mute)" }}>
        暂无数据
      </div>
    );
  }
  const width = 720;
  const padX = 36;
  const padY = 16;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const counts = items.map((it) => Number(it.count || 0));
  const max = Math.max(1, ...counts);
  const points = items.map((it, idx) => {
    const x = padX + (items.length === 1 ? innerW / 2 : (innerW * idx) / (items.length - 1));
    const y = padY + innerH - (innerH * Number(it.count || 0)) / max;
    return [x, y];
  });
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${path} L${points[points.length - 1][0]},${padY + innerH} L${points[0][0]},${padY + innerH} Z`;
  const xLabels = [items[0], items[Math.floor(items.length / 2)], items[items.length - 1]].filter(Boolean);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      <defs>
        <linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((p, i) => (
        <line
          key={i}
          x1={padX}
          x2={padX + innerW}
          y1={padY + innerH * p}
          y2={padY + innerH * p}
          stroke="#eee"
          strokeWidth={1}
        />
      ))}
      <path d={area} fill="url(#dash-area)" />
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
      {points.map(([x, y], idx) => (
        <circle key={idx} cx={x} cy={y} r={2.4} fill={color} />
      ))}
      {/* 顶部最大值 */}
      <text x={padX} y={padY - 2} fontSize={11} fill="#999">峰值 {max}</text>
      {/* 横轴关键日期 */}
      {xLabels.map((it, i) => {
        const idx = items.indexOf(it);
        const x = padX + (items.length === 1 ? innerW / 2 : (innerW * idx) / (items.length - 1));
        return (
          <text
            key={i}
            x={x}
            y={height - 2}
            fontSize={11}
            fill="#999"
            textAnchor="middle"
          >
            {(it.date || "").slice(5)}
          </text>
        );
      })}
    </svg>
  );
}
