/**
 * 全局错误提示工具：和 antd App.useApp() 的 message 实例桥接，
 * 让任何 .js / .jsx 文件都可以调用 notifyError(err, fallback)。
 *
 * 用法：
 *   - 在某个挂载在 AntdApp 内的组件里 useEffect 调用 bindMessageApi(messageApi)
 *   - 业务代码：
 *       try { ... } catch (err) { notifyError(err, "操作失败。") }
 *   - 也可以直接拿到友好文案：formatApiError(err, "操作失败。")
 *
 * 自动去重：1.5 秒内同样的提示文案只会出现一次，避免风暴。
 */

let _messageApi = null;
let _notificationApi = null;

const _recentMessages = new Map(); // text -> ts
const DEDUPE_WINDOW_MS = 1500;

export function bindMessageApi(messageApi, notificationApi) {
  _messageApi = messageApi || null;
  _notificationApi = notificationApi || null;
}

/** 把任意异常转成可展示的中文文案。 */
export function formatApiError(err, fallback = "操作失败。") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  // http.js 抛出的 Error 已经带了友好 message
  if (err.message) return err.message;
  return fallback;
}

/** 判断是否为「静默」错误（已中断 / 401 已被拦截器处理）。 */
function shouldSilence(err) {
  if (!err) return true;
  if (err.code === "REQUEST_ABORTED") return true;
  // 401 由 installAuthFetch 拦截器统一跳登录，这里不再吐 toast 干扰
  if (err.code === "AUTH_REQUIRED" || err.status === 401) return true;
  return false;
}

function pickLevel(err) {
  if (!err) return "error";
  if (err.code === "VALIDATION") return "warning";
  if (err.status >= 500 || err.code === "SERVER_ERROR") return "error";
  if (err.code === "NETWORK_ERROR" || err.code === "BAD_RESPONSE") return "error";
  return "error";
}

function dedupeOk(text) {
  const now = Date.now();
  // 顺手清理过期项
  for (const [k, ts] of _recentMessages) {
    if (now - ts > DEDUPE_WINDOW_MS) _recentMessages.delete(k);
  }
  if (_recentMessages.has(text)) return false;
  _recentMessages.set(text, now);
  return true;
}

/** 显示错误提示。组件未注入 messageApi 时降级到 console.error。 */
export function notifyError(err, fallback = "操作失败。") {
  if (shouldSilence(err)) return;
  const text = formatApiError(err, fallback);
  if (!dedupeOk(text)) return;

  const level = pickLevel(err);
  if (_messageApi && typeof _messageApi[level] === "function") {
    _messageApi[level]({ content: text, duration: level === "warning" ? 4 : 3 });
    return;
  }
  if (_notificationApi && typeof _notificationApi[level] === "function") {
    _notificationApi[level]({ message: text });
    return;
  }
  // 降级：messageApi 还没准备好（极早期错误）
  // eslint-disable-next-line no-console
  console.error("[notifyError]", text, err);
}

/** 给 try/catch 块用：catch (err) { onApiError(err, "加载失败。") } */
export const onApiError = notifyError;
