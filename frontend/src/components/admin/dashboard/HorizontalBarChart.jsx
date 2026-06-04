/**
 * 横向条形图：单色，配套表格用。
 */
export default function HorizontalBarChart({ data, color = "#1677ff", suffix = "" }) {
  const items = Array.isArray(data) ? data : [];
  if (!items.length) {
    return (
      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#bfbfbf" }}>
        暂无数据
      </div>
    );
  }
  const max = Math.max(1, ...items.map((it) => Number(it.value || 0)));
  const labelWidth = 200;
  const numberWidth = 96;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, idx) => {
        const ratio = Math.max(0, Math.min(1, Number(it.value || 0) / max));
        return (
          <div
            key={idx}
            style={{ display: "flex", alignItems: "center", gap: 12 }}
            title={it.label}
          >
            <div
              style={{
                width: labelWidth,
                fontSize: 13,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "#262626",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 22,
                  textAlign: "right",
                  fontSize: 12,
                  color: "#8c8c8c",
                  flexShrink: 0,
                }}
              >
                {idx + 1}.
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
            </div>
            <div
              style={{
                flex: 1,
                position: "relative",
                height: 20,
                background: "#fafafa",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${ratio * 100}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 2,
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
                    color: ratio > 0.2 ? "#fff" : "#8c8c8c",
                    pointerEvents: "none",
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
                color: "#262626",
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {Number(it.value || 0).toLocaleString()}
              <span style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 400, marginLeft: 2 }}>
                {suffix}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
