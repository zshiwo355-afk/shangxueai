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
