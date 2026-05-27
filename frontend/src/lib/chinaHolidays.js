import dayjs from "dayjs";

// Source: 国务院办公厅关于2026年部分节假日安排的通知（国办发明电〔2025〕7号）
// https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
const HOLIDAY_MAP = {
  "2026-01-01": { type: "holiday", name: "元旦" },
  "2026-01-02": { type: "holiday", name: "元旦" },
  "2026-01-03": { type: "holiday", name: "元旦" },
  "2026-01-04": { type: "workday", name: "调休上班" },
  "2026-02-14": { type: "workday", name: "调休上班" },
  "2026-02-15": { type: "holiday", name: "春节" },
  "2026-02-16": { type: "holiday", name: "春节" },
  "2026-02-17": { type: "holiday", name: "春节" },
  "2026-02-18": { type: "holiday", name: "春节" },
  "2026-02-19": { type: "holiday", name: "春节" },
  "2026-02-20": { type: "holiday", name: "春节" },
  "2026-02-21": { type: "holiday", name: "春节" },
  "2026-02-22": { type: "holiday", name: "春节" },
  "2026-02-23": { type: "holiday", name: "春节" },
  "2026-02-28": { type: "workday", name: "调休上班" },
  "2026-04-04": { type: "holiday", name: "清明节" },
  "2026-04-05": { type: "holiday", name: "清明节" },
  "2026-04-06": { type: "holiday", name: "清明节" },
  "2026-05-01": { type: "holiday", name: "劳动节" },
  "2026-05-02": { type: "holiday", name: "劳动节" },
  "2026-05-03": { type: "holiday", name: "劳动节" },
  "2026-05-04": { type: "holiday", name: "劳动节" },
  "2026-05-05": { type: "holiday", name: "劳动节" },
  "2026-05-09": { type: "workday", name: "调休上班" },
  "2026-06-19": { type: "holiday", name: "端午节" },
  "2026-06-20": { type: "holiday", name: "端午节" },
  "2026-06-21": { type: "holiday", name: "端午节" },
  "2026-09-20": { type: "workday", name: "调休上班" },
  "2026-09-25": { type: "holiday", name: "中秋节" },
  "2026-09-26": { type: "holiday", name: "中秋节" },
  "2026-09-27": { type: "holiday", name: "中秋节" },
  "2026-10-01": { type: "holiday", name: "国庆节" },
  "2026-10-02": { type: "holiday", name: "国庆节" },
  "2026-10-03": { type: "holiday", name: "国庆节" },
  "2026-10-04": { type: "holiday", name: "国庆节" },
  "2026-10-05": { type: "holiday", name: "国庆节" },
  "2026-10-06": { type: "holiday", name: "国庆节" },
  "2026-10-07": { type: "holiday", name: "国庆节" },
  "2026-10-10": { type: "workday", name: "调休上班" },
};

function normalizeDate(date) {
  return dayjs(date).format("YYYY-MM-DD");
}

export function getHolidayInfo(date) {
  return HOLIDAY_MAP[normalizeDate(date)] || null;
}

export function isHoliday(date) {
  return getHolidayInfo(date)?.type === "holiday";
}

export function isAdjustedWorkday(date) {
  return getHolidayInfo(date)?.type === "workday";
}

export function isBusinessDay(date) {
  const day = dayjs(date);
  if (isAdjustedWorkday(day)) return true;
  if (isHoliday(day)) return false;
  const weekday = day.day();
  return weekday !== 0 && weekday !== 6;
}

export function isRestDay(date) {
  const day = dayjs(date);
  if (isHoliday(day)) return true;
  if (isAdjustedWorkday(day)) return false;
  const weekday = day.day();
  return weekday === 0 || weekday === 6;
}
