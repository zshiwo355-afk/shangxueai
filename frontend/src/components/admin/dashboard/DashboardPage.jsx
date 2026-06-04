import { App as AntdApp, Col, Row, Spin } from "antd";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchDashboardKpi(), fetchDashboardPendingTasks()])
      .then(([k, p]) => {
        if (cancelled) return;
        setKpi(k);
        setPending(p);
      })
      .catch((err) => message.error(err?.message || "看板加载失败。"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [message]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Spin spinning={loading}>
        <KpiOverviewCards kpi={kpi} pending={pending} />
      </Spin>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <TrendChart />
        </Col>
        <Col xs={24} lg={8}>
          <LeaderboardPreview />
        </Col>
      </Row>

      <DepartmentChart />

      <PointsBreakdownCard />
    </div>
  );
}

