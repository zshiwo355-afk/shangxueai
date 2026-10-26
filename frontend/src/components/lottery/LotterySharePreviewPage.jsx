import { ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Skeleton, Tag } from "antd";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { resolveLotterySharePreview } from "../../lib/api.lottery.share";
import { customerCardPayload, singleDrawShareRemaining } from "./lottery-share-utils";
import "./lottery-share-preview.css";

const SHARE_MENU_ITEMS = ["menuItem:share:appMessage", "menuItem:share:timeline", "menuItem:share:qq", "menuItem:share:weiboApp", "menuItem:copyUrl"];

function hideShareMenu() {
  // This legacy entry carries an employee credential. It is never shareable;
  // native forwarding is enabled only in the destination's new public document.
  try { window.WeixinJSBridge?.call?.("hideOptionMenu"); } catch { /* Older clients may not expose the bridge yet. */ }
  try { window.wx?.hideOptionMenu?.(); } catch { /* Keep the bridge fallback active. */ }
  try { window.wx?.hideMenuItems?.({ menuList: SHARE_MENU_ITEMS }); } catch { /* SDK may not be configured yet. */ }
}

function readTicket() {
  const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket") || "";
  return ticket.length <= 8192 ? ticket : "";
}

function takeInitialTicket() {
  const captured = window.__lotteryShareBootstrap?.take?.(window.location.pathname) || "";
  return captured || readTicket();
}

function releasePreviewBootstrap() {
  window.__lotteryShareBootstrap?.release?.();
}

function expiryMillis(value) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  return Date.parse(value || "");
}

function validatedPublicDestination(data, code, origin, now = Date.now()) {
  singleDrawShareRemaining(data?.remaining_chances);
  const deadline = expiryMillis(data?.expires_at);
  if (!Number.isFinite(deadline) || deadline <= now) {
    const error = new Error("员工分享入口已过期，请返回员工端打开新的分享入口。");
    error.status = 410;
    throw error;
  }
  if (typeof data?.customer_name !== "string" || !data.customer_name.trim()) {
    throw new Error("未能确认专属客户，请返回员工端重新打开。");
  }
  const card = customerCardPayload(data?.share);
  const destination = new URL(card.link);
  if (destination.origin !== origin || destination.username || destination.password
    || !/^\/share\/lottery\/[^/]+$/.test(destination.pathname)
    || (code && destination.pathname !== `/share/lottery/${encodeURIComponent(code)}`)) {
    throw new Error("客户卡片地址不匹配，请返回员工端重新打开。");
  }
  return destination.href;
}

export default function LotterySharePreviewPage() {
  const { code } = useParams();
  const [ticket, setTicket] = useState(takeInitialTicket);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const versionRef = useRef(0);

  // Keep the early HTML guard until this credential document actually leaves.
  useEffect(() => () => releasePreviewBootstrap(), []);

  useLayoutEffect(() => {
    const consumeHash = (event) => {
      hideShareMenu();
      if (window.location.hash) {
        // Invalidate in-flight responses immediately, before React rerenders.
        versionRef.current += 1;
        const next = readTicket();
        setTicket(next);
        if (event?.type === "hashchange") setAttempt((value) => value + 1);
        // The credential survives only in memory, never in the public URL.
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      }
    };
    consumeHash();
    if (!ticket && code) window.location.replace(`/share/lottery/${encodeURIComponent(code)}`);
    document.addEventListener("WeixinJSBridgeReady", hideShareMenu);
    window.addEventListener("hashchange", consumeHash);
    return () => {
      hideShareMenu();
      document.removeEventListener("WeixinJSBridgeReady", hideShareMenu);
      window.removeEventListener("hashchange", consumeHash);
    };
  }, [code, ticket]);

  useEffect(() => {
    const version = ++versionRef.current;
    let active = true;
    hideShareMenu();
    setLoading(true);
    setError("");
    setExpired(false);

    const load = async () => {
      if (!ticket) {
        if (code) return;
        setError("此分享入口缺少客户信息，请返回员工端重新打开。");
        setLoading(false);
        return;
      }
      try {
        const data = await resolveLotterySharePreview(ticket, window.location.href.split("#")[0]);
        if (!active || version !== versionRef.current) return;
        const destination = validatedPublicDestination(data, code, window.location.origin);
        // A full navigation is deliberate: the public page has no employee
        // credential, and its native forwarding menu belongs to that new page.
        window.location.replace(destination);
      } catch (err) {
        if (!active || version !== versionRef.current) return;
        hideShareMenu();
        setExpired(err?.status === 410);
        setError(err?.message || "分享入口暂时无法加载，请重试。");
        setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      hideShareMenu();
    };
  }, [ticket, attempt, code]);

  return (
    <div className="lottery-share-preview-page">
      <main className="lottery-share-preview">
        <header className="lottery-share-preview__header">
          <Tag icon={<SafetyCertificateOutlined />}>分享入口核验</Tag>
          <h1>{loading ? "正在打开客户卡片" : "分享入口暂不可用"}</h1>
          <p>{loading ? "正在核对专属客户与一次抽奖规则，不会消耗抽奖机会。" : "请重试核验，或返回员工端重新打开分享入口。"}</p>
        </header>
        <div className="lottery-share-preview__surface">
          {loading ? <Skeleton active paragraph={{ rows: 2 }} /> : (
            <>
              <Alert type={expired ? "warning" : "error"} showIcon message={expired ? "员工分享入口已过期或失效" : "分享入口不可用"} description={error} />
              {ticket ? <Button icon={<ReloadOutlined />} onClick={() => setAttempt((value) => value + 1)}>重新核验</Button> : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
