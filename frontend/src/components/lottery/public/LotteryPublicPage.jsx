import {
  ClockCircleOutlined,
  GiftFilled,
  HistoryOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TrophyFilled,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Empty,
  Modal,
  Skeleton,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  drawPublicLottery,
  getPublicLottery,
  getPublicLotteryShareConfig,
} from "../../../lib/api.lottery";
import {
  asNumber,
  createPendingDrawTracker,
  findConfirmedPendingDraw,
  getCampaignState,
  getNextLotteryRefreshDelay,
  getPublicPrizeDisplay,
  getRedemptionDisplayState,
  getWheelTargetRotation,
  isAmbiguousDrawError,
  mergeDrawSnapshot,
  normalizeLottery,
} from "./lottery-public-utils";
import LotteryPublicHistory from "./LotteryPublicHistory";
import LotteryCampaignHero from "./LotteryCampaignHero";
import PrizeImage from "./LotteryPrizeImage";
import LotteryPrizeCarousel from "./LotteryPrizeCarousel";
import LotteryWinningSummary from "./LotteryWinningSummary";
import LotteryWinnersFeed from "./LotteryWinnersFeed";
import { prepareCardSdk } from "../lottery-share-utils";
import { getWheelPrizeLabelStyle, hasSameWheelPrizeOrder } from "./lottery-wheel-layout";
import { getWheelMotion } from "./lottery-wheel-motion";
import "./lottery-public.css";
import "./lottery-wheel.css";

const { Paragraph, Text, Title } = Typography;
const WECHAT_SDK_SRC = "https://res.wx.qq.com/open/js/jweixin-1.6.0.js";
const SECTOR_COLORS = ["#fffcf5", "#f2e4ce"];
let wechatSdkPromise = null;

function createRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (window.crypto?.getRandomValues) {
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    return `draw_${Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("")}`;
  }
  return `draw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function ensureMeta(name, value, isProperty = false) {
  if (!value) return;
  const selector = isProperty ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let node = document.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(isProperty ? "property" : "name", name);
    document.head.appendChild(node);
  }
  node.setAttribute("content", value);
}

function isWxWorkBrowser() {
  return /wxwork/i.test(window.navigator?.userAgent || "");
}

function isWechatBrowser() {
  return /MicroMessenger/i.test(window.navigator?.userAgent || "");
}

function loadWechatSdk() {
  if (window.wx) return Promise.resolve(window.wx);
  if (wechatSdkPromise) return wechatSdkPromise;
  wechatSdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${WECHAT_SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.wx), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = WECHAT_SDK_SRC;
    script.async = true;
    script.onload = () => resolve(window.wx);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return wechatSdkPromise;
}

function showWechatShareMenu() {
  // The public wheel is also the sales scan destination. Viewing or forwarding
  // it does not draw; the server still enforces one draw per customer link.
  try { window.WeixinJSBridge?.call?.("showOptionMenu"); } catch { /* Bridge may arrive later. */ }
}

function PrizeWheel({ prizes, rotation, motion, spinning, disabled, onDraw, buttonLabel }) {
  const count = Math.max(prizes.length, 1);
  const segment = 360 / count;
  const gradient = prizes.length
    ? `conic-gradient(${prizes.map((_, index) => {
      const start = index * segment;
      const end = (index + 1) * segment;
      return `${SECTOR_COLORS[index % SECTOR_COLORS.length]} ${start}deg ${end}deg`;
    }).join(", ")})`
    : "#f4ead8";

  return (
    <div className="lottery-wheel-stage" style={motion.style}>
      <div className="lottery-wheel-pointer" aria-hidden="true"><span /></div>
      <div className="lottery-wheel-frame">
        <div
          className={`lottery-wheel${spinning ? " is-spinning" : ""}${prizes.length >= 10 ? " is-dense" : ""}`}
          style={{ background: gradient, transform: `rotate(${rotation}deg)` }}
          role="img"
          aria-label={`幸运转盘，共 ${prizes.length} 个奖项`}
        >
          <div className="lottery-wheel__lines" aria-hidden="true">
            {prizes.map((prize, index) => (
              <i key={prize.id ?? index} style={{ transform: `rotate(${index * segment}deg)` }} />
            ))}
          </div>
          {prizes.map((prize, index) => {
            return (
              <div
                className="lottery-wheel__label"
                style={getWheelPrizeLabelStyle(index, count, rotation)}
                key={prize.id ?? index}
                title={prize.name || "神秘好礼"}
              >
                <PrizeImage prize={prize} compact />
                <span>{prize.name || "神秘好礼"}</span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="lottery-wheel-button"
          disabled={disabled || spinning}
          onClick={onDraw}
          aria-label={spinning ? "正在抽奖" : buttonLabel}
        >
          <span>{spinning ? "好运\n揭晓中" : buttonLabel}</span>
        </button>
      </div>
    </div>
  );
}

function ResultModal({ open, draw, campaignTitle, onClose }) {
  const won = draw?.result_type === "win" || (draw?.prize_id && draw?.result_type !== "no_win");

  return (
    <Modal
      open={open}
      footer={null}
      centered
      width={420}
      rootClassName="lottery-result-modal"
      onCancel={onClose}
      maskClosable
      closable
      destroyOnHidden
    >
      <div className={`lottery-result${won ? " is-win" : " is-empty"}`}>
        <div className="lottery-result__halo" aria-hidden="true" />
        <div className="lottery-result__icon">
          {won ? <TrophyFilled /> : <HistoryOutlined />}
        </div>
        <Text className="lottery-result__eyebrow">{campaignTitle || "双十一幸运时刻"}</Text>
        <Title level={2}>{won ? "恭喜中奖" : "历史抽奖记录"}</Title>
        {won ? (
          <div className="lottery-result__prize">
            <PrizeImage prize={{ image_url: draw?.prize_image_url }} />
            <strong>{draw?.prize_name || "幸运好礼"}</strong>
          </div>
        ) : (
          <Paragraph>本次为历史未中奖记录，结果保持原样。</Paragraph>
        )}

        {won ? <Paragraph className="lottery-result__tip">请截图中奖信息，联系销售人员兑奖。</Paragraph> : null}
        <Button type="primary" size="large" block onClick={onClose}>我知道了</Button>
      </div>
    </Modal>
  );
}

function LoadingPage() {
  return (
    <div className="lottery-public-page lottery-public-page--loading">
      <main className="lottery-public-shell">
        <Skeleton active paragraph={{ rows: 2 }} />
        <div className="lottery-loading-wheel" />
        <Skeleton active title={false} paragraph={{ rows: 3 }} />
      </main>
    </div>
  );
}

export default function LotteryPublicPage() {
  const { code } = useParams();
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lottery, setLottery] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [wheelMotion, setWheelMotion] = useState(() => getWheelMotion());
  const [result, setResult] = useState(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [pendingRequest, setPendingRequest] = useState(null);
  const [redemptionOpen, setRedemptionOpen] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyReset, setHistoryReset] = useState(0);
  const rotationRef = useRef(0);
  const resultTimerRef = useRef(0);
  const lotteryRef = useRef(null);
  const spinningRef = useRef(false);
  const lifecycleRef = useRef(0);
  const loadVersionRef = useRef(0);
  const loadControllerRef = useRef(null);
  const pendingDrawsRef = useRef(null);
  if (!pendingDrawsRef.current) pendingDrawsRef.current = createPendingDrawTracker(createRequestId);

  const load = useCallback(async ({ initial = false, manual = false } = {}) => {
    if (!code || spinningRef.current) return;
    const lifecycle = lifecycleRef.current;
    const version = ++loadVersionRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setNow(Date.now());
    if (initial) {
      setLoading(true);
      setError("");
    }
    setRefreshing(manual);
    try {
      const data = normalizeLottery(await getPublicLottery(code, { signal: controller.signal }));
      if (lifecycle !== lifecycleRef.current || version !== loadVersionRef.current) return;
      lotteryRef.current = data;
      setLottery(data);
      setNow(Date.now());
      setError("");
      setSyncError("");
      if (manual) setHistoryRefresh((value) => value + 1);
      // Refresh only reads history. It never silently submits another draw.
      const pending = pendingDrawsRef.current.peek(code);
      const confirmed = findConfirmedPendingDraw(data, pending);
      if (confirmed) {
        pendingDrawsRef.current.clear(code, pending.requestId);
        setPendingRequest(null);
        setResult(confirmed);
        setResultOpen(true);
        setHistoryReset((value) => value + 1);
      }
      return data;
    } catch (err) {
      if (lifecycle !== lifecycleRef.current || version !== loadVersionRef.current || err?.code === "REQUEST_ABORTED") return;
      const detail = err?.status === 404 ? "这张抽奖卡不存在或已失效。" : (err?.message || "抽奖活动加载失败。");
      if (initial || err?.status === 404 || !lotteryRef.current) setError(detail);
      else setSyncError(detail);
    } finally {
      if (lifecycle === lifecycleRef.current && version === loadVersionRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [code]);

  useEffect(() => {
    lifecycleRef.current += 1;
    lotteryRef.current = null;
    spinningRef.current = false;
    rotationRef.current = 0;
    setLottery(null);
    setSpinning(false);
    setRedemptionOpen(false);
    setRotation(0);
    setResultOpen(false);
    setPendingRequest(pendingDrawsRef.current.peek(code) || null);
    setSyncError("");
    load({ initial: true });
    return () => {
      lifecycleRef.current += 1;
      loadControllerRef.current?.abort();
      window.clearTimeout(resultTimerRef.current);
    };
  }, [load]);

  useEffect(() => {
    let timer;
    let active = true;
    const schedule = () => {
      if (!active) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (document.visibilityState !== "hidden" && !spinningRef.current) await load();
        schedule();
      }, getNextLotteryRefreshDelay(lotteryRef.current, Date.now()));
    };
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden" && !spinningRef.current) load();
    };
    schedule();
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load, lottery?.campaign?.start_at, lottery?.campaign?.end_at, lottery?.link?.expires_at]);

  useEffect(() => {
    if (!lottery) return;
    const share = lottery.share;
    document.title = share.title || lottery.campaign.title || "双十一幸运转盘";
    ensureMeta("description", share.description || lottery.campaign.description || "打开专属抽奖卡，看看今天的好运是什么。");
    ensureMeta("og:title", share.title || lottery.campaign.title, true);
    ensureMeta("og:description", share.description || lottery.campaign.description, true);
    ensureMeta("og:image", share.image || lottery.campaign.share_image_url || lottery.campaign.hero_image_url, true);
  }, [lottery]);

  useEffect(() => {
    if (!isWechatBrowser()) return undefined;
    showWechatShareMenu();
    document.addEventListener("WeixinJSBridgeReady", showWechatShareMenu);
    return () => document.removeEventListener("WeixinJSBridgeReady", showWechatShareMenu);
  }, []);

  const hasLottery = Boolean(lottery);
  useEffect(() => {
    if (!code || !hasLottery || !isWechatBrowser() || isWxWorkBrowser()) return undefined;
    let active = true;
    const url = window.location.href.split("#", 1)[0];
    getPublicLotteryShareConfig(code, url)
      .then(async (config) => {
        if (!active) return;
        const sdk = config?.wechat_sdk;
        if (!sdk?.enabled) return;
        const wx = await loadWechatSdk();
        if (active) await prepareCardSdk(wx, sdk, config.share, "wechat");
      })
      .catch(() => {});
    return () => { active = false; };
  }, [code, hasLottery]);

  const campaignState = useMemo(() => getCampaignState(lottery, now), [lottery, now]);
  const campaign = lottery?.campaign || {};
  const link = lottery?.link || {};
  const prizes = getPublicPrizeDisplay(lottery?.prizes);
  const remaining = asNumber(link.remaining_chances);
  const canDraw = !spinning && (Boolean(pendingRequest) || (campaignState.key === "active" && prizes.length > 0));
  const inactiveLabels = { exhausted: "已抽完", not_started: "待开始", paused: "已暂停", ended: "已结束", link_expired: "已过期", link_disabled: "已停用" };
  const buttonLabel = pendingRequest ? "确认\n结果" : campaignState.key === "active" ? prizes.length ? "立即\n抽奖" : "准备中" : inactiveLabels[campaignState.key] || "暂不可用";
  const redemptionMode = getRedemptionDisplayState(lottery, { spinning, resultOpen, pendingRequest });

  useEffect(() => {
    if (remaining > 0) {
      setRedemptionOpen(false);
    }
  }, [remaining]);

  const handleResultClose = () => {
    // The result already contains redemption instructions. Closing it must not
    // open a second prompt; the complete winning summary remains on the page.
    setResultOpen(false);
  };

  const handleDraw = async () => {
    if (!canDraw || spinningRef.current) return;
    // A synchronous guard also covers a second click before React rerenders.
    spinningRef.current = true;
    setSpinning(true);
    const lifecycle = lifecycleRef.current;
    ++loadVersionRef.current;
    loadControllerRef.current?.abort();
    setRefreshing(false);
    const alreadyUncertain = Boolean(pendingDrawsRef.current.peek(code));
    const pending = pendingDrawsRef.current.getOrCreate(code, lotteryRef.current?.link.chance_used);
    try {
      const response = await drawPublicLottery(code, pending.requestId, pending.expectedSequence);
      if (lifecycle !== lifecycleRef.current) return;
      const draw = response?.draw || response;
      if (!draw?.id) throw new Error("抽奖结果返回异常，请刷新后查看记录。");
      const snapshot = mergeDrawSnapshot(lotteryRef.current, response, draw);
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const nextPrizes = getPublicPrizeDisplay(snapshot.prizes);
      // If live admin edits changed sectors, do not animate between incompatible
      // wheel layouts. New labels would have no initial counter-rotation frame.
      const nextRotation = hasSameWheelPrizeOrder(getPublicPrizeDisplay(lotteryRef.current?.prizes), nextPrizes)
        ? getWheelTargetRotation(nextPrizes, draw, rotationRef.current, prefersReducedMotion)
        : null;
      pendingDrawsRef.current.clear(code, pending.requestId);
      setPendingRequest(null);
      setSyncError("");
      lotteryRef.current = snapshot;
      setLottery(snapshot);
      setNow(Date.now());

      setResult(draw);
      setHistoryReset((value) => value + 1);
      if (nextRotation === null || response.idempotent) {
        spinningRef.current = false;
        setSpinning(false);
        setResultOpen(true);
        return;
      }
      rotationRef.current = nextRotation;
      const motion = getWheelMotion(prefersReducedMotion);
      setWheelMotion(motion);
      setRotation(nextRotation);
      resultTimerRef.current = window.setTimeout(() => {
        if (lifecycle !== lifecycleRef.current) return;
        spinningRef.current = false;
        setSpinning(false);
        setResultOpen(true);
      }, motion.revealDelayMs);
    } catch (err) {
      if (lifecycle !== lifecycleRef.current) return;
      spinningRef.current = false;
      setSpinning(false);
      const ambiguous = isAmbiguousDrawError(err, alreadyUncertain);
      if (ambiguous) {
        setPendingRequest(pending);
      } else {
        pendingDrawsRef.current.clear(code, pending.requestId);
        setPendingRequest(null);
      }
      const refreshed = await load();
      if (lifecycle !== lifecycleRef.current) return;
      if (!findConfirmedPendingDraw(refreshed, pending)) {
        if (ambiguous) message.warning("结果尚未确认，请刷新记录或点击确认结果；不会重复扣除本次机会。");
        else message.error(err?.message || "抽奖失败，请稍后重试。");
      }
    }
  };

  if (loading) return <LoadingPage />;

  if (error || !lottery) {
    return (
      <div className="lottery-public-page lottery-public-page--center">
        <div className="lottery-error-card">
          <div className="lottery-error-card__mark"><GiftFilled /></div>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error || "抽奖活动暂不可访问"} />
          <Button icon={<ReloadOutlined />} onClick={() => load({ initial: true })}>重新加载</Button>
        </div>
      </div>
    );
  }

  // Do not announce completion or shift the wheel down while it is still moving.
  const activeNotice = !spinning && campaignState.key !== "active" ? campaignState : null;
  return (
    <div className="lottery-public-page">
      <main className="lottery-public-shell">
        <LotteryWinnersFeed key={code} code={code} busy={spinning} refreshVersion={`${historyRefresh}:${historyReset}`} />
        <header className="lottery-hero">
          <LotteryCampaignHero campaign={campaign} customerName={link.customer_name} />
        </header>

        <section className="lottery-chance-card" aria-label="抽奖机会">
          <div>
            <span>专属抽奖机会</span>
            <strong>{remaining}</strong>
            <span>次</span>
          </div>
          <p>每个专属链接仅可抽 {link.chance_limit} 次<br />{remaining > 0 ? "一份专属好礼，等您开启" : "中奖信息已保存，请截图联系销售兑奖"}</p>
        </section>

        <div className="lottery-sync-controls">
          <span>次数与记录以服务器为准</span>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            loading={refreshing}
            disabled={spinning}
            onClick={() => load({ manual: true })}
          >刷新记录</Button>
        </div>

        {pendingRequest ? (
          <Alert
            className="lottery-status-alert"
            type="warning"
            showIcon
            message="上次抽奖结果待确认"
            description="可刷新记录或点击转盘确认上次结果，系统会核对同一次抽奖，不会因此多扣一次机会。"
          />
        ) : syncError ? (
          <Alert
            className="lottery-status-alert"
            type="warning"
            showIcon
            message="最新状态暂未同步"
            description="当前显示上次记录，请检查网络后刷新。抽奖次数和结果仍以服务器为准。"
          />
        ) : null}

        {activeNotice ? (
          <Alert
            className="lottery-status-alert"
            type={campaignState.key === "exhausted" ? "info" : "warning"}
            showIcon
            icon={<ClockCircleOutlined />}
            message={campaignState.title}
            description={campaignState.detail}
          />
        ) : null}

        <div className="lottery-draw-layout"><section className="lottery-wheel-section">
          <div className="lottery-ribbon"><span /><strong>转动你的幸运时刻</strong><span /></div>
          <PrizeWheel
            prizes={prizes}
            rotation={rotation}
            motion={wheelMotion}
            spinning={spinning}
            disabled={!canDraw}
            onDraw={handleDraw}
            buttonLabel={buttonLabel}
          />
          <div className="lottery-wheel-hint">
            <SafetyCertificateOutlined />
            {spinning ? "抽奖结果生成中，请不要关闭页面" : "每次抽奖由服务端即时开奖，结果真实记录"}
          </div>
        </section></div>

        <LotteryPrizeCarousel prizes={prizes} />

        <LotteryWinningSummary
          mode={redemptionMode}
          summary={lottery.winning_summary}
          campaignTitle={campaign.title}
          customerName={link.customer_name}
          open={redemptionOpen}
          onOpen={() => setRedemptionOpen(true)}
          onClose={() => setRedemptionOpen(false)}
          onRefresh={() => load({ manual: true })}
          refreshing={refreshing}
        />

        <LotteryPublicHistory key={code} code={code} busy={spinning} latestDrawSequence={`${link.chance_used}:${historyReset}`} refreshVersion={historyRefresh} />

        <section className="lottery-rules-card">
          <div className="lottery-section-heading"><div><SafetyCertificateOutlined /><span>活动说明</span></div></div>
          <div className="lottery-rules-copy">
            {(campaign.rules_text || "每个专属链接仅可抽奖一次，中奖结果由系统自动记录。抽奖后请截图中奖信息，联系销售人员兑奖，无需填写收货信息。中奖动态仅展示脱敏称呼及奖品。")
              .split("\n")
              .filter(Boolean)
              .map((line, index) => <p key={index}><i>{index + 1}</i><span>{line}</span></p>)}
          </div>
        </section>

        <footer className="lottery-footer">
          <p>理性饮酒 · 未满 18 周岁请勿饮酒</p>
          <span>专属抽奖链接仅限本人使用，请勿转发</span>
        </footer>
      </main>

      <ResultModal
        open={resultOpen}
        draw={result}
        campaignTitle={campaign.title}
        onClose={handleResultClose}
      />
    </div>
  );
}
