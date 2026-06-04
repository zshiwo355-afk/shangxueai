import { App as AntdApp, Col, Row, Skeleton } from "antd";
import { useEffect, useState } from "react";

import {
  fetchDashboardKpi,
  fetchDashboardPendingTasks,
} from "../../../lib/api.dashboard";
import DepartmentChart from "./DepartmentTable";
import KpiOverviewCards from "./KpiOverviewCards";
import LeaderboardPreview from "./LeaderboardPreview";
import PointsBreakdownCard from "./PointsBreakdownCard";
import TrendChart from "./TrendChart";

export default function DashboardPage() {
  const { message } = AntdApp.useApp();
  const [kpi, setKpi] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchDashboardKpi()
      .then((k) => { if (!cancelled) setKpi(k); })
      .catch((err) => { if (!cancelled) message.error(err?.message || "看板 KPI 加载失败。"); });
    fetchDashboardPendingTasks()
      .then((p) => { if (!cancelled) setPending(p); })
      .catch((err) => { if (!cancelled) message.error(err?.message || "待办加载失败。"); });
    return () => { cancelled = true; };
  }, [message]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {kpi ? (
        <KpiOverviewCards kpi={kpi} pending={pending} />
      ) : (
        <Skeleton active paragraph={{ rows: 2 }} />
      )}

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} lg={16} style={{ display: "flex" }}>
          <div style={{ flex: 1, display: "flex" }}>
            <TrendChart />
          </div>
        </Col>
        <Col xs={24} lg={8} style={{ display: "flex" }}>
          <div style={{ flex: 1, display: "flex" }}>
            <LeaderboardPreview />
          </div>
        </Col>
      </Row>

      <DepartmentChart />

      <PointsBreakdownCard />
    </div>
  );
}

