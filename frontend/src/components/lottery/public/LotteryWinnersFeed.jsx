import { PauseOutlined, PlayCircleOutlined, SoundOutlined, UserOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import { getPublicLotteryWinners } from "../../../lib/api.lottery";
import { normalizePublicWinners, shouldRefreshPublicWinners } from "./lottery-public-utils";
import { shouldAnimateWinnerBanner, winnerBannerDuration } from "./lottery-winner-banner-utils";
import "./lottery-winners-ticker.css";

export default function LotteryWinnersFeed({ code, refreshVersion = 0, busy = false }) {
  const [items, setItems] = useState([]);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [duration, setDuration] = useState(12);
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const [reducedMotion, setReducedMotion] = useState(() => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches));
  const requestRef = useRef(0);
  const controllerRef = useRef(null);
  const viewportRef = useRef(null);
  const groupRef = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const signature = JSON.stringify(items);

  const load = useCallback(async () => {
    if (!code || !shouldRefreshPublicWinners({ busy: busyRef.current, hidden: document.visibilityState === "hidden" })) return;
    const version = ++requestRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await getPublicLotteryWinners(code, { signal: controller.signal });
      if (version !== requestRef.current || controller.signal.aborted || !shouldRefreshPublicWinners({ busy: busyRef.current, hidden: document.visibilityState === "hidden" })) return;
      setItems(normalizePublicWinners(response));
    } catch (err) {
      if (version !== requestRef.current || controller.signal.aborted || busyRef.current || err?.code === "REQUEST_ABORTED") return;
      // Keep the last confirmed real records during a transient outage.
    }
  }, [code]);

  useEffect(() => {
    setItems([]);
    setPaused(false);
    return () => {
      ++requestRef.current;
      controllerRef.current?.abort();
    };
  }, [code]);

  useEffect(() => {
    setHidden(document.visibilityState === "hidden");
    // Do not reveal a newly committed prize in the feed before the wheel lands.
    // Cleanup invalidates and aborts requests already in flight when a spin starts.
    if (busy) return undefined;
    let active = true;
    let timer;
    let generation = 0;
    const poll = async (currentGeneration = generation) => {
      await load();
      if (active && currentGeneration === generation && shouldRefreshPublicWinners({ busy: busyRef.current, hidden: document.visibilityState === "hidden" })) timer = window.setTimeout(() => poll(currentGeneration), 30000);
    };
    const visibility = () => {
      const nextHidden = document.visibilityState === "hidden";
      setHidden(nextHidden);
      window.clearTimeout(timer);
      generation += 1;
      ++requestRef.current;
      controllerRef.current?.abort();
      if (!nextHidden) poll();
    };
    poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      generation += 1;
      window.clearTimeout(timer);
      ++requestRef.current;
      controllerRef.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [load, refreshVersion, busy]);

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(Boolean(preference?.matches));
    preference?.addEventListener?.("change", update);
    return () => preference?.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!viewport || !group) return undefined;
    const measure = () => {
      setViewportWidth(viewport.clientWidth);
      setDuration(winnerBannerDuration(Math.max(viewport.clientWidth, group.getBoundingClientRect().width)));
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(viewport);
    observer?.observe(group);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [signature, reducedMotion]);

  const moving = shouldAnimateWinnerBanner({ count: items.length, paused, reducedMotion, hidden, interacting: busy || hovered || focused });
  const renderGroup = (duplicate = false) => (
    <div className={`lottery-winner-banner__group${duplicate ? " lottery-winner-banner__group--duplicate" : ""}`} ref={duplicate ? undefined : groupRef} role={duplicate ? undefined : "list"} aria-hidden={duplicate || undefined}>
      {items.map((winner) => (
        <div className="lottery-winner-banner__item" role="listitem" key={winner.id} title={`恭喜${winner.display_name}抽中${winner.prize_name}`}>
          <span className="lottery-winner-banner__avatar" aria-hidden="true"><UserOutlined /></span>
          <span>恭喜 <b>{winner.display_name}</b> 抽中</span>
          <strong>{winner.prize_name}</strong>
        </div>
      ))}
    </div>
  );

  // Empty/error states do not create a fake winner or a blank promotional card.
  // Polling resumes normally; previously confirmed records survive an outage.
  if (!items.length) return null;

  return (
    <aside className={`lottery-winner-banner${items.length === 1 ? " lottery-winner-banner--single" : ""}`} aria-label="本活动真实中奖动态，客户称呼已脱敏" onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }} onPointerLeave={() => setHovered(false)}>
      <span className="lottery-winner-banner__label"><SoundOutlined /><span>中奖播报</span></span>
      <div className={`lottery-winner-banner__viewport${reducedMotion ? " lottery-winner-banner__viewport--static" : ""}`} ref={viewportRef} tabIndex={0} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} aria-label="真实中奖记录循环播放，可暂停或左右浏览" aria-live="off">
        <div className="lottery-winner-banner__track" key={signature} style={{ "--winner-duration": `${duration}s`, "--winner-viewport-width": `${viewportWidth}px`, animationPlayState: moving ? "running" : "paused" }}>
          {renderGroup()}
          {!reducedMotion && renderGroup(true)}
        </div>
      </div>
      {!reducedMotion ? <Button className="lottery-winner-banner__pause" type="text" size="small" aria-pressed={paused} aria-label={paused ? "继续滚动中奖动态" : "暂停滚动中奖动态"} title={paused ? "继续滚动" : "暂停滚动"} icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />} onClick={() => setPaused((value) => !value)} /> : null}
    </aside>
  );
}
