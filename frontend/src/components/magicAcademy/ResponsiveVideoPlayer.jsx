import { PlayCircleFilled } from "@ant-design/icons";
import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";

export default function ResponsiveVideoPlayer({
  videoRef,
  src,
  fallbackSrc,
  preferHls = false,
  poster,
  onLoadedMetadata,
  onTimeUpdate,
  onSeeking,
  onPause,
  onEnded,
  onPlay,
}) {
  const innerVideoRef = useRef(null);
  const [showPosterOverlay, setShowPosterOverlay] = useState(Boolean(poster));
  const resolvedVideoRef = videoRef || innerVideoRef;

  useEffect(() => {
    setShowPosterOverlay(Boolean(poster));
  }, [poster, src]);

  useEffect(() => {
    const video = resolvedVideoRef?.current;
    if (!video || !src) return undefined;
    let hls = null;
    let fallbackLoaded = false;
    const shouldUseHls = Boolean(preferHls) || /\.m3u8($|\?)/i.test(src);
    const loadPlainSource = (nextSrc) => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.src = nextSrc;
      video.load();
    };
    const loadFallback = () => {
      if (!fallbackSrc || fallbackSrc === src || fallbackLoaded) return false;
      fallbackLoaded = true;
      loadPlainSource(fallbackSrc);
      return true;
    };
    const handleNativeError = () => {
      if (shouldUseHls) loadFallback();
    };
    video.addEventListener("error", handleNativeError);
    if (shouldUseHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data?.fatal) return;
        loadFallback();
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      loadPlainSource(src);
    }
    return () => {
      video.removeEventListener("error", handleNativeError);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [fallbackSrc, preferHls, resolvedVideoRef, src]);

  const handlePlay = (event) => {
    setShowPosterOverlay(false);
    onPlay?.(event);
  };

  const handleOverlayClick = async () => {
    if (!resolvedVideoRef?.current) return;
    try {
      await resolvedVideoRef.current.play();
    } catch {
      // Ignore autoplay/play promise rejections and keep native controls available.
    }
  };

  return (
    <div className="magic-video-player-wrap">
      {showPosterOverlay && poster ? (
        <button
          type="button"
          className="magic-video-poster-overlay"
          onClick={handleOverlayClick}
          aria-label="播放视频"
        >
          <img src={poster} alt="" className="magic-video-poster-overlay__image" />
          <span className="magic-video-poster-overlay__play">
            <PlayCircleFilled />
          </span>
        </button>
      ) : null}
      <video
        ref={resolvedVideoRef}
        poster={poster || undefined}
        controls
        className="magic-video-player"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onSeeking={onSeeking}
        onPlay={handlePlay}
        onPause={onPause}
        onEnded={onEnded}
      />
    </div>
  );
}
