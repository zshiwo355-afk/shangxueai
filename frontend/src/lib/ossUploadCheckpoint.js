const STORAGE_KEY = "magic-video-upload-checkpoints";

function readAllCheckpoints() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllCheckpoints(checkpoints) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoints || {}));
}

export function buildOssUploadCheckpointKey({
  mode,
  videoId,
  fileName,
  fileSize,
  lastModified,
}) {
  return [
    "magic-video-upload",
    mode || "create",
    String(videoId || 0),
    String(fileName || ""),
    String(fileSize || 0),
    String(lastModified || 0),
  ].join(":");
}

export function loadOssUploadCheckpoint(checkpointKey) {
  if (!checkpointKey) return null;
  const checkpoints = readAllCheckpoints();
  return checkpoints[checkpointKey] || null;
}

export function saveOssUploadCheckpoint(checkpointKey, payload) {
  if (!checkpointKey) return;
  const checkpoints = readAllCheckpoints();
  checkpoints[checkpointKey] = {
    ...(checkpoints[checkpointKey] || {}),
    ...(payload || {}),
    updated_at: Date.now(),
  };
  writeAllCheckpoints(checkpoints);
}

export function clearOssUploadCheckpoint(checkpointKey) {
  if (!checkpointKey) return;
  const checkpoints = readAllCheckpoints();
  if (!(checkpointKey in checkpoints)) return;
  delete checkpoints[checkpointKey];
  writeAllCheckpoints(checkpoints);
}
