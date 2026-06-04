import { CrownFilled, TrophyOutlined } from "@ant-design/icons";
import { Card, List, Tag } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchDashboardLeaderboardPreview } from "../../../lib/api.dashboard";

function rankIcon(rank) {
  if (rank === 1) return <CrownFilled style={{ color: "#faad14" }} />;
  if (rank === 2) return <CrownFilled style={{ color: "#bfbfbf" }} />;
  if (rank === 3) return <CrownFilled style={{ color: "#d4a373" }} />;
  return <span style={{ color: "var(--text-mute)" }}>#{rank}</span>;
}

export default function LeaderboardPreview() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardLeaderboardPreview(10)
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card
      size="small"
      title={<><TrophyOutlined /> 学习达人 Top 10</>}
      extra={<a onClick={() => navigate("/admin/points")}>完整排行 →</a>}
      style={{ borderRadius: 12 }}
    >
      <List
        size="small"
        loading={loading}
        dataSource={items}
        locale={{ emptyText: "暂无积分数据" }}
        renderItem={(item) => (
          <List.Item>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ width: 28, textAlign: "center" }}>{rankIcon(item.rank)}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                  {item.department ? (
                    <Tag style={{ fontSize: 11 }}>{item.department}</Tag>
                  ) : null}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {item.streak_days > 0 ? (
                  <Tag color="purple" style={{ fontSize: 11 }}>连 {item.streak_days} 天</Tag>
                ) : null}
                <strong style={{ color: "#1677ff" }}>{item.total_points}</strong>
                <span style={{ color: "var(--text-mute)", fontSize: 12 }}>分</span>
              </div>
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
}
