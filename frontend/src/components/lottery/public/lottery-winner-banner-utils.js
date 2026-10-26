// A single confirmed winner still moves; motion does not imply a new win.
export function shouldAnimateWinnerBanner({ count, paused = false, reducedMotion = false, hidden = false, interacting = false }) {
  return count > 0 && !paused && !reducedMotion && !hidden && !interacting;
}

export function winnerBannerDuration(distance) {
  return Number.isFinite(distance) && distance > 0 ? Math.max(8, distance / 30) : 8;
}
