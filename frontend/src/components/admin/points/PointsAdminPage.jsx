import { Tabs } from "antd";
import { useState } from "react";

import RulesTab from "./RulesTab";
import LeaderboardTab from "./LeaderboardTab";
import TransactionsTab from "./TransactionsTab";

export default function PointsAdminPage() {
  const [activeKey, setActiveKey] = useState("leaderboard");

  const items = [
    { key: "leaderboard", label: "积分排行", children: <LeaderboardTab /> },
    { key: "transactions", label: "积分流水", children: <TransactionsTab /> },
    { key: "rules", label: "规则配置", children: <RulesTab /> },
  ];

  return (
    <Tabs
      activeKey={activeKey}
      onChange={setActiveKey}
      items={items}
      destroyInactiveTabPane
    />
  );
}
