import { useEffect, useState } from "react";
import { Result, Spin } from "antd";
import { useParams } from "react-router-dom";

import { getSharedAssessmentResult } from "../../lib/api.assessments";
import AssessmentReport from "./AssessmentReport";
import "../admin/assessment/assessment-admin.css";


export default function PublicAssessmentResultPage() {
  const { shareCode } = useParams();
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setDetail(null);
    getSharedAssessmentResult(shareCode)
      .then((result) => { if (active) setDetail(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [shareCode]);

  useEffect(() => {
    const previousTitle = document.title;
    const existingRobots = document.querySelector('meta[name="robots"]');
    const previousRobots = existingRobots?.content;
    const robots = existingRobots || document.createElement("meta");
    if (!existingRobots) {
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    robots.content = "noindex,nofollow";
    return () => {
      document.title = previousTitle;
      if (existingRobots) robots.content = previousRobots || "";
      else robots.remove();
    };
  }, []);

  useEffect(() => {
    document.title = detail ? `${detail.name || "已匿名"} · 答卷 #${detail.id}` : "测评报告";
  }, [detail]);

  if (failed) {
    return (
      <main className="assessment-public-result assessment-public-result--center">
        <Result
          status="warning"
          title="该报告链接已失效"
          subTitle="请联系分享人重新获取。"
        />
      </main>
    );
  }

  if (!detail) {
    return <main className="assessment-public-result assessment-public-result--center"><Spin size="large" /></main>;
  }

  return (
    <main className="assessment-public-result">
      <header className="assessment-public-result__header">
        <h1>{detail.name || "已匿名"} · 答卷 #{detail.id}</h1>
      </header>
      <AssessmentReport detail={detail} />
    </main>
  );
}
