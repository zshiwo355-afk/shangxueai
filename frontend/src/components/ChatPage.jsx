import {
  ArrowLeftOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Modal, Space, Spin, App as AntdApp, Tag, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { finishExam } from "../lib/api.exam";
import { finishTraining, resetTraining, sendChat } from "../lib/api.training";
import { clearActiveSession, loadActiveSession, saveActiveSession } from "../lib/storage";
import BriefDrawer from "./BriefPanel";
import ChatComposer from "./ChatComposer";
import ChatMessage, { TypingIndicator } from "./ChatMessage";

const { Text, Title } = Typography;

const STAGE_LABELS = {
  opening: "开场破冰",
  need_probe: "需求探询",
  brand_trust: "品牌信任",
  product_intro: "产品介绍",
  price_discuss: "价格沟通",
  objection: "异议处理",
  closing: "促成成交",
  after_sale: "售后跟进",
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
      message.warning("当前会话已失效，请重新进入训练或考试。");
      navigate("/workspace/training", { replace: true });
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

  const state = active?.state || {
    round_count: 0,
    min_rounds: 10,
    current_stage: "opening",
    emotion_label: "平稳",
    can_finish: false,
  };

  const stageLabel = STAGE_LABELS[state.current_stage] || state.current_stage || "进行中";
  const sessionTitle = isExam ? "考试作答中" : "销售对练进行中";
  const sessionSubtitle = [active?.training_type, active?.difficulty, active?.customer_type]
    .filter(Boolean)
    .join(" · ");

  if (!active) return null;

  const persist = (next) => {
    setActive(next);
    saveActiveSession(next);
  };

  const handleSend = async (text) => {
    setSending(true);
    const snapshot = active;
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
    } catch (error) {
      persist(snapshot);
      message.error(error?.message || "发送失败。");
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
        const chatHistory = active.chat_history || [];
        clearActiveSession();
        navigate(`/review/${sid}`, { state: { review, chatHistory } });
      }
    } catch (error) {
      message.error(error?.message || "结束失败。");
    } finally {
      setFinishing(false);
    }
  };

  const handleFinish = () => {
    if (!state.can_finish) {
      modal.confirm({
        title: "尚未达到最少轮次",
        content: `当前 ${state.round_count || 0} 轮，未满 ${state.min_rounds || 10} 轮。${isExam ? "现在提交通常会影响考试结果。" : "现在结束会直接进入训练复盘。"} 是否继续？`,
        okText: isExam ? "继续提交" : "继续结束",
        cancelText: "再练几轮",
        onOk: doFinish,
      });
      return;
    }

    if (isExam) {
      modal.confirm({
        title: "确认提交考试？",
        content: "提交后将无法继续作答，系统会基于当前对话生成考试复盘和分数。",
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
        state: {
          ...active.state,
          round_count: 0,
          current_stage: "opening",
          emotion_label: "平稳",
          can_finish: false,
        },
      };
      persist(next);
      message.success("已重置到开场阶段。");
    } catch (error) {
      message.error(error?.message || "重置失败。");
    } finally {
      setResetting(false);
    }
  };

  const handleAbort = () => {
    Modal.confirm({
      title: isExam ? "返回销售对练？" : "退出当前训练？",
      content: isExam
        ? "退出后本次考试进度仍会保留，下次进入时可以继续作答。"
        : "退出后当前会话不会自动生成复盘，未提交内容将不会进入训练记录。",
      okText: isExam ? "返回工作台" : "确认退出",
      cancelText: "继续当前会话",
      onOk: () => {
        clearActiveSession();
        navigate("/workspace/training", { replace: true });
      },
    });
  };

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

  let overlayTip = "";
  if (finishing) overlayTip = isExam ? "AI 正在生成考试复盘…" : "AI 正在生成训练复盘…";
  else if (resetting) overlayTip = "正在重置当前训练…";

  return (
    <div className="chat-screen">
      <div className="chat-session-header">
        <div className="chat-session-header__main">
          <Button icon={<ArrowLeftOutlined />} onClick={handleAbort}>
            返回销售对练
          </Button>
          <div>
            <Space size={[8, 8]} wrap>
              <Title level={3} style={{ margin: 0 }}>{sessionTitle}</Title>
              {isExam ? <Tag color="error">考试模式</Tag> : <Tag color="blue">训练模式</Tag>}
            </Space>
            <Text type="secondary">
              {sessionSubtitle || "根据当前场景持续对话，直到完成训练目标。"}
            </Text>
          </div>
        </div>

        <div className="chat-session-header__actions">
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
            <Button icon={<EllipsisOutlined />} aria-label="更多操作" />
          </Dropdown>
        </div>
      </div>

      <div className="chat-topbar">
        <div className="chat-topbar__chips">
          <span className="chip chip--blue">
            <span className="chip__label">轮次</span>
            {state.round_count}/{state.min_rounds}
          </span>
          <span className="chip">{stageLabel}</span>
          <span className={`chip ${emotionTone(state.emotion_label)}`}>
            <span className="chip__label">情绪</span>
            {state.emotion_label || "平稳"}
          </span>
          {state.can_finish ? (
            <span className="chip chip--blue">已满足结束条件</span>
          ) : (
            <span className="chip chip--mute">未满 {state.min_rounds} 轮</span>
          )}
          {isFinished ? <span className="chip chip--gold">已结束</span> : null}
        </div>
      </div>

      <div className="chat-stream" ref={streamRef}>
        <div className="chat-stream__inner">
          {(active.chat_history || []).length === 0 ? (
            <div className="chat-empty-hint">客户即将开始对话…</div>
          ) : null}
          {(active.chat_history || []).map((entry, index) => (
            <ChatMessage key={index} role={entry.role} content={entry.content} />
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

      <Spin spinning={!!overlayTip} tip={overlayTip} fullscreen size="large" />
    </div>
  );
}
