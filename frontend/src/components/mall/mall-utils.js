export function redemptionBlockReason(product, balance) {
  if (!product?.enabled) return "商品已下架";
  if (product.stock <= 0) return "暂时兑完";
  if (balance == null) return "等待余额更新";
  if (balance < product.points_cost) return `还差 ${product.points_cost - balance} 积分`;
  return "";
}

export function createRedemptionRequest(product, requestId) {
  return {
    product_id: product.id,
    expected_price_yuan: product.price_yuan,
    request_id: requestId,
  };
}

export function newRedemptionRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function formatMallNumber(value) {
  return value == null ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

export function formatMallTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function mergeMallDanmaku(current, incoming) {
  // A poll started before a send may finish afterwards: keep the confirmed send.
  return [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()]
    .sort((a, b) => a.id - b.id).slice(-100);
}

export function nextMallDanmaku(items, afterId, activeIds = [], pendingIds = []) {
  const available = items.filter((item) => !activeIds.includes(item.id));
  return pendingIds.map((id) => available.find((item) => item.id === id)).find(Boolean)
    || available.find((item) => item.id > afterId) || available[0] || null;
}

export function isMallDanmakuHeld(frame) {
  return !!(frame?.hovered || frame?.pinned);
}

export function mallDanmakuArrivalLanes(frames) {
  return frames.flatMap((frame, lane) => isMallDanmakuHeld(frame) ? [] : [lane]);
}

export function mallDanmakuLayout(height) {
  return { height: Math.max(44, height), count: Math.max(1, Math.min(10, Math.floor(height / 52))) };
}

function mallDanmakuTop(band, layout, random) {
  const bandHeight = layout.height / layout.count;
  return (band * bandHeight + random() * Math.max(0, bandHeight - 44)) / layout.height * 100;
}

export function mallDanmakuMotion(content, activeBands = [], layout, random = Math.random) {
  const bands = Array.from({ length: layout.count }, (_, index) => index)
    .filter((band) => !activeBands.includes(band));
  if (!bands.length) return null;
  const band = bands[Math.floor(random() * bands.length)];
  return {
    band,
    top: mallDanmakuTop(band, layout, random),
    duration: 14 + random() * 8 + Array.from(content).length * 0.12,
    delay: 0.2 + random() * 2.8,
  };
}

export function resizeMallDanmakuFrames(frames, layout, random = Math.random) {
  let retained = frames;
  if (frames.length > layout.count) {
    const occupied = frames.filter(Boolean);
    const held = occupied.filter(isMallDanmakuHeld).slice(0, layout.count);
    const selected = new Set([...held, ...occupied.filter((frame) => !isMallDanmakuHeld(frame))
      .slice(0, layout.count - held.length)]);
    retained = occupied.filter((frame) => selected.has(frame));
  }
  return Array.from({ length: layout.count }, (_, band) => {
    const frame = retained[band];
    return frame ? {
      ...frame,
      motion: { ...frame.motion, band, top: mallDanmakuTop(band, layout, random) },
    } : null;
  });
}
