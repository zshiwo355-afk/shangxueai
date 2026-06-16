export async function clearFrontendCacheAndReload() {
  if (typeof window === "undefined") return;

  const tasks = [];

  if ("caches" in window) {
    tasks.push(
      window.caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key)))),
    );
  }

  if ("serviceWorker" in navigator) {
    tasks.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((item) => item.unregister()))),
    );
  }

  await Promise.allSettled(tasks);

  try {
    window.sessionStorage.setItem("shangxueai-cache-cleared-at", String(Date.now()));
  } catch {
    // Some embedded browsers disable sessionStorage.
  }

  const url = new URL(window.location.href);
  url.searchParams.set("sx_refresh", Date.now().toString(36));
  window.location.replace(url.toString());
}
