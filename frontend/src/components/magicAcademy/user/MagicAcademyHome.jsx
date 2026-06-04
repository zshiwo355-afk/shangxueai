import {
  ArrowRightOutlined,
  BookOutlined,
  CalendarOutlined,
  ReadOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import MentorPreviewSection from "./mentor/MentorPreviewSection";

const { Title, Paragraph } = Typography;

export default function MagicAcademyHome({
  continueStudyVideo,
  todayUploadedAudio,
  myRequiredVideosCount,
  myLearningVideosCount,
  myCompletedVideosCount,
  latestAudioRecord,
  onOpenCourseCenter,
  onOpenReadingCenter,
  onOpenMentorZone,
  yearMark = "魔",
}) {
  return (
    <>
      <section className="showcase-hero">
        <span className="showcase-hero__year" aria-hidden="true">{yearMark}</span>
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
                onClick={() => onOpenCourseCenter()}
              >
                <ReadOutlined />
                <span>{continueStudyVideo ? "继续学习" : "进入课程"}</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
              <button
                type="button"
                className="cta-arrow-btn cta-arrow-btn--ghost"
                onClick={onOpenReadingCenter}
              >
                <CalendarOutlined />
                <span>{todayUploadedAudio ? "查看打卡" : "今日打卡"}</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
            </div>
          </div>
          <aside className="showcase-hero__side fade-in-up" style={{ "--fade-delay": "380ms" }}>
            <span className="showcase-hero__side-eyebrow">Learning at a glance</span>
            <ul className="showcase-hero__side-list">
              <li className="showcase-hero__side-item">
                <span>待学必修</span>
                <strong>{myRequiredVideosCount}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>进行中</span>
                <strong>{myLearningVideosCount}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>已完成</span>
                <strong>{myCompletedVideosCount}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>今日打卡</span>
                <strong>{todayUploadedAudio ? "已完成" : "待完成"}</strong>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="showcase-section fade-in-up" style={{ "--fade-delay": "120ms" }}>
        <div className="showcase-section__header">
          <span className="showcase-eyebrow">Modules</span>
          <Title level={2} className="showcase-title">两条主线</Title>
          <p className="showcase-lead">课程学习与读书打卡分开管理，路径更短、信息不混。</p>
        </div>

        <div className="entry-grid entry-grid--two">
          <button
            type="button"
            className="entry-card entry-card--feature fade-in-up"
            style={{ "--fade-delay": "180ms" }}
            onClick={() => onOpenCourseCenter()}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">01</span>
              <span className="entry-card__tag">VIDEO COURSES</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">课程学习</h3>
              <p className="entry-card__subtitle">视频 · 节点答题 · 学习进度</p>
            </div>
            <p className="entry-card__desc">
              {continueStudyVideo
                ? `推荐继续：${continueStudyVideo.title}`
                : "进入课程列表，按推荐顺序逐个完成。"}
            </p>
            <span className="entry-card__cta">
              {continueStudyVideo ? "继续学习" : "浏览课程"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>

          <button
            type="button"
            className="entry-card fade-in-up"
            style={{ "--fade-delay": "260ms" }}
            onClick={onOpenReadingCenter}
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
              {todayUploadedAudio
                ? "今天已经完成打卡，可以继续保持节奏。"
                : "今天还没有上传录音，建议学习结束后顺手完成。"}
            </p>
            <span className="entry-card__cta">
              {todayUploadedAudio ? "查看打卡记录" : "去完成打卡"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>
        </div>
      </section>

      <section className="showcase-section">
        <div className="stats-row fade-in-up">
          <div className="stats-row__item">
            <span className="stats-row__value">{myRequiredVideosCount}</span>
            <span className="stats-row__label">待学必修</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{myLearningVideosCount}</span>
            <span className="stats-row__label">进行中</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{myCompletedVideosCount}</span>
            <span className="stats-row__label">已完成</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{todayUploadedAudio ? "✓" : "—"}</span>
            <span className="stats-row__label">今日打卡</span>
          </div>
        </div>
      </section>

      {latestAudioRecord ? (
        <section className="showcase-section">
          <div className="workspace-panel">
            <div className="workspace-panel__head">
              <Space>
                <BookOutlined />
                <strong>最近上传</strong>
              </Space>
              <Button type="link" icon={<RightOutlined />} onClick={onOpenReadingCenter}>打卡中心</Button>
            </div>
            <div className="workspace-note-block">
              <strong>{latestAudioRecord.file_name || "未命名录音"}</strong>
              <p>{latestAudioRecord.remark || "暂无备注"}</p>
              <span className="workspace-note-block__meta">
                {latestAudioRecord.uploaded_time?.replace("T", " ").slice(0, 19) || "-"}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <MentorPreviewSection onViewAll={onOpenMentorZone} />
    </>
  );
}
