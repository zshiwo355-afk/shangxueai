// Visual repetition keeps a two-row track seamless; only the first occurrence
// of each real prize is exposed to assistive technology. It creates no prizes.
export function createPrizeMarqueeEntries(prizes, minimumColumns = 1, staticDisplay = false) {
  const source = Array.isArray(prizes) ? prizes : [];
  if (!source.length) return [];
  const columns = Number.isFinite(Number(minimumColumns)) ? Math.max(1, Math.ceil(Number(minimumColumns))) : 1;
  let repetitions = staticDisplay || source.length < 2 ? 1 : Math.max(1, Math.ceil((columns * 2) / source.length));
  // An even number of cells makes the next group start at the same row.
  if (!staticDisplay && source.length > 1 && (source.length * repetitions) % 2) repetitions += 1;
  return Array.from({ length: source.length * repetitions }, (_, index) => ({
    prize: source[index % source.length],
    sourceIndex: index % source.length,
    repeated: index >= source.length,
  }));
}
