import { useCallback, useEffect, useRef, useState } from "react";

function AiBrainIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
      <path
        d="M608.6 58c70.4 0 129.1 50.2 142.2 116.8a154.6 154.6 0 0 1 128.2 207.8A154.6 154.6 0 0 1 966 521.7a154.6 154.6 0 0 1-87 139a154.6 154.6 0 0 1-128.2 207.8A144.9 144.9 0 0 1 608.6 985.4a144.6 144.6 0 0 1-115.9-58a144.6 144.6 0 0 1-115.9 58a144.9 144.9 0 0 1-142.2-116.8A154.6 154.6 0 0 1 106.4 660.7A154.6 154.6 0 0 1 19.3 521.7a154.6 154.6 0 0 1 87-139.1A154.6 154.6 0 0 1 234.6 174.8A144.9 144.9 0 0 1 376.8 58a144.6 144.6 0 0 1 115.9 58A144.6 144.6 0 0 1 608.6 58z"
        fill="#64EDAC"
      />
      <path
        d="M380.3 385.9c18.5-50.8 90.4-50.8 108.9 0l57.3 157.3l0.2 0.5l0.2 0.5l31.3 96.6a29 29 0 0 1-55.1 17.9l-24.8-76.6H371.2l-24.8 76.6a29 29 0 0 1-55.1-17.9l31.3-96.6l0.2-0.5l0.2-0.5l57.3-157.3zM676.2 350.2a29 29 0 0 1 29 29v270.5a29 29 0 0 1-58 0v-270.5a29 29 0 0 1 29-29zM391.5 524.1h86.4L434.7 405.7l-43.2 118.4z"
        fill="#333C50"
      />
    </svg>
  );
}

const AI_URL = "https://www.huairenai888.com/";
const STORAGE_KEY = "floating-ai-button-pos";
const BTN_SIZE = 64;
const MARGIN = 16;
const DRAG_THRESHOLD = 5;

function clampToViewport(x, y) {
  const maxX = Math.max(MARGIN, window.innerWidth - BTN_SIZE - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - BTN_SIZE - MARGIN);
  return {
    x: Math.min(Math.max(x, MARGIN), maxX),
    y: Math.min(Math.max(y, MARGIN), maxY),
  };
}

function readSavedPos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return parsed;
  } catch {
    // ignore malformed storage
  }
  return null;
}

export default function FloatingAiButton() {
  const [pos, setPos] = useState(() => {
    const saved = readSavedPos();
    if (saved) return saved;
    return {
      x: window.innerWidth - BTN_SIZE - MARGIN,
      y: window.innerHeight - BTN_SIZE - MARGIN - 24,
    };
  });
  const [dragging, setDragging] = useState(false);

  const dragState = useRef({ active: false, moved: false, offsetX: 0, offsetY: 0 });

  // Keep button inside viewport on resize.
  useEffect(() => {
    const onResize = () => setPos((p) => clampToViewport(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerMove = useCallback((e) => {
    const st = dragState.current;
    if (!st.active) return;
    const nextX = e.clientX - st.offsetX;
    const nextY = e.clientY - st.offsetY;
    if (!st.moved
      && (Math.abs(e.clientX - st.startX) > DRAG_THRESHOLD
        || Math.abs(e.clientY - st.startY) > DRAG_THRESHOLD)) {
      st.moved = true;
      setDragging(true);
    }
    setPos(clampToViewport(nextX, nextY));
  }, []);

  const onPointerUp = useCallback(() => {
    const st = dragState.current;
    if (!st.active) return;
    st.active = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    setDragging(false);

    if (st.moved) {
      setPos((p) => {
        const clamped = clampToViewport(p.x, p.y);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
        } catch {
          // ignore storage errors
        }
        return clamped;
      });
    } else {
      window.open(AI_URL, "_blank", "noopener,noreferrer");
    }
  }, [onPointerMove]);

  const onPointerDown = useCallback((e) => {
    // Only react to primary button / touch.
    if (e.button != null && e.button !== 0) return;
    const st = dragState.current;
    st.active = true;
    st.moved = false;
    st.startX = e.clientX;
    st.startY = e.clientY;
    st.offsetX = e.clientX - pos.x;
    st.offsetY = e.clientY - pos.y;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [pos.x, pos.y, onPointerMove, onPointerUp]);

  return (
    <button
      type="button"
      className={`floating-ai-button${dragging ? " is-dragging" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      aria-label="打开 AI 助手"
      title="AI 助手"
    >
      <span className="floating-ai-button__halo" aria-hidden="true" />
      <AiBrainIcon className="floating-ai-button__icon" />
    </button>
  );
}
