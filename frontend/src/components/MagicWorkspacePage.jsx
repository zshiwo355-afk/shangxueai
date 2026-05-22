import {
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ReadOutlined,
  RightOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Progress, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyAudios, fetchMyMagicVideos } from "../lib/api.magic";

const { Paragraph, Title } = Typography;

export default function MagicWorkspacePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [videos, setVideos] = useState([]);
  const [audios, setAudios] = useState([]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [videoData, audioData] = await Promise.all([
          fetchMyMagicVideos().catch(() => []),
          fetchMyAudios().catch(() => []),
        ]);
        if (!alive) return;
        setVideos(Array.isArray(videoData) ? videoData : []);
        setAudios(Array.isArray(audioData) ? audioData : []);
      } catch (error) {
        if (alive) message.error(error?.message || "课程管理学习中心加载失败。");
      }
    })();

    return () => {
      alive = false;
    };
  }, [message]);

  const requiredPending = videos.filter((item) => item.is_required && !item.progress?.is_completed);
  const inProgress = videos.filter(
    (item) => !item.progress?.is_completed && (item.progress?.progress_percent || 0) > 0,
  );
  const completed = videos.filter((item) => item.progress?.is_completed);
  const continueVideo = inProgress[0] || requiredPending[0] || videos[0] || null;
  const monthAudioCount = audios.filter(
    (item) => dayjs(item.uploaded_date).format("YYYY-MM") === dayjs().format("YYYY-MM"),
  ).length;
  const todayUploaded = audios.some(
    (item) => dayjs(item.uploaded_date).format("YYYY-MM-DD") === dayjs().format("YYYY-MM-DD"),
  );
  const recentVideos = useMemo(() => {
    const ordered = [...videos].sort(
      (a, b) => (b.progress?.progress_percent || 0) - (a.progress?.progress_percent || 0),
    );
    return ordered.slice(0, 4);
  }, [videos]);
  const openStudyVideo = (videoId) => {
    navigate(`/magic-academy?tab=courses&video=${encodeURIComponent(String(videoId))}`);
  };

  return (
    <div className="workspace-shell workspace-shell--editorial workspace-shell--minimal">
      <section className="showcase-hero">
        <span className="showcase-hero__year" aria-hidden="true">魔</span>
        <div className="showcase-hero__inner">
          <div className="showcase-hero__intro">
            <span className="showcase-eyebrow fade-in-up" style={{ "--fade-delay": "0ms" }}>
              Magic Academy
            </span>
            <Title level={1} className="showcase-hero__title fade-in-up" style={{ "--fade-delay": "80ms" }}>
              课程 · 答题 · 打卡
            </Title>
            <p className="showcase-hero__english fade-in-up" style={{ "--fade-delay": "160ms" }}>
              KEEP LEARNING · KEEP GROWING
            </p>
            <Paragraph className="showcase-hero__desc fade-in-up" style={{ "--fade-delay": "220ms" }}>
              视频课程帮你建立知识框架，节点答题确认理解深度，
              读书打卡让每天的学习沉淀下来。
            </Paragraph>
            <div className="showcase-hero__actions fade-in-up" style={{ "--fade-delay": "300ms" }}>
              <button
                type="button"
                className="cta-arrow-btn"
                onClick={() => navigate("/magic-academy?tab=courses")}
              >
                <ReadOutlined />
                <span>进入学习中心</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
              <button
                type="button"
                className="cta-arrow-btn cta-arrow-btn--ghost"
                onClick={() => navigate("/magic-academy?tab=audio")}
              >
                <CalendarOutlined />
                <span>{todayUploaded ? "查看打卡记录" : "去完成打卡"}</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
            </div>
          </div>
          <aside className="showcase-hero__side fade-in-up" style={{ "--fade-delay": "380ms" }}>
            <span className="showcase-hero__side-eyebrow">Learning at a glance</span>
            <ul className="showcase-hero__side-list">
              <li className="showcase-hero__side-item">
                <span>待学必修</span>
                <strong>{requiredPending.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>进行中</span>
                <strong>{inProgress.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>已完成</span>
                <strong>{completed.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>本月打卡</span>
                <strong>{monthAudioCount}</strong>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="showcase-section fade-in-up" style={{ "--fade-delay": "120ms" }}>
        <div className="showcase-section__header">
          <span className="showcase-eyebrow">Quick entry</span>
          <Title level={2} className="showcase-title">从这里开始</Title>
          <p className="showcase-lead">两条清晰的路径，按需进入对应的学习空间。</p>
        </div>

        <div className="entry-grid entry-grid--two">
          <button
            type="button"
            className="entry-card entry-card--feature fade-in-up"
            style={{ "--fade-delay": "160ms" }}
            onClick={() => navigate("/magic-academy")}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">01</span>
              <span className="entry-card__tag">VIDEO COURSES</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">课程中心</h3>
              <p className="entry-card__subtitle">学知识 · 答题节点 · 持续进度</p>
            </div>
            <p className="entry-card__desc">
              从这里继续未完的课程，或翻阅整套课程库。学习过程中按节点答题，确认每段内容都真正吸收。
            </p>
            <span className="entry-card__cta">
              {continueVideo ? `继续学习：${continueVideo.title}` : "浏览课程"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>

          <button
            type="button"
            className="entry-card fade-in-up"
            style={{ "--fade-delay": "240ms" }}
            onClick={() => navigate("/magic-academy?tab=audio")}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">02</span>
              <span className="entry-card__tag">DAILY READING</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">读书打卡</h3>
              <p className="entry-card__subtitle">每日上传 · 月度统计</p>
            </div>
            <p className="entry-card__desc">
              记录每天的读书录音，配合上传日历养成习惯。本月已上传 {monthAudioCount} 次
              {todayUploaded ? "，今天已经打过卡了。" : "，今天还没有打卡。"}
            </p>
            <span className="entry-card__cta">
              {todayUploaded ? "查看打卡记录" : "去完成今日打卡"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>
        </div>
      </section>

      <section className="workspace-dual workspace-dual--lined">
        <div className="workspace-panel">
          <div className="workspace-panel__head">
            <Space>
              <VideoCameraOutlined />
              <strong>学习任务</strong>
            </Space>
            <Button type="link" icon={<RightOutlined />} onClick={() => navigate("/magic-academy?tab=courses")}>
              全部
            </Button>
          </div>

          {recentVideos.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有学习任务。" />
          ) : (
            <div className="workspace-line-list">
              {recentVideos.map((item, idx) => {
                const percent = Math.round(item.progress?.progress_percent || 0);

                return (
                  <div
                    key={item.id}
                    className="workspace-line-item workspace-line-item--stack fade-in-up"
                    style={{ "--fade-delay": `${idx * 70}ms` }}
                  >
                    <div className="workspace-line-item__content">
                      <Space size={[8, 8]} wrap>
                        <strong>{item.title}</strong>
                        {item.is_required ? <Tag color="gold">必修</Tag> : null}
                        {item.progress?.is_completed ? <Tag color="success">已完成</Tag> : null}
                      </Space>
                      <span>{item.category || "未分类课程"}</span>
                      <Progress percent={percent} size="small" showInfo={false} />
                    </div>
                    <Button type="link" onClick={() => openStudyVideo(item.id)}>
                      {item.progress?.is_completed ? "查看" : "继续"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="workspace-panel workspace-panel--aside">
          <div className="workspace-panel">
            <div className="workspace-panel__head">
              <Space>
                <CheckCircleOutlined />
                <strong>学习概览</strong>
              </Space>
            </div>

            <div className="workspace-mini-grid">
              <div>
                <span>进行中</span>
                <strong>{inProgress.length}</strong>
              </div>
              <div>
                <span>已完成</span>
                <strong>{completed.length}</strong>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <section className="showcase-section">
        <div className="stats-row fade-in-up">
          <div className="stats-row__item">
            <span className="stats-row__value">{videos.length}</span>
            <span className="stats-row__label">总课程</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{completed.length}</span>
            <span className="stats-row__label">已完成</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{audios.length}</span>
            <span className="stats-row__label">累计打卡</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{monthAudioCount}</span>
            <span className="stats-row__label">本月打卡</span>
          </div>
        </div>
      </section>
    </div>
  );
}
