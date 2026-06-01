function uploadOssPart({ url, blob, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag");
        if (!etag) {
          reject(new Error("OSS 分片上传成功，但未返回 ETag。"));
          return;
        }
        resolve(etag.replaceAll('"', ""));
        return;
      }
      reject(new Error(`OSS 分片上传失败（HTTP ${xhr.status}）。`));
    };
    xhr.onerror = () => reject(new Error("OSS 分片上传网络异常。"));
    xhr.send(blob);
  });
}

async function uploadOssPartWithRetry(task, retryCount = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("OSS 分片上传失败。");
}

function resolveMultipartConcurrency(fileSize) {
  if (fileSize >= 2 * 1024 * 1024 * 1024) return 4;
  if (fileSize >= 512 * 1024 * 1024) return 3;
  return 2;
}

function buildOverallProgressUpdater(fileSize, onPercentChange) {
  const partLoadedMap = new Map();
  let completedBytes = 0;
  return {
    onPartProgress(partNumber, loaded) {
      partLoadedMap.set(partNumber, loaded);
      let inFlightBytes = 0;
      for (const value of partLoadedMap.values()) inFlightBytes += value;
      const current = Math.min(fileSize, completedBytes + inFlightBytes);
      onPercentChange?.(Math.min(99, Math.round((current / fileSize) * 100)));
    },
    onPartComplete(partNumber, partSize) {
      partLoadedMap.delete(partNumber);
      completedBytes += partSize;
      onPercentChange?.(Math.min(99, Math.round((completedBytes / fileSize) * 100)));
    },
  };
}

export async function multipartUploadToOss(file, uploadPlan, onPercentChange, options = {}) {
  const parts = Array.isArray(uploadPlan?.part_urls) ? uploadPlan.part_urls : [];
  if (!parts.length) return [];
  const retryCount = Number.isFinite(options.retryCount) ? options.retryCount : 2;
  const existingParts = Array.isArray(options.existingParts) ? options.existingParts : [];
  const existingPartsMap = new Map(
    existingParts
      .filter((item) => Number(item?.part_number) > 0 && item?.etag)
      .map((item) => [Number(item.part_number), String(item.etag)]),
  );
  const concurrency = Math.max(
    1,
    Math.min(
      parts.length,
      Number.isFinite(options.concurrency) ? Number(options.concurrency) : resolveMultipartConcurrency(file.size),
    ),
  );
  const uploadedParts = new Array(parts.length);
  const progress = buildOverallProgressUpdater(file.size, onPercentChange);
  let preCompletedBytes = 0;
  for (const part of parts) {
    if (existingPartsMap.has(part.part_number)) {
      const start = (part.part_number - 1) * uploadPlan.part_size;
      const end = Math.min(start + uploadPlan.part_size, file.size);
      preCompletedBytes += Math.max(end - start, 0);
    }
  }
  if (preCompletedBytes > 0 && file.size > 0) {
    onPercentChange?.(Math.min(99, Math.round((preCompletedBytes / file.size) * 100)));
  }
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= parts.length) return;
      const part = parts[index];
      const start = (part.part_number - 1) * uploadPlan.part_size;
      const end = Math.min(start + uploadPlan.part_size, file.size);
      const blob = file.slice(start, end);
      if (existingPartsMap.has(part.part_number)) {
        uploadedParts[index] = { part_number: part.part_number, etag: existingPartsMap.get(part.part_number) };
        continue;
      }
      const etag = await uploadOssPartWithRetry(
        () => uploadOssPart({
          url: part.url,
          blob,
          onProgress: (loaded) => {
            progress.onPartProgress(part.part_number, loaded);
          },
        }),
        retryCount,
      );
      progress.onPartComplete(part.part_number, blob.size);
      uploadedParts[index] = { part_number: part.part_number, etag };
      options.onPartUploaded?.(uploadedParts[index]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return uploadedParts.sort((a, b) => a.part_number - b.part_number);
}

export function logOssUploadError(error) {
  console.error("OSS multipart upload error", {
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: error?.message,
    requestId: error?.requestId,
    hostId: error?.hostId,
    stack: error?.stack,
    error,
  });
}
