import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  RocketOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyExams } from "../lib/api.exam";
import { fetchMyTrainingRecords } from "../lib/api.training";
import { loadActiveSession } from "../lib/storage";

const { Paragraph, Title } = Typography;

function buildExamStatus(exam) {
  if (exam?.status === "pending_review") return { label: "待复核", color: "gold" };
  if (exam?.status === "in_progress") return { label: "进行中", color: "processing" };
  if (exam?.status === "passed") return { label: "已通过", color: "success" };
  if (exam?.status === "failed") return { label: "未通过", color: "error" };
  return { label: "待开始", color: "warning" };
}

function resultColor(result) {
  if (result === "成交") return "success";
  if (result === "意向客户") return "processing";
  return "default";
}

function scoreTone(score) {
  const value = Number(score || 0);
  if (value >= 85) return { color: "var(--accent-deep, #426f9f)", label: "优" };
  if (value >= 70) return { color: "#16a34a", label: "良" };
  if (value >= 60) return { color: "#f59e0b", label: "中" };
  return { color: "#dc2626", label: "待提升" };
}

function formatTime(value) {
  if (!value) return "暂无时间";
  return String(value).slice(0, 16).replace("T", " ");
}

export default function TrainingWorkspacePage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [exams, setExams] = useState([]);
  const [records, setRecords] = useState([]);
  const activeSession = useMemo(() => loadActiveSession(), []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [examData, recordData] = await Promise.all([
          fetchMyExams().catch(() => []),
          fetchMyTrainingRecords().catch(() => []),
        ]);
        if (!alive) return;
        setExams(Array.isArray(examData) ? examData : []);
        setRecords(Array.isArray(recordData) ? recordData : []);
      } catch (error) {
        if (alive) message.error(error?.message || "销售对练工作台加载失败。");
      }
    })();

    return () => {
      alive = false;
    };
  }, [message]);

  const pendingExams = exams.filter((item) =>
    ["pending", "in_progress", "pending_review"].includes(item.exam?.status),
  );
  const recentRecords = records.slice(0, 3);

  const nextActions = [
    activeSession?.session_id
      ? {
          key: "session",
          icon: <PlayCircleOutlined />,
          title: activeSession.mode === "exam" ? "继续上次通关" : "继续上次训练",
          description: activeSession.training_type
            ? `${activeSession.training_type} · ${activeSession.difficulty || "未标记难度"}`
            : "回到上次会话。",
          action: "继续",
          onClick: () => navigate(`/chat/${activeSession.session_id}`),
        }
      : {
          key: "start",
          icon: <RocketOutlined />,
          title: "开始新训练",
          description: "重新开始。",
          action: "去开始",
          onClick: () => navigate("/train/prepare"),
        },
    pendingExams[0]?.exam
      ? {
          key: "exam",
          icon: <ClockCircleOutlined />,
          title: pendingExams[0].exam.status === "pending_review" ? "查看通关结果" : "处理待办通关",
          description: `${pendingExams[0].exam.title || "AI 通关"} · ${
            buildExamStatus(pendingExams[0].exam).label
          }`,
          action: pendingExams[0].exam.status === "pending_review" ? "查看" : "进入",
          onClick: () =>
            navigate(
              pendingExams[0].exam.status === "pending_review"
                ? `/exam/${pendingExams[0].exam.id}/result`
                : `/exam/${pendingExams[0].exam.id}/intro`,
            ),
        }
      : {
          key: "records",
          icon: <ReadOutlined />,
          title: "回看最近复盘",
          description: "查看最近结果。",
          action: "查看",
          onClick: () => navigate("/training/records"),
        },
  ];

  return (
    <div className="workspace-shell workspace-shell--editorial workspace-shell--minimal">
      <section className="showcase-hero">
        <span className="showcase-hero__year" aria-hidden="true">练</span>
        <div className="showcase-hero__inner">
          <div className="showcase-hero__intro">
            <span className="showcase-eyebrow fade-in-up" style={{ "--fade-delay": "0ms" }}>
              Sales Training
            </span>
            <Title level={1} className="showcase-hero__title fade-in-up" style={{ "--fade-delay": "80ms" }}>
              训练 · 通关 · 复盘
            </Title>
            <p className="showcase-hero__english fade-in-up" style={{ "--fade-delay": "160ms" }}>
              PRACTICE MAKES PERFECT
            </p>
            <Paragraph className="showcase-hero__desc fade-in-up" style={{ "--fade-delay": "220ms" }}>
              在真实场景里反复打磨话术，结合 AI 通关与复盘形成"练-评-改"的闭环，
              每一次对话都比上一次更稳。
            </Paragraph>
            <div className="showcase-hero__actions fade-in-up" style={{ "--fade-delay": "300ms" }}>
              <button
                type="button"
                className="cta-arrow-btn"
                onClick={() => navigate(activeSession?.session_id ? `/chat/${activeSession.session_id}` : "/train/prepare")}
              >
                <RocketOutlined />
                <span>{activeSession?.session_id ? "继续上次训练" : "开始新训练"}</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
              <button
                type="button"
                className="cta-arrow-btn cta-arrow-btn--ghost"
                onClick={() => navigate("/training/records")}
              >
                <ReadOutlined />
                <span>训练记录</span>
                <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
              </button>
            </div>
          </div>
          <aside className="showcase-hero__side fade-in-up" style={{ "--fade-delay": "380ms" }}>
            <span className="showcase-hero__side-eyebrow">Today at a glance</span>
            <ul className="showcase-hero__side-list">
              <li className="showcase-hero__side-item">
                <span>待办通关</span>
                <strong>{pendingExams.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>训练记录</span>
                <strong>{records.length}</strong>
              </li>
              <li className="showcase-hero__side-item">
                <span>当前会话</span>
                <strong>{activeSession?.session_id ? "进行中" : "—"}</strong>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="showcase-section fade-in-up" style={{ "--fade-delay": "120ms" }}>
        <div className="showcase-section__header">
          <span className="showcase-eyebrow">Quick entry</span>
          <Title level={2} className="showcase-title">从这里开始</Title>
          <p className="showcase-lead">三种最常见的入口，按当前状态选择最顺手的一条路径。</p>
        </div>

        <div className="entry-grid">
          <button
            type="button"
            className="entry-card entry-card--feature fade-in-up"
            style={{ "--fade-delay": "160ms" }}
            onClick={() => navigate(activeSession?.session_id ? `/chat/${activeSession.session_id}` : "/train/prepare")}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">01</span>
              <span className="entry-card__tag">PRACTICE</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">销售对练</h3>
              <p className="entry-card__subtitle">{activeSession?.session_id ? "继续上次会话" : "重新开始一次"}</p>
            </div>
            <p className="entry-card__desc">
              选择客户类型与难度，进入 AI 模拟对话，沉浸式地反复打磨。
            </p>
            <span className="entry-card__cta">
              {activeSession?.session_id ? "继续会话" : "开始训练"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>

          <button
            type="button"
            className="entry-card fade-in-up"
            style={{ "--fade-delay": "240ms" }}
            onClick={() => {
              const target = pendingExams[0]?.exam;
              if (target) {
                navigate(target.status === "pending_review" ? `/exam/${target.id}/result` : `/exam/${target.id}/intro`);
              } else {
                navigate("/training/records");
              }
            }}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">02</span>
              <span className="entry-card__tag">CHALLENGE</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">AI 通关</h3>
              <p className="entry-card__subtitle">检验话术 · 真实场景评分</p>
            </div>
            <p className="entry-card__desc">
              {pendingExams.length > 0
                ? `当前有 ${pendingExams.length} 项待办通关，从最新的一项开始。`
                : "暂无待办通关，可以回顾最近的通关结果。"}
            </p>
            <span className="entry-card__cta">
              {pendingExams.length > 0 ? "进入通关" : "查看记录"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>

          <button
            type="button"
            className="entry-card fade-in-up"
            style={{ "--fade-delay": "320ms" }}
            onClick={() => navigate("/training/records")}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">03</span>
              <span className="entry-card__tag">REVIEW</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">复盘记录</h3>
              <p className="entry-card__subtitle">回看 · 比较 · 提升</p>
            </div>
            <p className="entry-card__desc">
              翻阅过去的训练对话与评分，理清下一次能改进的细节。
            </p>
            <span className="entry-card__cta">
              查看记录
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>
        </div>
      </section>

      <section className="workspace-action-strip workspace-action-strip--lined">
        <div className="portal-section__header portal-section__header--compact">
          <Title level={3}>下一步</Title>
        </div>

        <div className="workspace-line-list">
          {nextActions.map((item, idx) => (
            <div
              key={item.key}
              className="workspace-line-item fade-in-up"
              style={{ "--fade-delay": `${idx * 70}ms` }}
            >
              <div className="workspace-line-item__icon">{item.icon}</div>
              <div className="workspace-line-item__content">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </div>
              <Button type="link" onClick={item.onClick}>
                {item.action}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="workspace-dual workspace-dual--lined">
        <div className="workspace-panel">
          <div className="workspace-panel__head">
            <Space>
              <ClockCircleOutlined />
              <strong>待办通关</strong>
            </Space>
            <Button type="link" onClick={() => navigate("/training/records")}>
              全部
            </Button>
          </div>

          {pendingExams.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理通关。" />
          ) : (
            <div className="workspace-line-list">
              {pendingExams.slice(0, 3).map((item) => {
                const exam = item.exam || {};
                const status = buildExamStatus(exam);
                const target =
                  exam.status === "pending_review"
                    ? `/exam/${exam.id}/result`
                    : `/exam/${exam.id}/intro`;

                return (
                  <div key={exam.id} className="workspace-line-item workspace-line-item--soft">
                    <div className="workspace-line-item__content">
                      <Space size={[8, 8]} wrap>
                        <strong>{exam.title || "AI 通关"}</strong>
                        <Tag color={status.color}>{status.label}</Tag>
                      </Space>
                      <span>
                        已尝试 {exam.attempt_count}/{exam.max_attempts} · 及格分 {exam.pass_score}
                      </span>
                    </div>
                    <Button type="link" onClick={() => navigate(target)}>
                      处理
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
                <PlayCircleOutlined />
                <strong>继续训练</strong>
              </Space>
              {activeSession?.session_id ? <Tag color="processing">进行中</Tag> : null}
            </div>

            {activeSession?.session_id ? (
              <div className="workspace-note-block">
                <div className="workspace-note-block__actions">
                  <Button type="primary" block onClick={() => navigate(`/chat/${activeSession.session_id}`)}>
                    继续当前会话
                  </Button>
                  <Button block onClick={() => navigate("/train/prepare")}>
                    重新配置
                  </Button>
                </div>
              </div>
            ) : (
              <div className="workspace-note-block">
                <div className="workspace-note-block__actions">
                  <Button type="primary" block onClick={() => navigate("/train/prepare")}>
                    进入训练配置
                  </Button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="workspace-panel workspace-panel--lined">
        <div className="workspace-panel__head">
          <Space>
            <TrophyOutlined />
            <strong>最近复盘</strong>
          </Space>
          <Button type="link" onClick={() => navigate("/training/records")}>
            全部
          </Button>
        </div>

        {recentRecords.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有训练记录。" />
        ) : (
          <div className="workspace-line-list">
            {recentRecords.map((item, idx) => {
              const tone = scoreTone(item.score);
              const score = Math.round(item.score || 0);
              return (
                <div
                  key={item.id}
                  className="workspace-line-item fade-in-up"
                  style={{ "--fade-delay": `${idx * 60}ms` }}
                >
                  <div className="workspace-line-item__icon">
                    <TrophyOutlined />
                  </div>
                  <div className="workspace-line-item__content">
                    <Space size={[8, 8]} wrap>
                      <Tag bordered={false} color="blue">{item.training_type}</Tag>
                      <Tag bordered={false}>{item.difficulty}</Tag>
                      <Tag bordered={false} color={resultColor(item.result)}>{item.result || "待定"}</Tag>
                    </Space>
                    <strong>
                      训练得分{" "}
                      <span style={{ color: tone.color, fontSize: 17, fontWeight: 700 }}>{score}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: tone.color, opacity: 0.78 }}>
                        {tone.label}
                      </span>
                    </strong>
                    <span>
                      <span style={{ color: "var(--accent-deep, #426f9f)" }}>
                        {item.customer_type || "未标记客户类型"}
                      </span>
                      <span style={{ margin: "0 8px", color: "var(--line, rgba(31,41,51,0.18))" }}>·</span>
                      {formatTime(item.created_at)}
                    </span>
                  </div>
                  <Button type="link" onClick={() => navigate(`/training/records/${item.id}`)}>
                    查看 <ArrowRightOutlined />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
