import { useEffect, useState } from "react";

function readFiniteWidth(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function detectMobile(maxWidth, query) {
  if (typeof window === "undefined") return false;

  const widths = [
    readFiniteWidth(window.innerWidth),
    readFiniteWidth(window.visualViewport?.width),
    readFiniteWidth(document.documentElement?.clientWidth),
    readFiniteWidth(window.screen?.width),
    readFiniteWidth(window.screen?.availWidth),
  ].filter(Boolean);

  const narrowWidth = widths.some((width) => width <= maxWidth);
  const mediaMatch = typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
  const userAgent = window.navigator?.userAgent || "";
  const phoneUserAgent = /(iPhone|iPod|Android.*Mobile|Windows Phone)/i.test(userAgent);

  return mediaMatch || narrowWidth || phoneUserAgent;
}

export function useIsMobile(maxWidth = 768) {
  const query = `(max-width: ${maxWidth}px)`;
  const [match, setMatch] = useState(() => detectMobile(maxWidth, query));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const update = () => setMatch(detectMobile(maxWidth, query));
    const mql = typeof window.matchMedia === "function" ? window.matchMedia(query) : null;

    if (mql?.addEventListener) {
      mql.addEventListener("change", update);
    } else if (mql?.addListener) {
      mql.addListener(update);
    }
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener?.("resize", update);
    update();

    return () => {
      if (mql?.removeEventListener) {
        mql.removeEventListener("change", update);
      } else if (mql?.removeListener) {
        mql.removeListener(update);
      }
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener?.("resize", update);
    };
  }, [maxWidth, query]);

  return match;
}
