export default function ResponsiveVideoPlayer({
  videoRef,
  src,
  onLoadedMetadata,
  onTimeUpdate,
  onSeeking,
  onPause,
  onEnded,
  onPlay,
}) {
  return (
    <div className="magic-video-player-wrap">
      <video
        ref={videoRef}
        src={src}
        controls
        className="magic-video-player"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onSeeking={onSeeking}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
      />
    </div>
  );
}
