import {
  ArrowRightOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  PlayCircleFilled,
  ReadOutlined,
  RocketOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Progress, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyExams } from "../lib/api.exam";
import { fetchMyAudios, fetchMyMagicVideos } from "../lib/api.magic";
import { fetchMyTrainingRecords } from "../lib/api.training";
import { getCurrentUser } from "../lib/auth";
import { loadActiveSession } from "../lib/storage";

const { Paragraph, Text, Title } = Typography;

function examStatusLabel(status) {
  if (status === "passed") return "已通过";
  if (status === "failed") return "未通过";
  if (status === "in_progress") return "进行中";
  if (status === "pending_review") return "待复核";
  return "待开始";
}

function resultColor(result) {
  if (result === "成交") return "success";
  if (result === "意向客户") return "processing";
  return "default";
}

function formatTime(value) {
  if (!value) return "暂无时间";
  return String(value).slice(0, 16).replace("T", " ");
}

export default function HomePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = getCurrentUser();
  const [, setLoading] = useState(true);
  const [exams, setExams] = useState([]);
  const [records, setRecords] = useState([]);
  const [videos, setVideos] = useState([]);
  const [audios, setAudios] = useState([]);
  const activeSession = useMemo(() => loadActiveSession(), []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [examData, recordData, videoData, audioData] = await Promise.all([
          fetchMyExams().catch(() => []),
          fetchMyTrainingRecords().catch(() => []),
          fetchMyMagicVideos().catch(() => []),
          fetchMyAudios().catch(() => []),
        ]);
        if (!alive) return;
        setExams(Array.isArray(examData) ? examData : []);
        setRecords(Array.isArray(recordData) ? recordData : []);
        setVideos(Array.isArray(videoData) ? videoData : []);
        setAudios(Array.isArray(audioData) ? audioData : []);
      } catch (error) {
        if (alive) message.error(error?.message || "首页数据加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [message]);

  const todoExams = exams.filter((item) =>
    ["pending", "in_progress", "pending_review"].includes(item.exam?.status),
  );
  const doneExams = exams.filter((item) => ["passed", "failed"].includes(item.exam?.status));
  const pendingVideos = videos.filter((item) => item.is_required && !item.progress?.is_completed);
  const inProgressVideos = videos.filter(
    (item) => !item.progress?.is_completed && (item.progress?.progress_percent || 0) > 0,
  );
  const continueVideo = inProgressVideos[0] || pendingVideos[0] || videos[0] || null;
  const monthAudioCount = audios.filter(
    (item) => dayjs(item.uploaded_time).format("YYYY-MM") === dayjs().format("YYYY-MM"),
  ).length;
  const todayUploaded = audios.some(
    (item) => dayjs(item.uploaded_time).format("YYYY-MM-DD") === dayjs().format("YYYY-MM-DD"),
  );

  const recentTraining = records.slice(0, 3);
  const recentLearning = videos.slice(0, 3);

  const nextActions = [
    activeSession?.session_id
      ? {
          key: "session",
          icon: <PlayCircleFilled />,
          title: activeSession.mode === "exam" ? "继续上次考试" : "继续上次训练",
          description: activeSession.training_type
            ? `${activeSession.training_type} · ${activeSession.difficulty || "未标记难度"}`
            : "回到上次会话。",
          action: "继续",
          onClick: () => navigate(`/chat/${activeSession.session_id}`),
        }
      : null,
    todoExams[0]?.exam
      ? {
          key: "exam",
          icon: <ClockCircleOutlined />,
          title: todoExams[0].exam.status === "pending_review" ? "查看考试结果" : "处理待办考试",
          description: `${todoExams[0].exam.title || "销售考试"} · ${examStatusLabel(
            todoExams[0].exam.status,
          )}`,
          action: todoExams[0].exam.status === "pending_review" ? "查看" : "进入",
          onClick: () =>
            navigate(
              todoExams[0].exam.status === "pending_review"
                ? `/exam/${todoExams[0].exam.id}/result`
                : `/exam/${todoExams[0].exam.id}/intro`,
            ),
        }
      : null,
    continueVideo
      ? {
          key: "video",
          icon: <ReadOutlined />,
          title: "继续最近课程",
          description: `${continueVideo.title} · ${Math.round(
            continueVideo.progress?.progress_percent || 0,
          )}%`,
          action: "去学习",
          onClick: () => navigate("/workspace/magic"),
        }
      : null,
  ]
    .filter(Boolean)
    .slice(0, 3);

  const averageScore =
    records.length > 0
      ? Math.round(records.reduce((sum, item) => sum + Number(item.score || 0), 0) / records.length)
      : 0;
  const completedVideoRate =
    videos.length > 0
      ? Math.round(
          (videos.filter((item) => item.progress?.is_completed).length / videos.length) * 100,
        )
      : 0;

  const yearText = dayjs().format("YYYY");

  return (
    <div className="portal-home portal-home--editorial portal-home--minimal">
      <section className="showcase-hero">
        <span className="showcase-hero__year" aria-hidden="true">{yearText}</span>
        <div className="showcase-hero__inner">
          <div className="showcase-hero__intro">
            <span className="showcase-eyebrow fade-in-up" style={{ "--fade-delay": "0ms" }}>
              Personal Workspace
            </span>
            <Title level={1} className="showcase-hero__title fade-in-up" style={{ "--fade-delay": "80ms" }}>
              今天，做点什么
            </Title>
            <p className="showcase-hero__english fade-in-up" style={{ "--fade-delay": "160ms" }}>
              SHANGXUE AI · TRAIN · LEARN · GROW
            </p>
            <Paragraph className="showcase-hero__desc fade-in-up" style={{ "--fade-delay": "220ms" }}>
              欢迎回来，{user?.display_name || user?.username || "学员"}。
              从这里出发，进入<strong style={{ color: "var(--accent-deep)" }}>销售对练</strong>磨砺话术，
              或走进<strong style={{ color: "var(--accent-deep)" }}>魔学院</strong>沉淀知识。
            </Paragraph>
            <div className="showcase-hero__actions fade-in-up" style={{ "--fade-delay": "300ms" }}>
              <button
                type="button"
                className="cta-arrow-btn"
                onClick={() => navigate("/workspace/training")}
              >
                <RocketOutlined />
                <span>开启销售对练</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
              <button
                type="button"
                className="cta-arrow-btn cta-arrow-btn--ghost"
                onClick={() => navigate("/workspace/magic")}
              >
                <ReadOutlined />
                <span>进入魔学院</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
            </div>
          </div>
          <aside className="showcase-hero__side fade-in-up" style={{ "--fade-delay": "380ms" }}>
            <span className="showcase-hero__side-eyebrow">Today at a glance</span>
            <ul className="showcase-hero__side-list">
              <li className="showcase-hero__side-item">
                <span>待办考试</span>
                <strong>{todoExams.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>平均得分</span>
                <strong>{averageScore}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>完课率</span>
                <strong>{completedVideoRate}%</strong>
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
          <span className="showcase-eyebrow">Modules</span>
          <Title level={2} className="showcase-title">两大功能区</Title>
          <p className="showcase-lead">把对练与学习清晰拆分，按需进入对应空间。</p>
        </div>

        <div className="entry-grid entry-grid--two">
          <button
            type="button"
            className="entry-card entry-card--feature fade-in-up"
            style={{ "--fade-delay": "180ms" }}
            onClick={() => navigate("/workspace/training")}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">01</span>
              <span className="entry-card__tag">SALES TRAINING</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">销售对练</h3>
              <p className="entry-card__subtitle">模拟 · 考核 · 复盘</p>
            </div>
            <p className="entry-card__desc">
              通过 AI 对练还原真实客户场景，结合考试与复盘形成"练-评-改"的闭环。
            </p>
            <span className="entry-card__cta">
              {activeSession?.session_id ? "继续上次会话" : "进入训练空间"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>

          <button
            type="button"
            className="entry-card fade-in-up"
            style={{ "--fade-delay": "260ms" }}
            onClick={() => navigate("/workspace/magic")}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">02</span>
              <span className="entry-card__tag">MAGIC ACADEMY</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">魔学院</h3>
              <p className="entry-card__subtitle">课程 · 答题 · 打卡</p>
            </div>
            <p className="entry-card__desc">
              视频课程配合节点答题，搭配每日读书录音打卡，让知识沉淀变成习惯。
            </p>
            <span className="entry-card__cta">
              {continueVideo ? "继续学习" : "浏览课程"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>
        </div>
      </section>

      <section className="showcase-section">
        <div className="showcase-section__header">
          <span className="showcase-eyebrow">Next up</span>
          <Title level={3} className="showcase-title" style={{ fontSize: 26 }}>下一步</Title>
        </div>

        {nextActions.length === 0 ? (
          <div className="portal-editorial-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理事项。" />
          </div>
        ) : (
          <div className="portal-editorial-next">
            {nextActions.map((item, idx) => (
              <div
                key={item.key}
                className="portal-editorial-next__item fade-in-up"
                style={{ "--fade-delay": `${120 + idx * 80}ms` }}
              >
                <div className="portal-editorial-next__icon">{item.icon}</div>
                <div className="portal-editorial-next__content">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
                <Button type="link" onClick={item.onClick}>
                  {item.action}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="showcase-section">
        <div className="showcase-section__header">
          <span className="showcase-eyebrow">Recent traces</span>
          <Title level={3} className="showcase-title" style={{ fontSize: 26 }}>最近记录</Title>
        </div>

        <div className="portal-editorial-traces__surface">
          <div className="portal-editorial-traces__column">
            <div className="portal-editorial-traces__head">
              <Space>
                <HistoryOutlined />
                <strong>训练</strong>
              </Space>
              <Button type="link" onClick={() => navigate("/training/records")}>
                全部
              </Button>
            </div>

            {recentTraining.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有训练记录。" />
            ) : (
              <div className="portal-editorial-traces__list">
                {recentTraining.map((item, idx) => (
                  <div
                    key={item.id}
                    className="portal-editorial-trace fade-in-up"
                    style={{ "--fade-delay": `${idx * 80}ms` }}
                  >
                    <div className="portal-editorial-trace__main">
                      <Space size={[8, 8]} wrap>
                        <strong>{item.training_type}</strong>
                        <Tag color={resultColor(item.result)}>{item.result || "待定"}</Tag>
                      </Space>
                      <span>{item.customer_type || "未标记客户类型"}</span>
                    </div>
                    <div className="portal-editorial-trace__side">
                      <span>得分 {Math.round(item.score || 0)}</span>
                      <span>{formatTime(item.created_at)}</span>
                      <Button type="link" onClick={() => navigate(`/training/records/${item.id}`)}>
                        查看
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="portal-editorial-traces__divider" />

          <div className="portal-editorial-traces__column">
            <div className="portal-editorial-traces__head">
              <Space>
                <ReadOutlined />
                <strong>学习</strong>
              </Space>
              <Button type="link" onClick={() => navigate("/workspace/magic")}>
                全部
              </Button>
            </div>

            {recentLearning.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有学习记录。" />
            ) : (
              <div className="portal-editorial-traces__list">
                {recentLearning.map((item, idx) => (
                  <div
                    key={item.id}
                    className="portal-editorial-learning fade-in-up"
                    style={{ "--fade-delay": `${idx * 80}ms` }}
                  >
                    <div className="portal-editorial-learning__head">
                      <Space size={[8, 8]} wrap>
                        <strong>{item.title}</strong>
                        {item.is_required ? <Tag color="gold">必修</Tag> : null}
                      </Space>
                      <span>{Math.round(item.progress?.progress_percent || 0)}%</span>
                    </div>
                    <Progress
                      percent={Math.round(item.progress?.progress_percent || 0)}
                      size="small"
                      showInfo={false}
                    />
                  </div>
                ))}

                <div className="portal-editorial-learning__note">
                  <CalendarOutlined />
                  <span>
                    本月打卡 {monthAudioCount} 次 · {todayUploaded ? "今日已打卡" : "今日未打卡"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="showcase-section">
        <div className="stats-row fade-in-up">
          <div className="stats-row__item">
            <span className="stats-row__value">{records.length}</span>
            <span className="stats-row__label">训练次数</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{doneExams.length}</span>
            <span className="stats-row__label">完成考试</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{completedVideoRate}%</span>
            <span className="stats-row__label">完课率</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{monthAudioCount}</span>
            <span className="stats-row__label">本月打卡</span>
          </div>
        </div>
      </section>

      <section className="portal-editorial-footer portal-editorial-footer--lined">
        <div className="portal-editorial-footer__bottom">
          <span>
            <TrophyOutlined /> Shangxue AI · 数据持续沉淀
          </span>
          <span>{yearText} · 用心练习，每天进步一点</span>
        </div>
      </section>
    </div>
  );
}
