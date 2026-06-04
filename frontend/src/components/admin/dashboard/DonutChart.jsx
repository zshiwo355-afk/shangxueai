/**
 * 环形图：展示分类占比。纯 SVG，不依赖图表库。
 * Props:
 *   data: [{label, value, color}]
 */
export default function DonutChart({ data, size = 200, thickness = 28 }) {
  const items = Array.isArray(data) ? data.filter((it) => Number(it.value || 0) > 0) : [];
  const total = items.reduce((s, it) => s + Number(it.value || 0), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;

  if (!total) {
    return (
      <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-mute)" }}>
        暂无数据
      </div>
    );
  }

  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0f0f0" strokeWidth={thickness} />
        {items.map((it, idx) => {
          const ratio = Number(it.value || 0) / total;
          const dash = c * ratio;
          const gap = c - dash;
          const dashOffset = c - offset;
          offset += dash;
          return (
            <circle
              key={idx}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={it.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            />
          );
        })}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize={12}
          fill="#999"
        >总积分</text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize={20}
          fontWeight={700}
          fill="#1677ff"
        >{total.toLocaleString()}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 160 }}>
        {items.map((it, idx) => {
          const pct = (100 * Number(it.value || 0) / total).toFixed(1);
          return (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{
                width: 12,
                height: 12,
                background: it.color,
                borderRadius: 3,
                display: "inline-block",
                flexShrink: 0,
              }} />
              <span style={{ flex: 1, color: "#333" }}>{it.label}</span>
              <span style={{ color: "var(--text-mute)" }}>{pct}%</span>
              <strong style={{ color: it.color, minWidth: 50, textAlign: "right" }}>
                {Number(it.value || 0).toLocaleString()}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
