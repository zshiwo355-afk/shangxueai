// One profile owns wheel/label timing and result reveal. The gentler curve
// leaves visible travel for the final seconds instead of stopping almost at once.
export const WHEEL_SPIN_DURATION_MS = 7200;
export const WHEEL_SPIN_EASING = "cubic-bezier(0.25, 0.5, 0.4, 1)";
const REDUCED_DURATION_MS = 200;
const SETTLE_DELAY_MS = 200;

export function getWheelMotion(reducedMotion = false) {
  const durationMs = reducedMotion ? REDUCED_DURATION_MS : WHEEL_SPIN_DURATION_MS;
  return {
    durationMs,
    revealDelayMs: durationMs + SETTLE_DELAY_MS,
    style: {
      "--lottery-wheel-spin-duration": `${durationMs}ms`,
      "--lottery-wheel-spin-easing": WHEEL_SPIN_EASING,
    },
  };
}
