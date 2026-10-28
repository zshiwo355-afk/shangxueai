import { CommentOutlined, PauseOutlined, PlayCircleOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import { useEffect, useRef, useState } from "react";
import { fetchMallDanmaku, sendMallDanmaku } from "../../lib/api.mall";
import { isMallDanmakuHeld, mallDanmakuArrivalLanes, mallDanmakuLayout, mallDanmakuMotion, mergeMallDanmaku, nextMallDanmaku, resizeMallDanmakuFrames } from "./mall-utils";

export default function MallDanmaku() {
  const overlay = useRef(null);
  const layout = useRef(mallDanmakuLayout(window.innerHeight - (window.innerWidth <= 760 ? 88 : 112)));
  const [items, setItems] = useState([]);
  const [frames, setFrames] = useState(() => Array(layout.current.count).fill(null));
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState("");
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const pool = useRef([]);
  const lanes = useRef(frames);
  const pending = useRef([]);
  const cursor = useRef(0);
  const serial = useRef(0);
  const sendLock = useRef(false);
  const mounted = useRef(false);
  const pointerType = useRef("mouse");

  const interact = (key, field, value) => {
    lanes.current = lanes.current.map((frame) => frame?.key === key
      ? { ...frame, [field]: value ?? !frame[field] } : frame);
    setFrames(lanes.current);
  };

  const advance = (lane, entranceDelay = 0) => {
    if (isMallDanmakuHeld(lanes.current[lane])) return;
    const others = lanes.current.filter((frame, index) => frame && index !== lane);
    const item = nextMallDanmaku(pool.current, cursor.current,
      others.map((frame) => frame.item.id), pending.current);
    const priority = item && pending.current.includes(item.id);
    if (item && !priority) cursor.current = item.id;
    if (item) pending.current = pending.current.filter((id) => id !== item.id);
    const motion = item ? mallDanmakuMotion(item.content, others.map((frame) => frame.motion.band), layout.current) : null;
    if (motion && priority) motion.delay = entranceDelay;
    lanes.current = lanes.current.map((frame, index) => index === lane
      ? item ? { item, key: ++serial.current, motion } : null : frame);
    setFrames(lanes.current);
  };

  const receive = (incoming, ownSend = false) => {
    const previousIds = new Set(pool.current.map((item) => item.id));
    const initial = pool.current.length === 0;
    pool.current = mergeMallDanmaku(pool.current, incoming);
    setItems(pool.current);
    const fresh = initial && !ownSend ? [] : pool.current.filter((item) => !previousIds.has(item.id));
    const freshIds = fresh.map((item) => item.id);
    pending.current = (ownSend ? [...freshIds, ...pending.current] : [...pending.current, ...freshIds])
      .filter((id) => pool.current.some((item) => item.id === id));
    // Show each new arrival before replaying history, including late commits.
    const availableLanes = mallDanmakuArrivalLanes(lanes.current);
    availableLanes.slice(0, fresh.length).forEach((lane, index) => advance(lane, index * 0.15));
    for (let lane = 0; lane < lanes.current.length; lane += 1) {
      if (!pool.current.some((item) => item.id === lanes.current[lane]?.item.id)) advance(lane);
    }
  };

  useEffect(() => {
    const measure = () => {
      const next = mallDanmakuLayout(overlay.current.clientHeight);
      if (next.height === layout.current.height && next.count === layout.current.count) return;
      layout.current = next;
      lanes.current = resizeMallDanmakuFrames(lanes.current, next);
      setFrames(lanes.current);
      lanes.current.forEach((frame, lane) => { if (!frame) advance(lane); });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const data = await fetchMallDanmaku();
        if (!active) return;
        receive(data.items);
        setCooldownUntil((until) => Math.max(until, Date.now() + data.cooldown_seconds * 1000));
        setLoadError("");
      } catch (error) {
        if (active) setLoadError(error.message || "弹幕暂时无法加载，正在重试。");
      } finally {
        if (active) {
          setLoaded(true);
          timer = window.setTimeout(poll, 5000);
        }
      }
    };
    poll();
    return () => { active = false; mounted.current = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let timer;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldown(remaining);
      if (!remaining) window.clearInterval(timer);
    };
    tick();
    if (cooldownUntil <= Date.now()) return undefined;
    timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const content = draft.trim();
  const length = Array.from(content).length;
  const submit = async (event) => {
    event.preventDefault();
    if (sendLock.current || Date.now() < cooldownUntil || !length || length > 50) return;
    sendLock.current = true;
    setSending(true);
    setSendError("");
    setSent("");
    try {
      const item = await sendMallDanmaku(content);
      if (!mounted.current) return;
      receive([item], true);
      setDraft("");
      setSent(`已发送：${item.content}`);
      setCooldownUntil(Date.now() + 5000);
    } catch (error) {
      if (!mounted.current) return;
      setSendError(error.message || "发送失败，请重试。");
      if (error.status === 429) setCooldownUntil(Date.now() + 5000);
    } finally {
      sendLock.current = false;
      if (mounted.current) setSending(false);
    }
  };

  return <section className={`mall-danmaku${paused ? " is-paused" : ""}`} aria-labelledby="mall-danmaku-title">
    <header className="mall-danmaku__header">
      <div><h2 id="mall-danmaku-title"><CommentOutlined /> 商城留言弹幕</h2><p>电脑悬停暂停 · 手机点按暂停 / 继续</p></div>
      <Button type="text" size="small" icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />}
        aria-pressed={paused} onClick={() => setPaused((value) => !value)} disabled={!items.length}>
        {paused ? "继续播放" : "暂停弹幕"}
      </Button>
    </header>
      <div ref={overlay} className="mall-danmaku__overlay" role="group" aria-label="滚动弹幕">
        {frames.map((frame) => frame ? <button type="button" tabIndex={-1}
          className={`mall-danmaku__message${frame.item.is_mine ? " is-mine" : ""}${isMallDanmakuHeld(frame) ? " is-held" : ""}`} key={frame.key}
          aria-label={`${frame.item.is_mine ? "我的弹幕" : `${frame.item.user_name}的弹幕`}：${frame.item.content}`}
          aria-pressed={!!frame.pinned}
          style={{ top: `${frame.motion.top}%`, animationDuration: `${frame.motion.duration}s`, animationDelay: `${frame.motion.delay}s`, animationPlayState: paused || isMallDanmakuHeld(frame) ? "paused" : "running" }}
          onPointerEnter={(event) => { if (event.pointerType === "mouse") interact(frame.key, "hovered", true); }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") interact(frame.key, "hovered", false); }}
          onPointerDown={(event) => { pointerType.current = event.pointerType; }}
          onClick={(event) => { if (pointerType.current === "touch" || event.detail === 0) interact(frame.key, "pinned"); }}
          onAnimationEnd={() => {
            const lane = lanes.current.findIndex((current) => current?.key === frame.key);
            if (lane !== -1) advance(lane);
          }}>
          <strong>{frame.item.is_mine ? "我" : frame.item.user_name}：</strong><span>{frame.item.content}</span>
        </button> : null)}
      </div>
    {items.length ? <>
      <ul className="mall-danmaku__readable" aria-label="最新商城弹幕" tabIndex={0}>
        {[...items].reverse().map((item) => <li key={item.id} className={item.is_mine ? "is-mine" : undefined}><strong>{item.is_mine ? "我" : item.user_name}：</strong>{item.content}</li>)}
      </ul>
    </> : <p className="mall-danmaku__empty">{!loaded ? "正在加载大家的弹幕…" : loadError ? "弹幕暂时无法加载" : "还没有弹幕，来发出第一声吧"}</p>}
    <form className="mall-danmaku__form" onSubmit={submit}>
      <div className="mall-danmaku__input">
        <Input aria-label="弹幕内容" aria-describedby="mall-danmaku-help" placeholder="说说你的心愿或祝福…"
          value={draft} disabled={sending} status={length > 50 ? "error" : undefined}
          onChange={(event) => { setDraft(event.target.value); setSent(""); setSendError(""); }}
          onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
        <span className={length > 50 ? "is-invalid" : undefined}>{length}/50</span>
      </div>
      <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={sending}
        disabled={!length || length > 50 || cooldown > 0}>{cooldown ? `${cooldown} 秒后发送` : "发送弹幕"}</Button>
    </form>
    <div className="mall-danmaku__footer">
      <span id="mall-danmaku-help">实名公开 · 免费发送 · 每 5 秒可发一条</span><span>循环播放最新 100 条</span>
    </div>
    {loadError ? <p className="mall-danmaku__warning" role="status">{loadError} 将自动重试，已加载的弹幕仍可播放。</p> : null}
    <p className={`mall-danmaku__feedback${sendError ? " is-invalid" : ""}`} role="status">{sendError || sent}</p>
  </section>;
}
