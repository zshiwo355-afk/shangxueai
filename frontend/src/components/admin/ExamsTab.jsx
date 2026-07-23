import { Tabs } from "antd";
import { useState } from "react";
import ExamAssignmentsPanel from "./ExamAssignmentsPanel";
import TrainingRecordsPanel from "./TrainingRecordsPanel";

export default function ExamsTab() {
  const [activeKey, setActiveKey] = useState("assignments");

  const items = [
    {
      key: "assignments",
      label: "通关任务",
      children: <ExamAssignmentsPanel />,
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
