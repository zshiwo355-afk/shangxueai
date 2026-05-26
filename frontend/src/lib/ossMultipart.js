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

export async function multipartUploadToOss(file, uploadPlan, onPercentChange) {
  const uploadedParts = [];
  let committedBytes = 0;
  for (const part of uploadPlan.part_urls || []) {
    const start = (part.part_number - 1) * uploadPlan.part_size;
    const end = Math.min(start + uploadPlan.part_size, file.size);
    const blob = file.slice(start, end);
    const etag = await uploadOssPartWithRetry(() => (
      uploadOssPart({
        url: part.url,
        blob,
        onProgress: (loaded) => {
          const current = committedBytes + loaded;
          const percent = Math.min(99, Math.round((current / file.size) * 100));
          onPercentChange?.(percent);
        },
      })
    ));
    committedBytes += blob.size;
    onPercentChange?.(Math.min(99, Math.round((committedBytes / file.size) * 100)));
    uploadedParts.push({ part_number: part.part_number, etag });
  }
  return uploadedParts;
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
