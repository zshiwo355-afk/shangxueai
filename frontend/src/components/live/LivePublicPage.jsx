import {
  ClockCircleOutlined,
  HeartFilled,
  HeartOutlined,
  PlayCircleFilled,
  SendOutlined,
  ShareAltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Empty, Input, Space, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  buildPublicLiveStreamUrl,
  createPublicLiveComment,
  getPublicLivePlaybackUrl,
  getPublicLiveRoom,
  getPublicLiveShareConfig,
  likePublicLive,
  listPublicLiveComments,
  recordPublicLiveView,
  sharePublicLive,
} from "../../lib/api.live";

const { Paragraph, Text, Title } = Typography;
const VISITOR_KEY = "shangxueai-public-live-visitor";
const LIVE_NICKNAME_KEY = "shangxueai-public-live-nickname";
const LIVE_LIKED_KEY_PREFIX = "shangxueai-public-live-liked:";
const WECHAT_SDK_SRC = "https://res.wx.qq.com/open/js/jweixin-1.6.0.js";
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const MEDIA_ERROR_MESSAGES = {
  1: "视频加载已取消，请重新点击播放。",
  2: "视频网络加载失败，请检查网络或稍后重试。",
  3: "视频文件无法解码，请确认视频编码为浏览器支持的 H.264/AAC。",
  4: "当前浏览器不支持这个视频格式，请更换为 MP4(H.264/AAC) 后再试。",
};
let wechatSdkPromise = null;

function getVisitorId() {
  try {
    let value = window.localStorage.getItem(VISITOR_KEY);
    if (!value) {
      value = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(VISITOR_KEY, value);
    }
    return value;
  } catch {
    return "";
  }
}

function getLikedKey(slug) {
  return `${LIVE_LIKED_KEY_PREFIX}${slug || ""}`;
}

function getSavedNickname() {
  try {
    return window.localStorage.getItem(LIVE_NICKNAME_KEY) || "";
  } catch {
    return "";
  }
}

function saveNickname(value) {
  try {
    window.localStorage.setItem(LIVE_NICKNAME_KEY, (value || "").trim().slice(0, 60));
  } catch {
    // ignore storage failures
  }
}

function hasLocalLiked(slug) {
  try {
    return window.localStorage.getItem(getLikedKey(slug)) === "1";
  } catch {
    return false;
  }
}

function markLocalLiked(slug) {
  try {
    window.localStorage.setItem(getLikedKey(slug), "1");
  } catch {
    // localStorage may be unavailable in restricted browsers.
  }
}

function getMediaErrorMessage(video) {
  const code = video?.error?.code;
  return MEDIA_ERROR_MESSAGES[code] || "视频加载失败，请检查后台视频文件或稍后重试。";
}

function formatTime(value) {
  if (!value) return "";
  return dayjs(value).format("YYYY年MM月DD日 HH:mm");
}

function Countdown({ startTime }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!startTime) return null;
  const diff = Math.max(0, dayjs(startTime).valueOf() - now);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    <div className="public-live-countdown">
      <ClockCircleOutlined />
      <span>{hours}小时 {minutes}分 {seconds}秒后开始</span>
    </div>
  );
}

function ensureMeta(name, value, property = false) {
  if (!value) return;
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let node = document.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(property ? "property" : "name", name);
    document.head.appendChild(node);
  }
  node.setAttribute("content", value);
}

function isWechatLikeBrowser() {
  const ua = window.navigator?.userAgent || "";
  return /MicroMessenger|wxwork/i.test(ua);
}

function isWxWorkBrowser() {
  const ua = window.navigator?.userAgent || "";
  return /wxwork/i.test(ua);
}

function isWechatBrowser() {
  const ua = window.navigator?.userAgent || "";
  return /MicroMessenger/i.test(ua) && !isWxWorkBrowser();
}

function loadWechatSdk() {
  if (window.wx) return Promise.resolve(window.wx);
  if (wechatSdkPromise) return wechatSdkPromise;
  wechatSdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${WECHAT_SDK_SRC}"]`);
    if (existing) {
      if (window.wx) {
        resolve(window.wx);
        return;
      }
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

function applyWechatShare(wx, share, onSuccess) {
  const payload = {
    title: share.title || "怀仁商学院",
    desc: share.description || "",
    link: share.url || window.location.href,
    imgUrl: share.image || "",
    success: onSuccess,
  };
  if (wx.updateAppMessageShareData) wx.updateAppMessageShareData(payload);
  if (wx.updateTimelineShareData) {
    wx.updateTimelineShareData({
      title: payload.title,
      link: payload.link,
      imgUrl: payload.imgUrl,
      success: onSuccess,
    });
  }
  if (wx.onMenuShareAppMessage) wx.onMenuShareAppMessage(payload);
  if (wx.onMenuShareTimeline) {
    wx.onMenuShareTimeline({
      title: payload.title,
      link: payload.link,
      imgUrl: payload.imgUrl,
      success: onSuccess,
    });
  }
}

function fallbackSharePayload(room, currentUrl) {
  return room?.share || {
    title: room.title,
    description: room.intro || "",
    image: room.cover_url || "",
    url: currentUrl,
  };
}

function configureWechatSdk(wx, sdk, share, onSuccess) {
  return new Promise((resolve, reject) => {
    if (!wx?.config || !sdk?.enabled) {
      reject(new Error("wechat sdk unavailable"));
      return;
    }
    wx.config({
      beta: true,
      debug: false,
      appId: sdk.app_id || sdk.corp_id,
      timestamp: sdk.timestamp,
      nonceStr: sdk.nonce_str,
      signature: sdk.signature,
      jsApiList: sdk.js_api_list || [],
    });
    wx.ready(() => {
      applyWechatShare(wx, share, onSuccess);
      resolve(wx);
    });
    wx.error?.(reject);
  });
}

function configureWecomAgentSdk(wx, agentSdk) {
  return new Promise((resolve, reject) => {
    if (!wx?.agentConfig || !agentSdk?.enabled) {
      reject(new Error("wecom agent sdk unavailable"));
      return;
    }
    wx.agentConfig({
      corpid: agentSdk.corp_id,
      agentid: agentSdk.agent_id,
      timestamp: agentSdk.timestamp,
      nonceStr: agentSdk.nonce_str,
      signature: agentSdk.signature,
      jsApiList: agentSdk.js_api_list || ["sendChatMessage"],
      success: () => resolve(wx),
      fail: reject,
    });
  });
}

async function loadLiveShareConfig(slug, room) {
  const currentUrl = window.location.href.split("#", 1)[0];
  const data = await getPublicLiveShareConfig(slug, currentUrl);
  return {
    share: data?.share || fallbackSharePayload(room, currentUrl),
    sdk: data?.sdk || {},
    agentSdk: data?.agent_sdk || {},
    wechatSdk: data?.wechat_sdk || {},
  };
}

async function prepareWechatShare({ slug, room, visitorId }) {
  if (!isWechatLikeBrowser() || !slug || !room) return;
  const { share, sdk, wechatSdk } = await loadLiveShareConfig(slug, room);
  const activeSdk = isWxWorkBrowser() ? sdk : wechatSdk;
  if (!activeSdk.enabled) return;
  const wx = await loadWechatSdk();
  if (!wx?.config) return;
  const onSuccess = () => {
    sharePublicLive(slug, { visitor_id: visitorId }).catch(() => {});
  };
  await configureWechatSdk(wx, activeSdk, share, onSuccess).catch(() => {});
}

async function invokeWecomCardShare({ slug, room }) {
  if (!isWxWorkBrowser() || !slug || !room) return false;
  const { share, sdk, agentSdk } = await loadLiveShareConfig(slug, room);
  if (!sdk.enabled) return false;
  const wx = await loadWechatSdk();
  const readyWx = await configureWechatSdk(wx, sdk, share, () => {});
  const agentReadyWx = await configureWecomAgentSdk(readyWx, agentSdk);
  if (!agentReadyWx?.invoke) return false;
  const payload = {
    msgtype: "news",
    news: {
      title: share.title || "怀仁商学院",
      desc: share.description || "",
      link: share.url || window.location.href,
      imgUrl: share.image || "",
    },
  };
  return new Promise((resolve) => {
    agentReadyWx.invoke("sendChatMessage", payload, (res) => {
      const msg = String(res?.err_msg || res?.errmsg || "");
      const ok = !msg || msg.includes(":ok");
      resolve(ok);
    });
  });
}

export default function LivePublicPage() {
  const { slug } = useParams();
  const { message } = AntdApp.useApp();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const lastCommentIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [nickname, setNickname] = useState(() => getSavedNickname());
  const [commenting, setCommenting] = useState(false);
  const [activePanel, setActivePanel] = useState("interaction");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [playerError, setPlayerError] = useState("");
  const visitorId = useMemo(() => getVisitorId(), []);
  const previewMode = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("preview") === "1";
    } catch {
      return false;
    }
  }, []);

  const loadComments = useCallback(async ({ reset = false } = {}) => {
    if (!slug) return;
    const afterId = reset ? 0 : lastCommentIdRef.current;
    try {
      const data = await listPublicLiveComments(slug, afterId ? { after_id: afterId } : {});
      const items = data?.items || [];
      const latestId = Number(data?.latest_id || 0);
      lastCommentIdRef.current = Math.max(
        lastCommentIdRef.current,
        latestId,
        ...items.map((item) => Number(item.id || 0)),
      );
      if (reset || !afterId) {
        setComments(items);
      } else if (items.length) {
        setComments((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...items.filter((item) => !seen.has(item.id))].slice(-200);
        });
      }
    } catch {
      if (reset) setComments([]);
    }
  }, [slug]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    lastCommentIdRef.current = 0;
    setComments([]);
    setPlaybackUrl("");
    setPlayerError("");
    getPublicLiveRoom(slug, previewMode ? { preview: 1 } : {})
      .then(async (data) => {
        if (!alive) return;
        setRoom(data);
        setLiked(hasLocalLiked(data?.slug || slug));
        setError("");
        document.title = data?.share?.title || data?.title || "怀仁商学院";
        ensureMeta("description", data?.share?.description || data?.intro || "");
        ensureMeta("og:title", data?.share?.title || data?.title || "", true);
        ensureMeta("og:description", data?.share?.description || data?.intro || "", true);
        ensureMeta("og:image", data?.share?.image || data?.cover_url || "", true);
        prepareWechatShare({ slug, room: data, visitorId }).catch(() => {});
        if (!previewMode) {
          try {
            const result = await recordPublicLiveView(slug, { visitor_id: visitorId });
            if (alive && result?.view_count !== undefined) {
              setRoom((prev) => prev ? {
                ...prev,
                view_count: result.view_count,
                view_pv_count: result.view_pv_count ?? result.pv_count ?? result.view_count,
                view_uv_count: result.view_uv_count ?? result.uv_count ?? prev.view_uv_count,
                pv_count: result.pv_count ?? result.view_pv_count ?? result.view_count,
                uv_count: result.uv_count ?? result.view_uv_count ?? prev.uv_count,
              } : prev);
            }
          } catch {
            // view tracking must never block watching
          }
        }
        if (!previewMode && data?.allow_comment) loadComments({ reset: true });
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || "直播不存在或暂不可访问。");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadComments, previewMode, slug, visitorId]);

  useEffect(() => {
    if (previewMode || !room?.allow_comment || !slug) return undefined;
    const timer = window.setInterval(() => {
      loadComments();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loadComments, previewMode, room?.allow_comment, slug]);

  useEffect(() => {
    if (room?.effective_status !== "scheduled" || !room?.start_time || !slug) {
      return undefined;
    }
    let alive = true;
    let retryTimer = 0;
    const refreshAfterStart = () => {
      getPublicLiveRoom(slug, previewMode ? { preview: 1 } : {})
        .then((data) => {
          if (!alive) return;
          setRoom(data);
          setError("");
          if (data?.effective_status === "scheduled") {
            retryTimer = window.setTimeout(refreshAfterStart, 3000);
          }
        })
        .catch(() => {});
    };
    const delay = Math.max(dayjs(room.start_time).valueOf() - Date.now() + 2000, 1000);
    const timer = window.setTimeout(refreshAfterStart, Math.min(delay, 2147483647));
    return () => {
      alive = false;
      window.clearTimeout(timer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [previewMode, room?.effective_status, room?.start_time, slug]);

  const canPlay = Boolean(room?.can_play) && room?.effective_status !== "scheduled";
  const streamUrl = playbackUrl;
  const shareUrl = room?.share?.url || window.location.href;
  const canAdjustSpeed = canPlay && room?.content_type !== "live_stream";

  useEffect(() => {
    let alive = true;
    if (!canPlay || !room?.slug) {
      setPlaybackUrl("");
      setPlayerError("");
      return undefined;
    }
    setPlaybackUrl("");
    setPlayerError("");
    getPublicLivePlaybackUrl(room.slug, previewMode ? { preview: 1 } : {})
      .then((data) => {
        if (!alive) return;
        const url = (data?.url || "").trim();
        setPlaybackUrl(url);
        if (!url) setPlayerError("视频地址为空，请检查后台视频配置。");
      })
      .catch((err) => {
        if (!alive) return;
        const fallback = `${buildPublicLiveStreamUrl(room.slug)}${previewMode ? "?preview=1" : ""}`;
        setPlaybackUrl(fallback);
        setPlayerError(err?.message || "视频地址加载失败，已尝试使用兼容播放地址。");
      });
    return () => {
      alive = false;
    };
  }, [canPlay, previewMode, room?.slug]);

  const applyPlaybackRate = useCallback((rate) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !canPlay || !streamUrl) return undefined;
    setPlayerError("");
    const shouldUseHls = room?.content_type === "live_stream"
      || /\.m3u8($|\?)/i.test(streamUrl)
      || /mpegurl/i.test(room?.video_mime_type || "");
    let hls = null;
    const handleCanPlay = () => setPlayerError("");
    const handleError = () => setPlayerError(getMediaErrorMessage(video));
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("error", handleError);
    if (shouldUseHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: room?.content_type === "live_stream",
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) setPlayerError("视频流加载失败，请检查直播流地址或网络。");
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
    } else {
      video.src = streamUrl;
      video.load();
    }
    video.playbackRate = playbackRate;
    return () => {
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("error", handleError);
      if (hls) {
        hls.destroy();
        if (hlsRef.current === hls) hlsRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };
    // playbackRate is applied by applyPlaybackRate without reloading the media source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPlay, room?.content_type, room?.video_mime_type, streamUrl]);

  const handleLike = async () => {
    if (!room || liked) return;
    try {
      const result = await likePublicLive(room.slug, { visitor_id: visitorId });
      setLiked(true);
      markLocalLiked(room.slug);
      setRoom((prev) => prev ? { ...prev, like_count: result.like_count ?? prev.like_count } : prev);
    } catch (err) {
      message.error(err?.message || "点赞失败。");
    }
  };

  const handleShare = async () => {
    if (!room) return;
    const share = room.share || {};
    try {
      const sentByWecom = await invokeWecomCardShare({ slug: room.slug, room }).catch(() => false);
      if (sentByWecom) {
        message.success("已打开企微卡片分享。");
      } else if (isWechatBrowser()) {
        await navigator.clipboard.writeText(shareUrl);
        message.success("分享卡片链接已复制，也可点右上角分享到微信。");
      } else if (navigator.share) {
        await navigator.share({
          title: share.title || room.title,
          text: share.description || room.intro || "",
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        message.success("分享卡片链接已复制。");
      }
      const result = await sharePublicLive(room.slug, { visitor_id: visitorId });
      setRoom((prev) => prev ? { ...prev, share_count: result.share_count ?? prev.share_count } : prev);
    } catch (err) {
      if (err?.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(shareUrl);
          message.success("分享卡片链接已复制。");
        } catch {
          message.info(shareUrl);
        }
      }
    }
  };

  const submitComment = async () => {
    const content = commentText.trim();
    if (!content || !room) return;
    setCommenting(true);
    try {
      const cleanNickname = nickname.trim().slice(0, 60);
      saveNickname(cleanNickname);
      const result = await createPublicLiveComment(room.slug, { visitor_id: visitorId, nickname: cleanNickname, content });
      lastCommentIdRef.current = Math.max(lastCommentIdRef.current, Number(result?.id || 0));
      setComments((prev) => (
        result?.id && prev.some((item) => item.id === result.id)
          ? prev
          : [...prev, result].slice(-200)
      ));
      setCommentText("");
    } catch (err) {
      message.error(err?.message || "评论发送失败。");
    } finally {
      setCommenting(false);
    }
  };

  if (loading) {
    return (
      <div className="public-live-page public-live-page--center">
        <Spin size="large" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="public-live-page public-live-page--center">
        <Empty description={error || "直播暂不可访问"} />
      </div>
    );
  }

  return (
    <div className="public-live-page">
      <main className="public-live-shell">
        <section className="public-live-player">
          {canPlay ? (
            <>
              <video
                ref={videoRef}
                controls
                playsInline
                preload="metadata"
                poster={room.cover_url || ""}
                className="public-live-video"
                onLoadedMetadata={() => applyPlaybackRate(playbackRate)}
              />
              {playerError ? (
                <Alert
                  className="public-live-player-alert"
                  type="warning"
                  showIcon
                  message={playerError}
                />
              ) : null}
              {canAdjustSpeed ? (
                <div className="public-live-speedbar">
                  <Text type="secondary">倍速</Text>
                  <Space size={6} wrap>
                    {PLAYBACK_RATES.map((rate) => (
                      <Button
                        key={rate}
                        size="small"
                        type={playbackRate === rate ? "primary" : "default"}
                        onClick={() => applyPlaybackRate(rate)}
                      >
                        {Number.isInteger(rate) ? rate.toFixed(0) : String(rate)}x
                      </Button>
                    ))}
                  </Space>
                </div>
              ) : null}
            </>
          ) : (
            <div className="public-live-cover">
              {room.cover_url ? <img src={room.cover_url} alt="" /> : null}
              <div className="public-live-cover__overlay">
                {room.effective_status === "scheduled" ? <Countdown startTime={room.start_time} /> : <PlayCircleFilled />}
              </div>
            </div>
          )}
        </section>

        <section className="public-live-info">
          <Space size={8} wrap>
            <Tag color={room.content_type === "live_stream" ? "green" : "blue"} bordered={false}>
              {room.content_type === "live_stream" ? "直播" : "录播"}
            </Tag>
            <Tag bordered={false}>{room.status_label}</Tag>
            {room.start_time ? <Text type="secondary">{formatTime(room.start_time)}</Text> : null}
          </Space>
          <Title level={2}>{room.title}</Title>
          <Space size={12} wrap className="public-live-meta">
            <span><UserOutlined /> {room.lecturer || "怀仁商学院"}</span>
            {room.show_counters ? <span>观看 {room.pv_count ?? room.view_pv_count ?? room.view_count ?? 0}</span> : null}
            {room.show_counters ? <span>访客 {room.uv_count ?? room.view_uv_count ?? 0}</span> : null}
            {room.show_counters ? <span>点赞 {room.like_count || 0}</span> : null}
          </Space>
          {room.intro ? <Paragraph className="public-live-intro">{room.intro}</Paragraph> : null}
          <Space size={10} wrap className="public-live-actions">
            <Button
              size="large"
              type={liked ? "primary" : "default"}
              icon={liked ? <HeartFilled /> : <HeartOutlined />}
              onClick={handleLike}
              disabled={!room.allow_like}
            >
              {room.like_count || 0}
            </Button>
            <Button size="large" type="primary" icon={<ShareAltOutlined />} onClick={handleShare}>
              分享
            </Button>
          </Space>
        </section>

        <section className="public-live-panel">
          <div className="public-live-tabs">
            <button
              type="button"
              className={activePanel === "interaction" ? "is-active" : ""}
              onClick={() => setActivePanel("interaction")}
            >
              互动
            </button>
            <button
              type="button"
              className={activePanel === "intro" ? "is-active" : ""}
              onClick={() => setActivePanel("intro")}
            >
              介绍
            </button>
          </div>

          {activePanel === "interaction" ? (
            <div className="public-live-comments">
              <div className="public-live-system">
                系统提示：直播内容及互动评论严禁传播违法或不良信息，请文明交流。
              </div>
              <div className="public-live-assistant">
                <div className="public-live-assistant__avatar">助</div>
                <div className="public-live-assistant__bubble">
                  欢迎进入直播间。可以在这里发表评论，也可以点击点赞支持课程内容。
                </div>
              </div>
              <div className="public-live-comment-list">
                {comments.length ? comments.map((item) => (
                  <div key={item.id} className="public-live-comment">
                    <div className="public-live-comment__avatar">
                      {(item.nickname || "访客").trim().slice(0, 1) || "访"}
                    </div>
                    <div className="public-live-comment__body">
                      <div className="public-live-comment__head">
                        <Text strong>{item.nickname || "访客"}</Text>
                        <Text type="secondary">{item.created_at ? dayjs(item.created_at).format("HH:mm") : ""}</Text>
                      </div>
                      <div className="public-live-comment__content">{item.content}</div>
                    </div>
                  </div>
                )) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={room.allow_comment ? "暂无评论" : "评论已关闭"} />
                )}
              </div>
              {room.allow_comment ? (
                <div className="public-live-comment-form">
                  <div className="public-live-comment-form__avatar">
                    {(nickname || "我").trim().slice(0, 1) || "我"}
                  </div>
                  <div className="public-live-comment-form__body">
                    <Input
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                      maxLength={60}
                      placeholder="填写昵称"
                      className="public-live-comment-form__name"
                    />
                    <div className="public-live-comment-form__send">
                      <Input
                        value={commentText}
                        onChange={(event) => setCommentText(event.target.value)}
                        onPressEnter={submitComment}
                        maxLength={500}
                        placeholder="写下你的评论"
                      />
                      <Button type="primary" icon={<SendOutlined />} loading={commenting} onClick={submitComment}>发送</Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="public-live-detail">
              <Title level={4}>活动介绍</Title>
              {room.detail_html || room.intro ? (
                <Paragraph>{room.detail_html || room.intro}</Paragraph>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无介绍" />
              )}
              <Space size={12} wrap className="public-live-meta public-live-meta--intro">
                <span><UserOutlined /> {room.lecturer || "怀仁商学院"}</span>
                {room.start_time ? <span>{formatTime(room.start_time)}</span> : null}
                {room.duration_minutes ? <span>{room.duration_minutes} 分钟</span> : null}
              </Space>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
