import { GiftFilled } from "@ant-design/icons";
import { useEffect, useState } from "react";

export default function LotteryPrizeImage({ prize, compact = false }) {
  const [failed, setFailed] = useState(false);
  const src = prize?.image_url || prize?.prize_image_url || prize?.image || "";
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <GiftFilled aria-hidden="true" className={compact ? "lottery-prize-image--compact" : "lottery-prize-image--fallback"} />;
  return <img className={compact ? "lottery-prize-image lottery-prize-image--compact" : "lottery-prize-image"} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
