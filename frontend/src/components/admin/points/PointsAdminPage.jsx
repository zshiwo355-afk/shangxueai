import { Alert, Tabs } from "antd";
import { useState } from "react";

import RulesTab from "./RulesTab";
import LeaderboardTab from "./LeaderboardTab";
import TransactionsTab from "./TransactionsTab";

export default function PointsAdminPage() {
  const [activeKey, setActiveKey] = useState("leaderboard");

  const items = [
    { key: "leaderboard", label: "学习积分排行", children: <LeaderboardTab /> },
    { key: "transactions", label: "学习积分流水", children: <TransactionsTab /> },
    { key: "rules", label: "学习积分规则", children: <RulesTab /> },
  ];

  return (
    <>
      <Alert type="info" showIcon message="学习积分与商城积分独立，不参与商品兑换。" style={{ marginBottom: 16 }} />
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={items}
        destroyInactiveTabPane
      />
    </>
  );
}
