// Position each label in its original sector. Only its contents counter-rotate;
// the center still travels with the wheel, preserving the server-result target.
export function hasSameWheelPrizeOrder(before = [], after = []) {
  return before.length === after.length && before.every((prize, index) => prize.id === after[index]?.id);
}

export function getWheelPrizeLabelStyle(index, prizeCount, rotation) {
  const count = Math.max(prizeCount, 1);
  const angle = (index + 0.5) * (360 / count) * (Math.PI / 180);
  // Leave room for upright labels at every angle, including diagonal corners
  // on a 320px phone. Dense wheels use the existing smaller label dimensions.
  const radius = count >= 10 ? 35 : 34;
  return {
    left: `${50 + Math.sin(angle) * radius}%`,
    top: `${50 - Math.cos(angle) * radius}%`,
    transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
  };
}
