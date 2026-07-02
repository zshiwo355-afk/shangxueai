function pad2(value) {
  return String(value).padStart(2, "0");
}

export function getCurrentMonthText(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function getTodayText(now = new Date()) {
  return `${getCurrentMonthText(now)}-${pad2(now.getDate())}`;
}

export function buildAudioCalendarMap(days) {
  return Object.fromEntries((Array.isArray(days) ? days : []).map((item) => [item.date, item]));
}

export function buildAudioMakeupDateMap(days) {
  const map = {};
  for (const item of Array.isArray(days) ? days : []) {
    const date = String(item?.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const current = map[date] || {
      date,
      can_makeup: false,
      is_expired: false,
      reason: "",
      items: [],
    };
    current.can_makeup = current.can_makeup || Boolean(item?.can_makeup);
    current.is_expired = current.is_expired || Boolean(item?.is_expired);
    current.reason = current.reason || item?.reason || "";
    current.items.push(item);
    map[date] = current;
  }
  return map;
}

export function getAudioDayStatus(dateText, dayData, todayText = getTodayText()) {
  if (dateText > todayText) return "future";
  if (dayData?.uploaded) {
    return dateText === todayText ? "today_uploaded" : "uploaded";
  }
  return dateText === todayText ? "today_missing" : "missing";
}

export function getAudioCalendarCellState({
  dateText,
  monthText,
  dayData,
  makeupData,
  isMonthLoaded = true,
  todayText = getTodayText(),
}) {
  const safeDate = String(dateText || "");
  const safeMonth = String(monthText || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate) || safeDate.slice(0, 7) !== safeMonth) {
    return { status: "outside_month", shouldRenderStatus: false, count: 0 };
  }
  if (!isMonthLoaded) {
    return { status: "loading", shouldRenderStatus: false, count: 0 };
  }

  let status = getAudioDayStatus(safeDate, dayData, todayText);
  if (!dayData?.uploaded && makeupData?.can_makeup) status = "makeup_available";
  else if (!dayData?.uploaded && makeupData?.is_expired) status = "makeup_expired";
  return {
    status,
    shouldRenderStatus: true,
    count: Number(dayData?.count || 0),
  };
}
