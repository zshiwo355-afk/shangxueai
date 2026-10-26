export function validMallPoints(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 100000000;
}

export function productFormPayload({ points_cost, ...values }) {
  if (!validMallPoints(points_cost)) throw new Error("兑换积分必须为 1 至 100000000 的整数");
  return {
    ...values,
    name: values.name.trim(),
    description: (values.description || "").trim(),
    image_url: (values.image_url || "").trim(),
    price_yuan: points_cost * 20,
  };
}

export function productUpdatePayload(product, values) {
  return { ...values, expected_version: product.version };
}

// Failed requests retain their key; any changed grant gets a new key.
export function grantRequest(previous, payload, createId = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify([payload.user_id, payload.points, payload.remark]);
  if (previous?.fingerprint === fingerprint) return previous;
  return { fingerprint, payload: { ...payload, request_id: createId() } };
}

export function validMallImageUrl(value) {
  if (!value) return true;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\u0000-\u001f\\]/.test(decoded)) return false;
    if (value.startsWith("/assets/")) return !value.includes("?") && !value.includes("#") && !decoded.split("/").includes("..");
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
