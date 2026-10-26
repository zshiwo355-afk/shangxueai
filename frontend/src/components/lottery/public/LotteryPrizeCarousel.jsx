import { GiftOutlined, PauseOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Button, Empty } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import LotteryPrizeImage from "./LotteryPrizeImage";
import { createPrizeMarqueeEntries } from "./lottery-prize-marquee-utils";
import { shouldAutoplayPrizes } from "./lottery-public-utils";
import "./lottery-prize-marquee.css";

export default function LotteryPrizeCarousel({ prizes = [] }) {
  const viewportRef = useRef(null);
  const groupRef = useRef(null);
  const [minimumColumns, setMinimumColumns] = useState(8);
  const [duration, setDuration] = useState(40);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const [reducedMotion, setReducedMotion] = useState(() => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const staticDisplay = reducedMotion || prizes.length < 2;
  const entries = useMemo(() => createPrizeMarqueeEntries(prizes, minimumColumns, staticDisplay), [prizes, minimumColumns, staticDisplay]);

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(Boolean(preference?.matches));
    const updateVisibility = () => setHidden(document.visibilityState === "hidden");
    preference?.addEventListener?.("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      preference?.removeEventListener?.("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!viewport || !group) return undefined;
    const measure = () => {
      const style = window.getComputedStyle(viewport);
      const step = (parseFloat(style.getPropertyValue("--lottery-marquee-card-width")) || 134)
        + (parseFloat(style.getPropertyValue("--lottery-marquee-gap")) || 12);
      // A repeated group always covers the viewport, including at the loop seam.
      setMinimumColumns(Math.ceil(viewport.clientWidth / step) + 1);
      setDuration(Math.max(8, group.getBoundingClientRect().width / 28));
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(viewport);
    observer?.observe(group);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [entries.length, staticDisplay]);

  const moving = shouldAutoplayPrizes({ count: prizes.length, reducedMotion, paused, interacting: hovered || focused, hidden });
  const renderGroup = (duplicate = false) => (
    <div className={`lottery-gift-marquee__group${duplicate ? " lottery-gift-marquee__group--duplicate" : ""}`} ref={duplicate ? undefined : groupRef} role={duplicate ? undefined : "list"} aria-hidden={duplicate || undefined}>
      {entries.map(({ prize, sourceIndex, repeated }, index) => (
        <article className="lottery-gift-marquee__item" role="listitem" aria-hidden={repeated || undefined} key={`${prize.id ?? sourceIndex}-${index}`}>
          <div className="lottery-gift-marquee__image"><LotteryPrizeImage prize={prize} /></div>
          <h3 title={prize.name || "精选好礼"}>{prize.name || "精选好礼"}</h3>
        </article>
      ))}
    </div>
  );

  return (
    <section className={`lottery-prizes-card lottery-gift-marquee${prizes.length === 1 ? " lottery-gift-marquee--single" : ""}`} aria-label="本期奖品展示">
      <div className="lottery-section-heading"><div><GiftOutlined /><span>本期臻选好礼</span></div><span className="lottery-section-caption">奖品以实际发放为准</span></div>
      {prizes.length ? (
        <div ref={viewportRef} className={`lottery-gift-marquee__viewport${staticDisplay ? " lottery-gift-marquee__viewport--static" : ""}`} tabIndex={0} aria-label={staticDisplay ? "奖品列表，可左右滚动浏览" : "两行奖品连续展示，聚焦或移入鼠标暂停"} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
          <div className="lottery-gift-marquee__track" style={{ "--lottery-marquee-duration": `${duration}s`, animationPlayState: moving ? "running" : "paused" }}>
            {renderGroup()}
            {!staticDisplay && renderGroup(true)}
          </div>
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="好礼正在准备中" />}
      {prizes.length > 1 ? (
        <div className="lottery-gift-marquee__footer">
          <span>共 {prizes.length} 款好礼</span>
          {reducedMotion ? <span>左右滑动查看全部</span> : <Button type="text" size="small" aria-pressed={paused} icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />} onClick={() => setPaused((value) => !value)}>{paused ? "继续展示" : "暂停展示"}</Button>}
        </div>
      ) : null}
    </section>
  );
}
