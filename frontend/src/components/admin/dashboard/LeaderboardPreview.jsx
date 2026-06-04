import { TrophyOutlined } from "@ant-design/icons";
import { Card, Empty, Spin } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchDashboardLeaderboardPreview } from "../../../lib/api.dashboard";

const BAR_COLOR = "#1677ff";

function LeaderboardBars({ items }) {
  const max = Math.max(1, ...items.map((it) => Number(it.total_points || 0)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, idx) => {
        const value = Number(item.total_points || 0);
        const ratio = Math.max(0, Math.min(1, value / max));
        return (
          <div key={item.user_id || idx} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
            >
              <span style={{ color: "#8c8c8c", width: 18, textAlign: "right", flexShrink: 0 }}>
                {item.rank}.
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: "#262626",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={item.name + (item.department ? ` · ${item.department}` : "")}
              >
                {item.name}
                {item.department ? (
                  <span style={{ color: "#bfbfbf", marginLeft: 6 }}>{item.department}</span>
                ) : null}
              </span>
              <span style={{ color: "#262626", fontWeight: 600, flexShrink: 0 }}>
                {value.toLocaleString()}
                <span style={{ color: "#8c8c8c", fontWeight: 400, fontSize: 11, marginLeft: 2 }}>
                  分
                </span>
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: "#fafafa",
                borderRadius: 2,
                overflow: "hidden",
                marginLeft: 26,
              }}
            >
              <div
                style={{
                  width: `${ratio * 100}%`,
                  height: "100%",
                  background: BAR_COLOR,
                  borderRadius: 2,
                  transition: "width .3s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
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
      title={(
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#595959" }}>
          <TrophyOutlined />
          <span>学习达人 Top 10</span>
        </span>
      )}
      extra={(
        <a onClick={() => navigate("/admin/points")} style={{ fontSize: 12 }}>
          完整排行 →
        </a>
      )}
      style={{
        borderRadius: 8,
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
      bodyStyle={{
        padding: 16,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
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
          <LeaderboardBars items={items} />
        )}
      </Spin>
    </Card>
  );
}
