import { useEffect, useState } from "react";

/**
 * Full-screen overlay shown while we are waiting for the backend to assemble
 * a training pack (training start, exam start, etc). Visual feedback only --
 * stage progression is heuristic (the API doesn't report partial progress).
 */
export default function PrepareOverlay({
  open,
  title = "正在准备训练包",
  subtitle = "首次进入约 5–10 秒，请稍候。",
  steps = [
    "生成训练场景",
    "加载客户人设",
    "进入对话",
  ],
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) {
      setElapsed(0);
      return undefined;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) return null;

  return (
    <div className="prepare-overlay" role="status" aria-live="polite">
      <div className="prepare-overlay__card">
        <span className="prepare-overlay__spinner" aria-hidden="true" />
        <div className="prepare-overlay__title">{title}</div>
        <div className="prepare-overlay__subtitle">{subtitle}</div>
        <ul className="prepare-overlay__steps">
          {steps.map((label, idx) => {
            const activeIdx = Math.min(steps.length - 1, Math.floor(elapsed / 2));
            const state = idx < activeIdx ? "done" : idx === activeIdx ? "active" : "pending";
            return (
              <li key={label} className={`prepare-overlay__step is-${state}`}>
                <span className="prepare-overlay__dot" aria-hidden="true" />
                <span>{label}</span>
              </li>
            );
          })}
        </ul>
        <div className="prepare-overlay__elapsed">已用 {elapsed} 秒</div>
      </div>
    </div>
  );
}
