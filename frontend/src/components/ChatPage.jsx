import {
  ArrowLeftOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Modal, Spin, App as AntdApp } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BriefDrawer from "./BriefPanel";
import ChatComposer from "./ChatComposer";
import ChatMessage, { TypingIndicator } from "./ChatMessage";
import { sendChat, finishTraining, resetTraining } from "../lib/api.training";
import { finishExam } from "../lib/api.exam";
import { clearActiveSession, loadActiveSession, saveActiveSession } from "../lib/storage";

const STAGE_LABELS = {
  opening: "开场",
  need_probe: "需求探询",
  brand_trust: "品牌信任",
  product_intro: "产品介绍",
  price_discuss: "价格洽谈",
  objection: "异议处理",
  closing: "促成",
  after_sale: "售后",
  finished: "已结束",
};

function emotionTone(label) {
  if (label === "急躁" || label === "戒备" || label === "抗价") return "chip--red";
  if (label === "倾向成交" || label === "感兴趣") return "chip--blue";
  return "chip--mute";
}

export default function ChatPage() {
  const { sid } = useParams();
  const navigate = useNavigate();
  const { message, modal } = AntdApp.useApp();

  const [active, setActive] = useState(() => {
    const cached = loadActiveSession();
    return cached && cached.session_id === sid ? cached : null;
  });
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!active) {
      message.warning("会话已失效，请重新开始。");
      navigate("/", { replace: true });
    }
  }, [active, message, navigate]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [active?.chat_history?.length, sending]);

  const isFinished = useMemo(
    () => active?.state?.current_stage === "finished" || active?.is_finished,
    [active],
  );

  const isExam = active?.mode === "exam";

  if (!active) return null;

  const persist = (next) => {
    setActive(next);
    saveActiveSession(next);
  };

  const handleSend = async (text) => {
    setSending(true);
    const optimistic = {
      ...active,
      chat_history: [...(active.chat_history || []), { role: "trainee", content: text }],
    };
    persist(optimistic);
    try {
      const data = await sendChat({ session_id: sid, message: text });
      const next = {
        ...optimistic,
        chat_history: [...optimistic.chat_history, { role: "customer", content: data.customer_reply }],
        state: data.state,
      };
      persist(next);
    } catch (err) {
      persist(active);
      message.error(err?.message || "发送失败。");
    } finally {
      setSending(false);
    }
  };

  const doFinish = async () => {
    setFinishing(true);
    try {
      if (isExam) {
        const result = await finishExam(active.exam_id);
        clearActiveSession();
        navigate(`/exam/${active.exam_id}/result`, { state: { result } });
      } else {
        const review = await finishTraining({ session_id: sid });
        // 把刚才的对话历史一并传给 ReviewPage（finish 接口本身不返回 chat_history）
        const chatHistory = active.chat_history || [];
        clearActiveSession();
        navigate(`/review/${sid}`, { state: { review, chatHistory } });
      }
    } catch (err) {
      message.error(err?.message || "结束失败。");
    } finally {
      setFinishing(false);
    }
  };

  const handleFinish = () => {
    if (!active.state?.can_finish) {
      modal.confirm({
        title: "尚未达到最少轮次",
        content: `当前 ${active.state?.round_count || 0} 轮，未满 ${active.state?.min_rounds || 10} 轮${isExam ? "提交将默认未通过" : "将默认未成交"}，是否继续？`,
        okText: isExam ? "继续提交" : "继续结束",
        cancelText: "再训练几轮",
        onOk: doFinish,
      });
      return;
    }
    if (isExam) {
      modal.confirm({
        title: "确认提交考试？",
        content: "提交后将无法继续答题，AI 将基于当前对话给出复盘与分数。",
        okText: "确认提交",
        cancelText: "再想想",
        onOk: doFinish,
      });
      return;
    }
    doFinish();
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetTraining({ session_id: sid });
      const next = {
        ...active,
        chat_history: active.first_customer_message
          ? [{ role: "customer", content: active.first_customer_message }]
          : [],
        state: { ...active.state, round_count: 0, current_stage: "opening", emotion_label: "平稳", can_finish: false },
      };
      persist(next);
      message.success("已重置到开场。");
    } catch (err) {
      message.error(err?.message || "重置失败。");
    } finally {
      setResetting(false);
    }
  };

  const handleAbort = () => {
    Modal.confirm({
      title: isExam ? "退出考试？" : "返回准备页？",
      content: isExam
        ? "退出后本次答题进度仍会保留，下次进入考试可继续。"
        : "当前会话将被丢弃。",
      okText: isExam ? "退出" : "确认返回",
      cancelText: "继续",
      onOk: () => {
        clearActiveSession();
        navigate("/home", { replace: true });
      },
    });
  };

  const state = active.state || { round_count: 0, min_rounds: 10, current_stage: "opening", emotion_label: "平稳", can_finish: false };
  const stageLabel = STAGE_LABELS[state.current_stage] || state.current_stage;

  // 三点菜单只放次要 / 训练专属操作（说明 / 重新开始）；
  // 结束训练已经升级成顶栏主按钮，不在此处重复。
  const menuItems = [
    {
      key: "brief",
      icon: <InfoCircleOutlined />,
      label: isExam ? "考试说明" : "训练说明",
      onClick: () => setBriefOpen(true),
    },
    !isExam && {
      key: "reset",
      icon: <ReloadOutlined />,
      label: "重新开始",
      disabled: isFinished || resetting,
      onClick: handleReset,
    },
  ].filter(Boolean);

  // 全屏加载提示文案
  let overlayTip = "";
  if (finishing) overlayTip = isExam ? "AI 正在生成考试复盘…" : "AI 正在生成训练复盘…";
  else if (resetting) overlayTip = "正在重置训练…";

  return (
    <div className="chat-screen">
      <div className="chat-topbar">
        <button className="chat-topbar__back" onClick={handleAbort} aria-label="返回">
          <ArrowLeftOutlined />
        </button>

        <div className="chat-topbar__chips">
          {isExam ? <span className="chip chip--red">考试中</span> : null}
          <span className="chip chip--blue">
            <span className="chip__label">第</span>
            {state.round_count}/{state.min_rounds}
            <span className="chip__label" style={{ marginLeft: 2 }}>轮</span>
          </span>
          <span className="chip">{stageLabel}</span>
          <span className={`chip ${emotionTone(state.emotion_label)}`}>
            <span className="chip__label">情绪</span>
            {state.emotion_label}
          </span>
          {state.can_finish ? (
            <span className="chip chip--blue">可{isExam ? "提交" : "结束"}</span>
          ) : (
            <span className="chip chip--mute">未达 {state.min_rounds} 轮</span>
          )}
          {isFinished ? <span className="chip chip--gold">已结束</span> : null}
        </div>

        <div className="chat-topbar__actions">
          <Button
            type="primary"
            danger={!isExam}
            icon={<StopOutlined />}
            loading={finishing}
            disabled={isFinished}
            onClick={handleFinish}
          >
            {isExam ? "提交考试" : "结束训练"}
          </Button>
          <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={["click"]}>
            <button className="chat-topbar__back" aria-label="菜单">
              <EllipsisOutlined style={{ fontSize: 18 }} />
            </button>
          </Dropdown>
        </div>
      </div>

      <div className="chat-stream" ref={streamRef}>
        <div className="chat-stream__inner">
          {(active.chat_history || []).length === 0 ? (
            <div className="chat-empty-hint">客户即将开口…</div>
          ) : null}
          {(active.chat_history || []).map((m, idx) => (
            <ChatMessage key={idx} role={m.role} content={m.content} />
          ))}
          {sending ? <TypingIndicator /> : null}
        </div>
      </div>

      <ChatComposer disabled={isFinished || finishing} sending={sending} onSend={handleSend} />

      <BriefDrawer
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
        brief={active.visible_brief}
        trainingType={active.training_type}
        difficulty={active.difficulty}
        customerType={active.customer_type}
      />

      {/* 全屏 loading：finish / reset 时让用户清楚 AI 正在工作 */}
      <Spin spinning={!!overlayTip} tip={overlayTip} fullscreen size="large" />
    </div>
  );
}
