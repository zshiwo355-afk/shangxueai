import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  RocketOutlined,
  BookOutlined,
  FormOutlined,
  TeamOutlined,
  ArrowRightOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { completeGuide } from "../lib/api.guide";
import { getCurrentUser, setCurrentUser } from "../lib/auth";

const GUIDE_STEPS = [
  {
    route: "/home",
    selector: '[data-guide="nav-training"]',
    title: "销售对练",
    desc: "点击这里进入销售对练。AI 会模拟真实客户和你对话，帮你反复练习提升话术能力。每次练习后会获得评分和改进建议。",
    icon: <RocketOutlined />,
    position: "bottom",
  },
  {
    route: "/workspace/training",
    selector: ".showcase-hero__actions",
    title: "开始训练",
    desc: "这是销售对练的工作台。点击「开始新对练」选择场景即可开始 AI 模拟对话，也可以查看历史记录回顾过往表现。",
    icon: <RocketOutlined />,
    position: "bottom",
  },
  {
    route: "/workspace/magic",
    selector: ".showcase-hero__actions",
    title: "课程学习",
    desc: "这是课程管理中心。在这里你可以观看视频课程、完成节点答题，系统会追踪你的学习进度。读书打卡和导师专区也在这个模块内。",
    icon: <BookOutlined />,
    position: "bottom",
  },
  {
    route: "/papers",
    selector: ".showcase-hero__actions",
    title: "考试中心",
    desc: "这是考试中心。管理员安排的阶段考试会出现在这里，支持单选、多选、判断等题型。完成后可以查看成绩和答案解析。",
    icon: <FormOutlined />,
    position: "bottom",
  },
  {
    route: "/home",
    selector: '[data-guide="mentor-section"]',
    title: "导师专区",
    desc: "页面下方展示了公司的资深导师。你可以了解每位导师的专长，遇到问题时寻求对应领域导师的指导和建议。",
    icon: <TeamOutlined />,
    position: "top",
  },
];

function markComplete() {
  completeGuide().catch(() => {});
  const user = getCurrentUser();
  if (user) {
    user.guide_completed_at = new Date().toISOString();
    setCurrentUser(user);
  }
}

export default function NewbieGuide({ active, onFinish }) {
  const [step, setStep] = useState(0);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [spotlightStyle, setSpotlightStyle] = useState({});
  const [visible, setVisible] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const rafRef = useRef(null);
  const retriesRef = useRef(0);

  const currentStep = GUIDE_STEPS[step];

  const positionTooltip = useCallback(() => {
    if (!currentStep) return false;
    const el = document.querySelector(currentStep.selector);
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    setSpotlightStyle({
      top: rect.top + scrollY - 8,
      left: rect.left + scrollX - 8,
      width: rect.width + 16,
      height: rect.height + 16,
    });

    const pos = currentStep.position || "bottom";
    if (pos === "bottom") {
      setTooltipStyle({
        top: rect.bottom + scrollY + 16,
        left: rect.left + scrollX + rect.width / 2,
        transform: "translateX(-50%)",
      });
    } else {
      setTooltipStyle({
        top: rect.top + scrollY - 16,
        left: rect.left + scrollX + rect.width / 2,
        transform: "translateX(-50%) translateY(-100%)",
      });
    }
    return true;
  }, [currentStep]);

  useEffect(() => {
    if (!active || !currentStep) return;

    if (location.pathname !== currentStep.route) {
      navigate(currentStep.route);
      return;
    }

    retriesRef.current = 0;

    const tryPosition = () => {
      const found = positionTooltip();
      if (found) {
        setFallback(false);
        const el = document.querySelector(currentStep.selector);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          positionTooltip();
          setVisible(true);
          setTransitioning(false);
        }, 350);
      } else {
        retriesRef.current++;
        if (retriesRef.current >= 15) {
          setFallback(true);
          setVisible(true);
          setTransitioning(false);
        } else {
          rafRef.current = setTimeout(tryPosition, 120);
        }
      }
    };

    setVisible(false);
    const timer = setTimeout(tryPosition, 300);

    const handleReposition = () => positionTooltip();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition);

    return () => {
      clearTimeout(timer);
      if (rafRef.current) clearTimeout(rafRef.current);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition);
    };
  }, [active, step, location.pathname, currentStep, navigate, positionTooltip]);

  if (!active || !currentStep) return null;

  const handleNext = () => {
    if (step < GUIDE_STEPS.length - 1) {
      setTransitioning(true);
      setVisible(false);
      setTimeout(() => setStep(step + 1), 300);
    } else {
      setTransitioning(true);
      setVisible(false);
      setTimeout(() => {
        markComplete();
        onFinish();
      }, 300);
    }
  };

  const handleSkip = () => {
    setTransitioning(true);
    setVisible(false);
    setTimeout(() => {
      markComplete();
      onFinish();
    }, 250);
  };

  const isLast = step === GUIDE_STEPS.length - 1;

  const tooltipContent = (
    <>
      <div className="guide-tour__tooltip-header">
        <span className="guide-tour__tooltip-icon">{currentStep.icon}</span>
        <strong className="guide-tour__tooltip-title">{currentStep.title}</strong>
        <button
          type="button"
          className="guide-tour__tooltip-close"
          onClick={handleSkip}
          aria-label="关闭引导"
        >
          <CloseOutlined />
        </button>
      </div>
      <p className="guide-tour__tooltip-desc">{currentStep.desc}</p>
      <div className="guide-tour__tooltip-footer">
        <span className="guide-tour__tooltip-progress">
          {step + 1} / {GUIDE_STEPS.length}
        </span>
        <button
          type="button"
          className="guide-tour__tooltip-btn"
          onClick={handleNext}
        >
          {isLast ? "完成引导" : "下一步"} <ArrowRightOutlined />
        </button>
      </div>
    </>
  );

  return (
    <div className={`guide-tour ${transitioning ? "guide-tour--out" : ""}`} aria-live="polite">
      <div className={`guide-tour__overlay ${visible ? "guide-tour__overlay--visible" : ""}`} />

      {visible && !fallback && (
        <>
          <div className="guide-tour__spotlight" style={spotlightStyle} />
          <div className="guide-tour__tooltip" style={tooltipStyle}>
            {tooltipContent}
          </div>
        </>
      )}

      {visible && fallback && (
        <div className="guide-tour__fallback">
          <div className="guide-tour__tooltip guide-tour__tooltip--center">
            {tooltipContent}
          </div>
        </div>
      )}
    </div>
  );
}
