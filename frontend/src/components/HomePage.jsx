import {
  ArrowRightOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  FormOutlined,
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
import { fetchMyPaperAssignments } from "../lib/api.userPapers";
import { getCurrentUser } from "../lib/auth";
import { loadActiveSession } from "../lib/storage";

const { Paragraph, Text, Title } = Typography;

function challengeStatusLabel(status) {
  if (status === "passed") return "已通过";
  if (status === "failed") return "未通过";
  if (status === "in_progress") return "进行中";
  if (status === "pending_review") return "待复核";
  return "待开始";
}

function paperStatusLabel(item) {
  if (item.is_expired && item.last_status !== "graded") return "已截止";
  if (item.last_status === "graded") return item.last_is_pass ? "已通过" : "未通过";
  if (item.last_status === "submitted") return "待复核";
  if (item.last_status === "in_progress") return "进行中";
  return "待开始";
}

function paperAttemptsLeft(item) {
  return Math.max(0, Number(item.max_attempts || 1) - Number(item.attempt_count || 0));
}

function paperIsTodo(item) {
  if (item.last_status === "graded") return false;
  if (item.is_expired && paperAttemptsLeft(item) <= 0) return false;
  return true;
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

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function greetingFor(hour) {
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  if (hour < 22) return "晚上好";
  return "夜深了";
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const initialDelay = 1000 - (Date.now() % 1000);
    let intervalId = null;
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 1000);
    }, initialDelay);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateText = dayjs(now).format("YYYY 年 M 月 D 日");
  const weekday = WEEKDAY_LABELS[now.getDay()];
  const greeting = greetingFor(now.getHours());
  const minuteProgress = (now.getSeconds() + now.getMilliseconds() / 1000) / 60;

  return (
    <div className="live-clock fade-in-up" style={{ "--fade-delay": "300ms" }} aria-live="polite">
      <span className="live-clock__eyebrow">Local Time</span>

      <div className="live-clock__row">
        <span className="live-clock__digits">
          <span className="live-clock__hm">{hh}<i>:</i>{mm}</span>
          <span className="live-clock__sec">{ss}</span>
        </span>
        <span className="live-clock__greeting">{greeting}</span>
      </div>

      <div className="live-clock__bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${minuteProgress})` }} />
      </div>

      <div className="live-clock__meta">
        <span>{weekday}</span>
        <span className="live-clock__dot" aria-hidden="true" />
        <span>{dateText}</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = getCurrentUser();
  const [, setLoading] = useState(true);
  const [challenges, setChallenges] = useState([]); // 老的"通关"
  const [papers, setPapers] = useState([]);         // 新的"考试"
  const [records, setRecords] = useState([]);
  const [videos, setVideos] = useState([]);
  const [audios, setAudios] = useState([]);
  const activeSession = useMemo(() => loadActiveSession(), []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [challengeData, paperData, recordData, videoData, audioData] = await Promise.all([
          fetchMyExams().catch(() => []),
          fetchMyPaperAssignments().catch(() => []),
          fetchMyTrainingRecords().catch(() => []),
          fetchMyMagicVideos().catch(() => []),
          fetchMyAudios().catch(() => []),
        ]);
        if (!alive) return;
        setChallenges(Array.isArray(challengeData) ? challengeData : []);
        setPapers(Array.isArray(paperData) ? paperData : []);
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

  const todoChallenges = challenges.filter((item) =>
    ["pending", "in_progress", "pending_review"].includes(item.exam?.status),
  );
  const doneChallenges = challenges.filter((item) =>
    ["passed", "failed"].includes(item.exam?.status),
  );
  const todoPapers = papers.filter(paperIsTodo);
  const donePapers = papers.filter((p) => !paperIsTodo(p));
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
          title: activeSession.mode === "exam" ? "继续上次通关" : "继续上次训练",
          description: activeSession.training_type
            ? `${activeSession.training_type} · ${activeSession.difficulty || "未标记难度"}`
            : "回到上次会话。",
          action: "继续",
          onClick: () => navigate(`/chat/${activeSession.session_id}`),
        }
      : null,
    todoPapers[0]
      ? {
          key: "paper",
          icon: <FormOutlined />,
          title: todoPapers[0].last_status === "submitted" ? "查看考试结果" : "处理待办考试",
          description: `${todoPapers[0].paper_title} · ${paperStatusLabel(todoPapers[0])}`,
          action: todoPapers[0].last_status === "submitted" ? "查看" : "进入",
          onClick: () =>
            navigate(
              todoPapers[0].last_status === "submitted" && todoPapers[0].last_submission_id
                ? `/papers/submissions/${todoPapers[0].last_submission_id}`
                : `/papers/${todoPapers[0].id}/take`,
            ),
        }
      : null,
    todoChallenges[0]?.exam
      ? {
          key: "challenge",
          icon: <ClockCircleOutlined />,
          title: todoChallenges[0].exam.status === "pending_review" ? "查看通关结果" : "处理待办通关",
          description: `${todoChallenges[0].exam.title || "AI 通关"} · ${challengeStatusLabel(
            todoChallenges[0].exam.status,
          )}`,
          action: todoChallenges[0].exam.status === "pending_review" ? "查看" : "进入",
          onClick: () =>
            navigate(
              todoChallenges[0].exam.status === "pending_review"
                ? `/exam/${todoChallenges[0].exam.id}/result`
                : `/exam/${todoChallenges[0].exam.id}/intro`,
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
    .slice(0, 4);

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
              进入<strong style={{ color: "var(--accent-deep)" }}>销售对练</strong>磨砺话术、
              走进<strong style={{ color: "var(--accent-deep)" }}>魔学院</strong>沉淀知识，
              或前往<strong style={{ color: "var(--accent-deep)" }}>考试</strong>验证学习成果。
            </Paragraph>
            <LiveClock />
          </div>
          <aside className="showcase-hero__side fade-in-up" style={{ "--fade-delay": "380ms" }}>
            <span className="showcase-hero__side-eyebrow">Today at a glance</span>
            <ul className="showcase-hero__side-list">
              <li className="showcase-hero__side-item">
                <span>待办考试</span>
                <strong>{todoPapers.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>待办通关</span>
                <strong>{todoChallenges.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>训练均分</span>
                <strong>{averageScore}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>完课率</span>
                <strong>{completedVideoRate}%</strong>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="showcase-section fade-in-up" style={{ "--fade-delay": "120ms" }}>
        <div className="showcase-section__header">
          <span className="showcase-eyebrow">Modules</span>
          <Title level={2} className="showcase-title">三大功能区</Title>
          <p className="showcase-lead">练习、学习、考试，按需进入对应空间。</p>
        </div>

        <div className="entry-grid">
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
              <p className="entry-card__subtitle">模拟 · 通关 · 复盘</p>
            </div>
            <p className="entry-card__desc">
              通过 AI 对练还原真实客户场景，结合 AI 通关与复盘形成"练-评-改"的闭环。
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

          <button
            type="button"
            className="entry-card fade-in-up"
            style={{ "--fade-delay": "340ms" }}
            onClick={() => navigate("/papers")}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">03</span>
              <span className="entry-card__tag">EXAM</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">考试中心</h3>
              <p className="entry-card__subtitle">试卷 · 答题 · 评分</p>
            </div>
            <p className="entry-card__desc">
              {todoPapers.length > 0
                ? `当前有 ${todoPapers.length} 份待办考试，按截止时间提交答卷即可。`
                : "暂无待办考试，可回顾过往答卷与成绩。"}
            </p>
            <span className="entry-card__cta">
              {todoPapers.length > 0 ? "前往作答" : "查看记录"}
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
            <span className="stats-row__icon"><RocketOutlined /></span>
            <span className="stats-row__value">{records.length}</span>
            <span className="stats-row__label">训练次数</span>
          </div>
          <div className="stats-row__item stats-row__item--accent">
            <span className="stats-row__icon"><FormOutlined /></span>
            <span className="stats-row__value">
              {donePapers.length}
              <span className="stats-row__value-suffix">/ {papers.length || 0}</span>
            </span>
            <span className="stats-row__label">完成考试</span>
          </div>
          <div className="stats-row__item stats-row__item--violet">
            <span className="stats-row__icon"><TrophyOutlined /></span>
            <span className="stats-row__value">
              {doneChallenges.length}
              <span className="stats-row__value-suffix">/ {challenges.length || 0}</span>
            </span>
            <span className="stats-row__label">完成通关</span>
          </div>
          <div className="stats-row__item stats-row__item--warm">
            <span className="stats-row__icon"><ReadOutlined /></span>
            <span className="stats-row__value">
              {completedVideoRate}
              <span className="stats-row__value-suffix">%</span>
            </span>
            <span className="stats-row__label">完课率</span>
          </div>
          <div className="stats-row__item stats-row__item--rose">
            <span className="stats-row__icon"><CalendarOutlined /></span>
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
