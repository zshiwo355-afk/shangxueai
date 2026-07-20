import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CompassOutlined,
  LockOutlined,
  PlayCircleFilled,
  RocketOutlined,
} from "@ant-design/icons";
import { Button, Progress, Skeleton } from "antd";
import { useMemo } from "react";

import { buildNewcomerLearningMap } from "./newcomerLearningMapData";

function getItemStatus(item, isNext) {
  const percent = Math.round(Number(item.progress?.progress_percent || 0));
  if (item.progress?.is_completed) {
    return { className: "is-complete", icon: <CheckCircleFilled />, label: "已完成" };
  }
  if (item.is_locked) {
    return { className: "is-locked", icon: <LockOutlined />, label: "待解锁" };
  }
  if (percent > 0) {
    return { className: "is-active", icon: <PlayCircleFilled />, label: `学习中 ${percent}%` };
  }
  if (isNext) {
    return { className: "is-active", icon: <PlayCircleFilled />, label: "下一站" };
  }
  return { className: "is-pending", icon: null, label: "待学习" };
}

export default function NewcomerLearningMap({ videos, loading, error, onOpenVideo, onOpenSeries }) {
  const series = useMemo(() => buildNewcomerLearningMap(videos), [videos]);
  const completedCount = series?.items.filter((item) => item.progress?.is_completed).length || 0;
  const totalCount = series?.items.length || 0;
  const completionRate = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
  const nextVideo = series?.items.find((item) => !item.progress?.is_completed && !item.is_locked) || null;

  if (loading) {
    return (
      <section className="newcomer-learning-map newcomer-learning-map--loading" aria-label="新人学习地图加载中">
        <Skeleton active paragraph={{ rows: 3 }} title={{ width: "36%" }} />
      </section>
    );
  }

  if (error || !series || totalCount === 0) {
    return (
      <section className="newcomer-learning-map newcomer-learning-map--empty" aria-labelledby="newcomer-map-title">
        <span className="newcomer-learning-map__empty-icon" aria-hidden="true"><CompassOutlined /></span>
        <div>
          <span className="newcomer-learning-map__eyebrow">NEW EMPLOYEE ROADMAP</span>
          <h2 id="newcomer-map-title">新人学习地图</h2>
          <p>{error ? "学习地图暂时加载失败，可前往课程中心继续学习。" : "学习地图课程正在准备中，可先前往课程中心看看。"}</p>
        </div>
        <Button type="primary" onClick={() => onOpenSeries(null)}>进入课程中心</Button>
      </section>
    );
  }

  const allCompleted = completedCount === totalCount;

  return (
    <section className="newcomer-learning-map fade-in-up" aria-labelledby="newcomer-map-title">
      <span className="newcomer-learning-map__glow" aria-hidden="true" />
      <header className="newcomer-learning-map__header">
        <div className="newcomer-learning-map__heading">
          <span className="newcomer-learning-map__brand" aria-hidden="true"><RocketOutlined /></span>
          <div>
            <span className="newcomer-learning-map__eyebrow">NEW EMPLOYEE ROADMAP</span>
            <h2 id="newcomer-map-title">{series.title}</h2>
            <p>{series.description || "从认识公司到掌握工作工具，跟着地图完成你的新人必修课。"}</p>
          </div>
        </div>

        <div className="newcomer-learning-map__summary">
          <div className="newcomer-learning-map__progress-copy">
            <span>学习进度</span>
            <strong>{completedCount}<small> / {totalCount} 节</small></strong>
          </div>
          <Progress percent={completionRate} showInfo={false} strokeColor="#4d7fff" railColor="rgba(77, 127, 255, 0.14)" />
          <Button
            type="primary"
            icon={allCompleted ? <CheckCircleFilled /> : <PlayCircleFilled />}
            onClick={() => (nextVideo ? onOpenVideo(nextVideo) : onOpenSeries(series.id))}
          >
            {allCompleted ? "回顾学习地图" : completedCount > 0 ? "继续学习" : "开始第一课"}
          </Button>
        </div>
      </header>

      <div className="newcomer-learning-map__route-scroll">
        <ol className="newcomer-learning-map__route" style={{ "--route-count": totalCount }}>
          {series.items.map((item, index) => {
            const status = getItemStatus(item, item.id === nextVideo?.id);
            return (
              <li key={item.id} className={`newcomer-learning-map__stop ${status.className}`}>
                <button
                  type="button"
                  disabled={!!item.is_locked}
                  onClick={() => onOpenVideo(item)}
                  aria-label={`第 ${index + 1} 站：${item.title}，${status.label}`}
                >
                  <span className="newcomer-learning-map__node">
                    {status.icon || <span>{String(index + 1).padStart(2, "0")}</span>}
                  </span>
                  <span className="newcomer-learning-map__step">第 {index + 1} 站</span>
                  <strong>{item.title}</strong>
                  <span className="newcomer-learning-map__status">{status.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="newcomer-learning-map__footer">
        <span>{series.sequentialUnlockEnabled ? "完成上一节后，下一站将自动解锁" : "课程可按你的节奏自由学习"}</span>
        <button type="button" onClick={() => onOpenSeries(series.id)}>
          查看完整课程 <ArrowRightOutlined />
        </button>
      </footer>
    </section>
  );
}
