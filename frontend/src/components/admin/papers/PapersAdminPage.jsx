import { useMemo, useState } from "react";
import { Tabs } from "antd";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import QuestionBankPanel from "./QuestionBankPanel";
import PaperListPanel from "./PaperListPanel";
import AssignmentsPanel from "./AssignmentsPanel";
import PendingReviewPanel from "./PendingReviewPanel";

const TABS = [
  { key: "question-bank", label: "题库" },
  { key: "papers", label: "试卷" },
  { key: "assignments", label: "派发" },
  { key: "review", label: "复核" },
];

export default function PapersAdminPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeKey = useMemo(() => {
    const m = location.pathname.match(/\/admin\/papers\/?([\w-]+)?/);
    const sub = m?.[1];
    return TABS.find((t) => t.key === sub)?.key || "question-bank";
  }, [location.pathname]);

  const handleChange = (key) => {
    navigate(`/admin/papers/${key}`);
  };

  return (
    <div>
      <Tabs activeKey={activeKey} onChange={handleChange} items={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      <Routes>
        <Route index element={<Navigate to="question-bank" replace />} />
        <Route path="question-bank" element={<QuestionBankPanel />} />
        <Route path="papers" element={<PaperListPanel />} />
        <Route path="assignments" element={<AssignmentsPanel />} />
        <Route path="review" element={<PendingReviewPanel />} />
        <Route path="*" element={<Navigate to="question-bank" replace />} />
      </Routes>
    </div>
  );
}
