import { Badge, Tabs } from "antd";
import { useState } from "react";
import ExamAssignmentsPanel from "./ExamAssignmentsPanel";
import TrainingRecordsPanel from "./TrainingRecordsPanel";

export default function ExamsTab() {
  const [activeKey, setActiveKey] = useState("assignments");
  const [pendingCount, setPendingCount] = useState(0);

  const items = [
    {
      key: "assignments",
      label: (
        <span>
          通关任务
          {pendingCount > 0 ? (
            <Badge
              count={pendingCount}
              size="small"
              style={{ backgroundColor: "#f59e0b", marginLeft: 8 }}
            />
          ) : null}
        </span>
      ),
      children: <ExamAssignmentsPanel onPendingCountChange={setPendingCount} />,
    },
    {
      key: "records",
      label: "训练记录",
      children: <TrainingRecordsPanel />,
    },
  ];

  return (
    <Tabs activeKey={activeKey} onChange={setActiveKey} items={items} destroyInactiveTabPane={false} />
  );
}
