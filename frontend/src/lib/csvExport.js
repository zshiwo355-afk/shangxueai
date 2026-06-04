/**
 * 简易 CSV 导出：BOM + CRLF，Excel 双击直接识别为 UTF-8。
 * 不引第三方库，列数有限的 KPI / 部门 / 趋势数据足够用。
 */

function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCsv(filename, columns, rows) {
  const header = columns.map((c) => escapeCell(c.title)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const raw = typeof c.value === "function" ? c.value(row) : row[c.key];
          return escapeCell(raw);
        })
        .join(","),
    )
    .join("\r\n");
  const csv = `﻿${header}\r\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}
