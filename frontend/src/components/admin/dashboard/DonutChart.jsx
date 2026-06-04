/**
 * 环形图：单色梯度 + 灰阶。
 */
export default function DonutChart({ data, size = 200, thickness = 26 }) {
  const items = Array.isArray(data) ? data.filter((it) => Number(it.value || 0) > 0) : [];
  const total = items.reduce((s, it) => s + Number(it.value || 0), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;

  if (!total) {
    return (
      <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "#bfbfbf" }}>
        暂无数据
      </div>
    );
  }

  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fafafa" strokeWidth={thickness} />
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
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 2 }}>总积分</span>
          <span style={{ fontSize: 22, fontWeight: 600, color: "#262626", lineHeight: 1.1 }}>
            {total.toLocaleString()}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
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
                  width: 8,
                  height: 8,
                  background: it.color,
                  borderRadius: 2,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, color: "#262626" }}>{it.label}</span>
              <span style={{ color: "#8c8c8c", fontSize: 12, minWidth: 38, textAlign: "right" }}>{pct}%</span>
              <span style={{ color: "#262626", minWidth: 56, textAlign: "right", fontWeight: 500 }}>
                {Number(it.value || 0).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
