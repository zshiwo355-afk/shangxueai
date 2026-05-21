import {
  ArrowLeftOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Dropdown, Modal, Space, Spin, Tag, Typography } from "antd";
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
  opening: "开场",
  need_probe: "探需",
  brand_trust: "建信任",
  product_intro: "讲产品",
  price_discuss: "谈价格",
  objection: "处理异议",
  closing: "促成交",
  after_sale: "跟进",
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
      message.warning("当前会话已失效，请重新进入。");
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
    current_stage: "opening",
    emotion_label: "平稳",
    can_finish: true,
  };

  const stageLabel = STAGE_LABELS[state.current_stage] || state.current_stage || "进行中";
  const sessionTitle = isExam ? "考试中" : "训练中";
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
      message.error(error?.message || "操作失败。");
    } finally {
      setFinishing(false);
    }
  };

  const handleFinish = () => {
    modal.confirm({
      title: isExam ? "提交考试？" : "结束训练？",
      content: isExam ? "提交后生成结果。" : "结束后生成复盘。",
      okText: isExam ? "提交" : "结束",
      cancelText: "继续",
      onOk: doFinish,
    });
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
          can_finish: true,
        },
      };
      persist(next);
      message.success("已重置。");
    } catch (error) {
      message.error(error?.message || "重置失败。");
    } finally {
      setResetting(false);
    }
  };

  const handleAbort = () => {
    Modal.confirm({
      title: "返回工作台？",
      content: isExam ? "当前进度会保留。" : "未结束前不会生成复盘。",
      okText: "返回",
      cancelText: "继续",
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
  if (finishing) overlayTip = isExam ? "提交中..." : "生成复盘中...";
  else if (resetting) overlayTip = "重置中...";

  return (
    <div className="chat-screen chat-screen--minimal">
      <div className="chat-session-header chat-session-header--minimal">
        <div className="chat-session-header__main">
          <Button icon={<ArrowLeftOutlined />} onClick={handleAbort}>
            销售对练
          </Button>
          <div>
            <Space size={[8, 8]} wrap>
              <Title level={3} style={{ margin: 0 }}>
                {sessionTitle}
              </Title>
              {isExam ? <Tag color="error">考试</Tag> : <Tag color="blue">训练</Tag>}
            </Space>
            <Text type="secondary">{sessionSubtitle || "继续对话"}</Text>
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

      <div className="chat-topbar chat-topbar--minimal">
        <div className="chat-topbar__chips">
          <span className="chip chip--blue">
            <span className="chip__label">轮次</span>
            {state.round_count}
          </span>
          <span className="chip">{stageLabel}</span>
          <span className={`chip ${emotionTone(state.emotion_label)}`}>
            <span className="chip__label">情绪</span>
            {state.emotion_label || "平稳"}
          </span>
          {isFinished ? <span className="chip chip--gold">已结束</span> : null}
        </div>
      </div>

      <div className="chat-stream" ref={streamRef}>
        <div className="chat-stream__inner">
          {(active.chat_history || []).length === 0 ? (
            <div className="chat-empty-hint">客户即将开始对话...</div>
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
