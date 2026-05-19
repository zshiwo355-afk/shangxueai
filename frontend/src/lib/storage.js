const ACTIVE_KEY = "shangxueai-active-session";

export function saveActiveSession(data) {
  if (typeof window === "undefined" || !data?.session_id) {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(data));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

export function loadActiveSession() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearActiveSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACTIVE_KEY);
}
