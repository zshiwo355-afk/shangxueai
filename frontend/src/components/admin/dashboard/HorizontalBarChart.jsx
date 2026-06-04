/**
 * 横向条形图：按某个维度展示部门排名。纯 SVG，不依赖图表库。
 * Props:
 *   data: [{label, value, sub}]
 *   color: 主色
 *   suffix: 数字后缀（"次" / "%"）
 *   maxBars: 最多展示几条（多的滚动）
 */
export default function HorizontalBarChart({ data, color = "#1677ff", suffix = "" }) {
  const items = Array.isArray(data) ? data : [];
  if (!items.length) {
    return (
      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-mute)" }}>
        暂无数据
      </div>
    );
  }
  const max = Math.max(1, ...items.map((it) => Number(it.value || 0)));
  const rowHeight = 36;
  const labelWidth = 200;
  const numberWidth = 90;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((it, idx) => {
        const ratio = Math.max(0, Math.min(1, Number(it.value || 0) / max));
        return (
          <div
            key={idx}
            style={{ display: "flex", alignItems: "center", height: rowHeight, gap: 12 }}
            title={it.label}
          >
            <div
              style={{
                width: labelWidth,
                fontSize: 13,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "#333",
                flexShrink: 0,
              }}
            >
              <span style={{ display: "inline-block", width: 24, color: "var(--text-mute)" }}>
                {idx < 3 ? ["🥇", "🥈", "🥉"][idx] : `${idx + 1}.`}
              </span>
              {it.label}
            </div>
            <div style={{ flex: 1, position: "relative", height: 22, background: "#f5f7fa", borderRadius: 4 }}>
              <div
                style={{
                  width: `${ratio * 100}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, ${color}cc, ${color})`,
                  borderRadius: 4,
                  transition: "width .3s",
                }}
              />
              {it.sub ? (
                <span
                  style={{
                    position: "absolute",
                    left: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 11,
                    color: "rgba(255,255,255,0.95)",
                    textShadow: "0 0 2px rgba(0,0,0,0.25)",
                  }}
                >
                  {it.sub}
                </span>
              ) : null}
            </div>
            <div
              style={{
                width: numberWidth,
                textAlign: "right",
                fontWeight: 600,
                color,
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              {Number(it.value || 0).toLocaleString()}{suffix}
            </div>
          </div>
        );
      })}
    </div>
  );
}
