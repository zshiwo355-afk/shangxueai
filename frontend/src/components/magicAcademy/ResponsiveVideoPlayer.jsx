import { PlayCircleFilled } from "@ant-design/icons";
import { useEffect, useState } from "react";

export default function ResponsiveVideoPlayer({
  videoRef,
  src,
  poster,
  onLoadedMetadata,
  onTimeUpdate,
  onSeeking,
  onPause,
  onEnded,
  onPlay,
}) {
  const [showPosterOverlay, setShowPosterOverlay] = useState(Boolean(poster));

  useEffect(() => {
    setShowPosterOverlay(Boolean(poster));
  }, [poster, src]);

  const handlePlay = (event) => {
    setShowPosterOverlay(false);
    onPlay?.(event);
  };

  const handleOverlayClick = async () => {
    if (!videoRef?.current) return;
    try {
      await videoRef.current.play();
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
        ref={videoRef}
        src={src}
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
