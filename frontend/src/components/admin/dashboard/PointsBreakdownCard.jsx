import { Card, Empty, Select, Spin } from "antd";
import { useEffect, useState } from "react";

import { adminListDepartments } from "../../../lib/api.admin";
import { fetchDashboardPointsBreakdown } from "../../../lib/api.dashboard";
import DonutChart from "./DonutChart";
import { CATEGORY_COLORS } from "./palette";

const CATEGORY_META = [
  { key: "training", label: "AI 对练", color: CATEGORY_COLORS.training },
  { key: "course", label: "课程视频", color: CATEGORY_COLORS.course },
  { key: "reading", label: "读书打卡", color: CATEGORY_COLORS.reading },
  { key: "paper", label: "考试试卷", color: CATEGORY_COLORS.paper },
  { key: "exam", label: "AI 通关", color: CATEGORY_COLORS.exam },
  { key: "manual", label: "手动调整", color: CATEGORY_COLORS.manual },
];

const DEPARTMENT_NAME_PREFIXES = ["怀仁产业发展集团"];

function formatDepartmentName(value) {
  const original = String(value || "").trim();
  if (!original) return original;
  let display = original;
  for (const prefix of DEPARTMENT_NAME_PREFIXES) {
    if (display.startsWith(prefix)) {
      display = display.slice(prefix.length).replace(/^[\s/\\|｜>＞\-—–_]+/, "").trim();
      break;
    }
  }
  return display || original;
}

export default function PointsBreakdownCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [department, setDepartment] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDashboardPointsBreakdown({ department })
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [department]);

  useEffect(() => {
    let cancelled = false;
    adminListDepartments()
      .then((rows) => { if (!cancelled) setDepartments(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setDepartments([]); });
    return () => { cancelled = true; };
  }, []);

  const items = CATEGORY_META.map((m) => ({
    label: m.label,
    color: m.color,
    value: Number(data?.[m.key] || 0),
  }));
  const hasData = items.some((it) => it.value > 0);

  return (
    <Card
      size="small"
      className="dash-card"
      title={(
        <div className="dash-card__title">
          <span className="dash-card__title-eyebrow">Composition</span>
          <span className="dash-card__title-text">积分分类构成</span>
        </div>
      )}
      extra={(
        <Select
          size="small"
          value={department}
          style={{ minWidth: 220 }}
          popupMatchSelectWidth={false}
          onChange={setDepartment}
          options={[
            { value: "", label: "全部部门" },
            ...departments.map((item) => ({ value: item, label: formatDepartmentName(item) })),
          ]}
        />
      )}
    >
      <Spin spinning={loading}>
        {hasData ? (
          <DonutChart data={items} size={220} thickness={28} />
        ) : (
          <div className="dash-empty">
            <Empty description="暂无积分数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </Spin>
    </Card>
  );
}
