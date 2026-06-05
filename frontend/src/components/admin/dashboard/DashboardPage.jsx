import { App as AntdApp, Col, Row, Skeleton } from "antd";
import { useEffect, useState } from "react";

import {
  fetchDashboardKpi,
  fetchDashboardPendingTasks,
} from "../../../lib/api.dashboard";
import "./dashboard.css";
import DepartmentChart from "./DepartmentTable";
import KpiOverviewCards from "./KpiOverviewCards";
import LeaderboardPreview from "./LeaderboardPreview";
import PointsBreakdownCard from "./PointsBreakdownCard";
import TrendChart from "./TrendChart";

function SectionHead({ eyebrow, title }) {
  return (
    <header className="dash-section__head">
      <div className="dash-section__title-group">
        <span className="dash-section__eyebrow">{eyebrow}</span>
        <h2 className="dash-section__title">{title}</h2>
      </div>
    </header>
  );
}

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
    <div className="dash">
      <section className="dash-section">
        <SectionHead eyebrow="01 · Vital Signs" title="关键指标速览" />
        {kpi ? (
          <KpiOverviewCards kpi={kpi} pending={pending} />
        ) : (
          <Skeleton active paragraph={{ rows: 3 }} />
        )}
      </section>

      <section className="dash-section">
        <SectionHead eyebrow="02 · Activity & Champions" title="趋势走向 · 学习达人" />
        <Row gutter={[20, 20]} align="stretch">
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
      </section>

      <section className="dash-section">
        <SectionHead eyebrow="03 · By Department" title="部门维度透视" />
        <DepartmentChart />
      </section>

      <section className="dash-section">
        <SectionHead eyebrow="04 · Points Composition" title="积分分类构成" />
        <PointsBreakdownCard />
      </section>
    </div>
  );
}
