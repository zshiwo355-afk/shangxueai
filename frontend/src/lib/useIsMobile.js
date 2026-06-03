import { useEffect, useState } from "react";

/**
 * 监听窗口宽度判断是否处于移动端断点。
 * 默认与 styles.css 中 P0/P1/P2 块的 768px 断点保持一致。
 * 用 matchMedia + change 事件，避免高频 resize 监听。
 */
export function useIsMobile(maxWidth = 768) {
  const query = `(max-width: ${maxWidth}px)`;
  const [match, setMatch] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mql = window.matchMedia(query);
    const handler = (event) => setMatch(event.matches);
    // matchMedia 在旧 Safari 仍用 addListener；新 API 用 addEventListener
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
    } else if (mql.addListener) {
      mql.addListener(handler);
    }
    setMatch(mql.matches);
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener("change", handler);
      } else if (mql.removeListener) {
        mql.removeListener(handler);
      }
    };
  }, [query]);

  return match;
}
