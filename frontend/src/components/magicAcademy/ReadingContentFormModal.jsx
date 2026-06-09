import { CopyOutlined, DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Image,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  TimePicker,
  Typography,
  Upload,
} from "antd";
import datePickerZhCN from "antd/es/date-picker/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { useEffect, useMemo, useState } from "react";
import { buildMaterialAssetPreviewUrl, listAllMaterialAssets } from "../../lib/api.materials";
import { getHolidayInfo, isAdjustedWorkday, isBusinessDay, isRestDay } from "../../lib/chinaHolidays";
import DepartmentUserTreeSelect, { resolveDepartmentSelectionUserIds } from "../common/DepartmentUserTreeSelect";

dayjs.locale("zh-cn");

const { RangePicker } = DatePicker;
const { Text } = Typography;
const JOB_LEVEL_OPTIONS = [
  { value: "M线", label: "M线" },
  { value: "P线", label: "P线" },
  { value: "L线", label: "L线" },
];

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: index,
  label: `${index + 1}月`,
}));

function isWeekendLike(day) {
  const weekday = day.day();
  return weekday === 0 || weekday === 6;
}

function buildCalendarCells(monthValue) {
  const firstDay = monthValue.startOf("month");
  const start = firstDay.subtract(firstDay.day(), "day");
  return Array.from({ length: 42 }, (_, index) => start.add(index, "day"));
}

function buildEmptyItem(dateText) {
  return {
    client_key: `${dateText}-${Math.random().toString(36).slice(2, 8)}`,
    reading_date: dateText,
    push_time: "18:30:00",
    title: "",
    description: "",
    image_source: "upload",
    image: null,
    material_asset_id: null,
    series_id: null,
    series_title: "",
    image_url: "",
    target_type: "user",
    target_user_ids: [],
    target_department_ids: [],
    target_position_ids: [],
    target_job_level_ids: [],
    target_employment_status_ids: [],
    targets: [],
    newcomer_only: false,
    makeup_deadline_at: `${dayjs(dateText).add(2, "day").format("YYYY-MM-DD")} 23:59:59`,
  };
}

function normalizeItem(item) {
  const targetType = item?.targets?.some((target) => target.target_type === "department")
    ? "department"
    : item?.targets?.some((target) => target.target_type === "position")
      ? "position"
      : item?.targets?.some((target) => target.target_type === "job_level")
        ? "job_level"
        : item?.targets?.some((target) => target.target_type === "employment_status")
          ? "employment_status"
          : item?.targets?.some((target) => target.target_type === "all_newcomers")
            ? "all_newcomers"
            : item?.targets?.some((target) => target.target_type === "all")
              ? "all"
              : "user";
  return {
    client_key: `edit-${item?.id || dayjs().valueOf()}`,
    reading_date: item?.reading_date || dayjs().format("YYYY-MM-DD"),
    push_time: item?.push_time || "18:30:00",
    title: item?.title || "",
    description: item?.description || "",
    image_source: item?.source_type === "material" ? "material" : item?.source_type === "url" ? "url" : "upload",
    image: null,
    material_asset_id: item?.material_asset_id || null,
    series_id: item?.series_id || null,
    series_title: item?.series_title || "",
    image_url: item?.image_url || "",
    target_type: targetType,
    target_user_ids: (item?.targets || []).filter((target) => target.target_type === "user").map((target) => Number(target.target_id)),
    target_department_ids: (item?.targets || []).filter((target) => target.target_type === "department").map((target) => target.target_id),
    target_position_ids: (item?.targets || []).filter((target) => target.target_type === "position").map((target) => target.target_id),
    target_job_level_ids: (item?.targets || []).filter((target) => target.target_type === "job_level").map((target) => target.target_id),
    target_employment_status_ids: (item?.targets || []).filter((target) => target.target_type === "employment_status").map((target) => target.target_id),
    targets: (item?.targets || []).map((target) => ({ target_type: target.target_type, target_id: target.target_id })),
    newcomer_only: targetType === "all_newcomers",
    makeup_deadline_at: item?.makeup_deadline_at ? item.makeup_deadline_at.replace("T", " ").slice(0, 19) : "",
  };
}

function enumerateRangeDates(rangeValue) {
  if (!Array.isArray(rangeValue) || rangeValue.length !== 2 || !rangeValue[0] || !rangeValue[1]) return [];
  const start = rangeValue[0].startOf("day");
  const end = rangeValue[1].startOf("day");
  const dates = [];
  let cursor = start;
  while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
    dates.push(cursor.format("YYYY-MM-DD"));
    cursor = cursor.add(1, "day");
  }
  return dates;
}

function resolveManualTargetType(item) {
  if (item?.target_type === "all" || item?.target_type === "all_newcomers") return item.target_type;
  if (item?.target_department_ids?.length) return "department";
  if (item?.target_position_ids?.length) return "position";
  if (item?.target_job_level_ids?.length) return "job_level";
  if (item?.target_employment_status_ids?.length) return "employment_status";
  if (item?.target_user_ids?.length) return "user";
  return "user";
}

export default function ReadingContentFormModal({
  open,
  mode,
  submitting,
  editing,
  readingSeriesOptions = [],
  preferredSeriesId = null,
  onCreateSeries,
  employeeUsers,
  employeePositionOptions,
  employmentStatusOptions = [],
  onCancel,
  onSubmit,
}) {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [rangeDates, setRangeDates] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(dayjs());
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [materialKeyword, setMaterialKeyword] = useState("");
  const [materialDebouncedKeyword, setMaterialDebouncedKeyword] = useState(""); // CODEX_MODIFIED
  const [materialAssets, setMaterialAssets] = useState([]);
  const lockedEditing = mode === "edit" && !!editing?.core_fields_locked;

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && editing) {
      setItems([normalizeItem(editing)]);
      setActiveSeriesId(editing?.series_id || null);
      return;
    }
    setItems([]);
    setRangeDates(null);
    setCalendarMonth(dayjs());
    setActiveSeriesId(null);
  }, [editing, mode, open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setMaterialDebouncedKeyword(materialKeyword), 250); // CODEX_MODIFIED
    return () => window.clearTimeout(timer); // CODEX_MODIFIED
  }, [materialKeyword]); // CODEX_MODIFIED

  useEffect(() => {
    if (!open) return;
    listAllMaterialAssets({ asset_type: "image", keyword: materialDebouncedKeyword || "", page: 1, page_size: 50 }) // CODEX_MODIFIED
      .then((data) => setMaterialAssets(Array.isArray(data) ? data : []))
      .catch(() => setMaterialAssets([]));
  }, [materialDebouncedKeyword, open]); // CODEX_MODIFIED

  const employeeOptions = useMemo(
    () => employeeUsers.map((item) => ({
      value: item.id,
      label: `${item.real_name || item.display_name || item.username} (${item.username})`,
    })),
    [employeeUsers],
  );

  const selectedDates = useMemo(() => items.map((item) => item.reading_date), [items]);
  const selectedDateSet = useMemo(() => new Set(selectedDates), [selectedDates]);
  const activeSeries = useMemo(
    () => readingSeriesOptions.find((item) => String(item.value) === String(activeSeriesId))?.series || null,
    [activeSeriesId, readingSeriesOptions],
  );
  const getSeriesLabel = (item) => {
    if (!item.series_id) return "未归属系列";
    const option = readingSeriesOptions.find((series) => String(series.value) === String(item.series_id));
    return option?.series?.title || option?.label || item.series_title || "未归属系列";
  };
  const visibleMonthExcludedDates = useMemo(() => {
    const start = calendarMonth.startOf("month");
    const days = [];
    for (let index = 0; index < calendarMonth.daysInMonth(); index += 1) {
      const day = start.add(index, "day");
      if (!isBusinessDay(day)) days.push(day.format("YYYY-MM-DD"));
    }
    return days;
  }, [calendarMonth]);
  const excludedDefaultCount = visibleMonthExcludedDates.filter((dateText) => !selectedDateSet.has(dateText)).length;
  const calendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);
  const yearOptions = useMemo(() => {
    const currentYear = calendarMonth.year();
    return Array.from({ length: 7 }, (_, index) => {
      const year = currentYear - 3 + index;
      return { value: year, label: `${year}年` };
    });
  }, [calendarMonth]);

  const applySeriesDefaults = (item, series) => {
    if (!series) return item;
    const targets = Array.isArray(series.targets) ? series.targets : [];
    const next = { ...item, series_id: series.id, series_title: series.title || "" };
    if (targets.some((target) => target.target_type === "all")) {
      return { ...next, target_type: "all", target_user_ids: [], target_department_ids: [], target_position_ids: [], target_job_level_ids: [], target_employment_status_ids: [], targets };
    }
    if (!targets.length) {
      return { ...next, targets: [] };
    }
    return {
      ...next,
      target_type: targets.length ? "mixed" : item.target_type,
      target_user_ids: targets.filter((target) => target.target_type === "user").map((target) => Number(target.target_id)).filter(Boolean),
      target_department_ids: targets.filter((target) => target.target_type === "department").map((target) => target.target_id),
      target_position_ids: targets.filter((target) => target.target_type === "position").map((target) => target.target_id),
      target_job_level_ids: targets.filter((target) => target.target_type === "job_level").map((target) => target.target_id),
      target_employment_status_ids: targets.filter((target) => target.target_type === "employment_status").map((target) => target.target_id),
      targets,
    };
  };

  const hasSelectedTargets = (item) => (
    !!(
      item?.targets?.length
      || item?.target_user_ids?.length
      || item?.target_department_ids?.length
      || item?.target_position_ids?.length
      || item?.target_job_level_ids?.length
      || item?.target_employment_status_ids?.length
      || ["all", "all_newcomers", "department", "position", "job_level", "employment_status"].includes(item?.target_type)
    )
  );

  const hasInheritedSeriesTargets = (item) => !!(item?.series_id && item?.targets?.length);

  const isDateAllowedByActiveSeries = (dateText) => {
    if (!activeSeries) return true;
    const day = dayjs(dateText);
    if (activeSeries.start_date && day.isBefore(dayjs(activeSeries.start_date), "day")) return false;
    if (activeSeries.end_date && day.isAfter(dayjs(activeSeries.end_date), "day")) return false;
    return true;
  };

  const mergeDates = (nextDates) => {
    const unique = Array.from(new Set(nextDates)).sort();
    setItems((prev) => {
      const prevMap = Object.fromEntries(prev.map((item) => [item.reading_date, item]));
      return unique
        .filter(isDateAllowedByActiveSeries)
        .map((dateText) => prevMap[dateText] || applySeriesDefaults(buildEmptyItem(dateText), activeSeries));
    });
  };

  const toggleDate = (dateValue) => {
    const dateText = dateValue.format("YYYY-MM-DD");
    if (!isDateAllowedByActiveSeries(dateText)) {
      message.warning("所选日期超出当前系列计划周期。");
      return;
    }
    if (selectedDateSet.has(dateText)) {
      removeDate(dateText);
      return;
    }
    mergeDates([...selectedDates, dateText]);
  };

  const selectWorkdaysInMonth = (monthValue) => {
    const start = monthValue.startOf("month");
    const dates = [];
    for (let index = 0; index < monthValue.daysInMonth(); index += 1) {
      const day = start.add(index, "day");
      if (isBusinessDay(day) && isDateAllowedByActiveSeries(day.format("YYYY-MM-DD"))) dates.push(day.format("YYYY-MM-DD"));
    }
    setCalendarMonth(monthValue);
    mergeDates([...selectedDates, ...dates]);
  };

  const mergeRangeWorkdays = () => {
    const workdays = enumerateRangeDates(rangeDates).filter((dateText) => isBusinessDay(dayjs(dateText)) && isDateAllowedByActiveSeries(dateText));
    mergeDates([...selectedDates, ...workdays]);
  };

  const applyActiveSeriesChange = (seriesId) => {
    const series = readingSeriesOptions.find((item) => String(item.value) === String(seriesId))?.series || null;
    setActiveSeriesId(seriesId || null);
    if (series?.status === "draft") {
      message.warning("该系列仍为草稿，继续为其添加读书内容。");
    }
    if (series?.start_date) {
      setCalendarMonth(dayjs(series.start_date));
    }
    setItems((prev) => prev
      .filter((item) => {
        if (!seriesId) return true;
        const day = dayjs(item.reading_date);
        if (series?.start_date && day.isBefore(dayjs(series.start_date), "day")) return false;
        if (series?.end_date && day.isAfter(dayjs(series.end_date), "day")) return false;
        return true;
      })
      .map((item) => (seriesId ? applySeriesDefaults(item, series) : {
        ...item,
        series_id: null,
        series_title: "",
        targets: [],
        target_type: resolveManualTargetType(item),
      })));
  };

  const handleActiveSeriesChange = (seriesId) => {
    if (seriesId && items.some((item) => hasSelectedTargets(item))) {
      Modal.confirm({
        title: "覆盖派发对象确认",
        content: "是否使用新系列的默认派发对象覆盖当前已选择的派发对象？",
        okText: "覆盖",
        cancelText: "取消",
        onOk: () => applyActiveSeriesChange(seriesId),
      });
      return;
    }
    applyActiveSeriesChange(seriesId);
  };

  const applySeriesToItem = (readingDate, seriesId) => {
    const series = readingSeriesOptions.find((option) => String(option.value) === String(seriesId))?.series || null;
    setItems((prev) => prev.map((item) => {
      if (item.reading_date !== readingDate) return item;
      if (!seriesId || !series) {
        return {
          ...item,
          series_id: null,
          series_title: "",
          targets: [],
        target_type: resolveManualTargetType(item),
        };
      }
      return applySeriesDefaults(item, series);
    }));
  };

  const handleItemSeriesChange = (item, seriesId) => {
    if (!seriesId) {
      applySeriesToItem(item.reading_date, null);
      return;
    }
    if (hasSelectedTargets(item)) {
      Modal.confirm({
        title: "覆盖派发对象确认",
        content: "切换系列后，将使用该系列默认派发对象覆盖当前这一天已选择的派发对象。是否继续？",
        okText: "覆盖",
        cancelText: "取消",
        onOk: () => applySeriesToItem(item.reading_date, seriesId),
      });
      return;
    }
    applySeriesToItem(item.reading_date, seriesId);
  };

  useEffect(() => {
    if (!open || mode !== "create" || !preferredSeriesId) return;
    if (!readingSeriesOptions.some((item) => String(item.value) === String(preferredSeriesId))) return;
    applyActiveSeriesChange(preferredSeriesId);
  }, [open, mode, preferredSeriesId, readingSeriesOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateItem = (readingDate, patch) => {
    setItems((prev) => prev.map((item) => (item.reading_date === readingDate ? { ...item, ...patch } : item)));
  };

  const applyToAll = (sourceDate) => {
    const source = items.find((item) => item.reading_date === sourceDate);
    if (!source) return;
    setItems((prev) => prev.map((item) => (item.reading_date === sourceDate ? item : {
      ...item,
      push_time: source.push_time,
      title: source.title,
      description: source.description,
      image_source: source.image_source,
      image: source.image,
      material_asset_id: source.material_asset_id,
      series_id: source.series_id,
      image_url: source.image_url,
      target_type: source.target_type,
      target_user_ids: [...source.target_user_ids],
      target_department_ids: [...source.target_department_ids],
      target_position_ids: [...source.target_position_ids],
      target_job_level_ids: [...source.target_job_level_ids],
      target_employment_status_ids: [...source.target_employment_status_ids],
      targets: [...(source.targets || [])],
      newcomer_only: source.newcomer_only,
      makeup_deadline_at: source.makeup_deadline_at,
    })));
  };

  const removeDate = (dateText) => {
    setItems((prev) => prev.filter((item) => item.reading_date !== dateText));
  };

  const validateItems = () => {
    if (!items.length) {
      throw new Error("请先选择至少一个日期。");
    }
    return items.map((item) => {
      if (!item.title.trim()) throw new Error(`请填写 ${item.reading_date} 的标题。`);
      if (!item.push_time) throw new Error(`请填写 ${item.reading_date} 的推送时间。`);
      if (!item.makeup_deadline_at) throw new Error(`请填写 ${item.reading_date} 的补卡截止时间。`);
      if (item.image_source === "upload" && !item.image && !item.image_url) {
        throw new Error(`请为 ${item.reading_date} 上传图片。`);
      }
      if (item.image_source === "material" && !item.material_asset_id) {
        throw new Error(`请为 ${item.reading_date} 选择素材库图片。`);
      }
      if (item.target_type === "department") {
        const selectedUserIds = resolveDepartmentSelectionUserIds(item.target_department_ids, employeeUsers);
        if (!selectedUserIds.length) {
          throw new Error(`请为 ${item.reading_date} 选择至少一个部门或员工。`);
        }
        return {
          ...item,
          target_type: "user",
          target_user_ids: selectedUserIds,
          target_department_ids: [],
          target_job_level_ids: [],
          targets: selectedUserIds.map((id) => ({ target_type: "user", target_id: id })),
        };
      }
      if (Array.isArray(item.targets) && item.targets.length) {
        return {
          ...item,
          target_type: item.target_type === "mixed" ? "user" : item.target_type,
        };
      }
      if (item.target_type === "user" && !item.target_user_ids.length) {
        throw new Error(`请为 ${item.reading_date} 选择至少一个员工。`);
      }
      if (item.target_type === "position" && !item.target_position_ids.length) {
        throw new Error(`请为 ${item.reading_date} 选择至少一个岗位。`);
      }
      if (item.target_type === "job_level" && !item.target_job_level_ids.length) {
        throw new Error(`请为 ${item.reading_date} 选择至少一个职级。`);
      }
      if (item.target_type === "employment_status" && !item.target_employment_status_ids.length) {
        throw new Error(`请选择 ${item.reading_date} 的在职状态。`);
      }
      return {
        ...item,
        target_type: item.target_type === "all_newcomers" ? "all_newcomers" : item.target_type,
      };
    });
  };

  return (
    <Modal
      open={open}
      title={mode === "edit" ? "编辑读书内容" : "新增读书内容"}
      onCancel={onCancel}
      onOk={() => {
        try {
          onSubmit(validateItems());
        } catch (error) {
          message.error(error?.message || "读书内容校验失败。");
        }
      }}
      okText="保存"
      confirmLoading={submitting}
      width={1100}
      destroyOnHidden={false}
      styles={{ body: { maxHeight: "72vh", overflowY: "auto", overflowX: "hidden", paddingRight: 12 } }}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {lockedEditing ? (
          <Alert
            type="warning"
            showIcon
            message="该内容已有打卡记录，为保证统计一致性，核心字段不可修改。如需调整，请停用后重新创建。"
            description={editing?.edit_lock_reason || ""}
          />
        ) : null}
        {mode === "create" ? (
          <Card size="small" title="选择日期">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                  <Text type="secondary">所属系列</Text>
                  <Button size="small" type="link" onClick={() => onCreateSeries?.()}>
                    新建系列
                  </Button>
                </Space>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ maxWidth: 420, width: "100%" }}
                  placeholder="未归属系列"
                  value={activeSeriesId || undefined}
                  onChange={handleActiveSeriesChange}
                  options={readingSeriesOptions}
                />
                <Text type="secondary">
                  {activeSeries
                    ? (activeSeries.start_date || activeSeries.end_date
                      ? `当前系列计划周期：${activeSeries.start_date || "未设置"} 至 ${activeSeries.end_date || "未设置"}`
                      : "当前系列未设置计划周期，日期不受限制。")
                    : "未选择系列，日期不受限制。"}
                </Text>
              </Space>
              <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                <Space wrap>
                  <Text strong>已选择 {selectedDates.length} 天</Text>
                  <Text type="secondary">已默认排除 {excludedDefaultCount} 天</Text>
                  <Text type="secondary">默认排除包含周末和法定节假日；调休上班日按工作日处理。</Text>
                </Space>
                <Space wrap>
                  <Button onClick={() => selectWorkdaysInMonth(dayjs())}>选择本月工作日</Button>
                  <Button onClick={() => selectWorkdaysInMonth(dayjs().add(1, "month"))}>选择下月工作日</Button>
                  <Button onClick={() => mergeDates(selectedDates.filter((dateText) => !isRestDay(dayjs(dateText))))}>排除休息日</Button>
                  <Button danger onClick={() => mergeDates([])}>清空已选</Button>
                </Space>
              </Space>
              <div style={{ maxWidth: 760, width: "100%" }}>
                <Space wrap style={{ justifyContent: "space-between", width: "100%", marginBottom: 8 }}>
                  <Space>
                    <Button size="small" onClick={() => setCalendarMonth((prev) => prev.subtract(1, "month"))}>
                      上月
                    </Button>
                    <Button size="small" onClick={() => setCalendarMonth(dayjs())}>
                      本月
                    </Button>
                    <Button size="small" onClick={() => setCalendarMonth((prev) => prev.add(1, "month"))}>
                      下月
                    </Button>
                  </Space>
                  <Space>
                    <Select
                      size="small"
                      style={{ width: 96 }}
                      value={calendarMonth.year()}
                      options={yearOptions}
                      onChange={(year) => setCalendarMonth((prev) => prev.year(year))}
                    />
                    <Select
                      size="small"
                      style={{ width: 84 }}
                      value={calendarMonth.month()}
                      options={MONTH_OPTIONS}
                      onChange={(month) => setCalendarMonth((prev) => prev.month(month))}
                    />
                  </Space>
                </Space>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  {WEEKDAY_LABELS.map((label) => (
                    <div
                      key={label}
                      style={{
                        textAlign: "center",
                        color: "var(--text-mute)",
                        fontSize: 12,
                        lineHeight: "22px",
                      }}
                    >
                      {label}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                    gap: 6,
                  }}
                >
                  {calendarCells.map((day) => {
                    const dateText = day.format("YYYY-MM-DD");
                    const selected = selectedDateSet.has(dateText);
                    const inMonth = day.isSame(calendarMonth, "month");
                    const today = day.isSame(dayjs(), "day");
                    const holidayInfo = getHolidayInfo(day);
                    const weekend = isWeekendLike(day);
                    const holiday = holidayInfo?.type === "holiday";
                    const adjustedWorkday = isAdjustedWorkday(day);
                    const disabledBySeries = !isDateAllowedByActiveSeries(dateText);
                    const muted = !inMonth || (weekend && !adjustedWorkday);
                    return (
                      <button
                        key={dateText}
                        type="button"
                        disabled={disabledBySeries}
                        onClick={() => toggleDate(day)}
                        style={{
                          minWidth: 0,
                          height: 48,
                          padding: "4px 5px",
                          borderRadius: 10,
                          border: today ? "1px solid #2563eb" : "1px solid #e5e7eb",
                          background: selected ? "#2563eb" : inMonth ? "#fff" : "#f8fafc",
                          color: selected ? "#fff" : disabledBySeries ? "#cbd5e1" : muted ? "#9ca3af" : "#111827",
                          cursor: disabledBySeries ? "not-allowed" : "pointer",
                          opacity: disabledBySeries ? 0.55 : 1,
                          textAlign: "left",
                          boxShadow: selected ? "0 6px 14px rgba(37, 99, 235, 0.18)" : "none",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                          <span style={{ fontWeight: selected ? 700 : 600, fontVariantNumeric: "tabular-nums" }}>
                            {day.format("DD")}
                          </span>
                          {holiday ? (
                            <span
                              style={{
                                borderRadius: 4,
                                padding: "0 4px",
                                fontSize: 11,
                                lineHeight: "16px",
                                color: selected ? "#fff" : "#b91c1c",
                                background: selected ? "rgba(255,255,255,0.18)" : "#fee2e2",
                              }}
                            >
                              休
                            </span>
                          ) : adjustedWorkday ? (
                            <span
                              style={{
                                borderRadius: 4,
                                padding: "0 4px",
                                fontSize: 11,
                                lineHeight: "16px",
                                color: selected ? "#fff" : "#1d4ed8",
                                background: selected ? "rgba(255,255,255,0.18)" : "#dbeafe",
                              }}
                            >
                              班
                            </span>
                          ) : weekend ? (
                            <span style={{ fontSize: 11, color: selected ? "rgba(255,255,255,0.78)" : "#9ca3af" }}>
                              周末
                            </span>
                          ) : null}
                        </div>
                        {holidayInfo?.name ? (
                          <div
                            style={{
                              marginTop: 3,
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              fontSize: 11,
                              color: selected ? "rgba(255,255,255,0.86)" : holiday ? "#b91c1c" : "#64748b",
                            }}
                          >
                            {holidayInfo.name}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Space wrap>
                <RangePicker locale={datePickerZhCN} value={rangeDates} onChange={setRangeDates} />
                <Button onClick={mergeRangeWorkdays}>按范围生成工作日</Button>
                <Text type="secondary">范围生成默认排除周末和法定节假日，生成后仍可在日历里单独增减。</Text>
              </Space>
              <Text type="secondary">
                已选日期：{selectedDates.slice(0, 8).join("、") || "暂无"}
                {selectedDates.length > 8 ? ` 等 ${selectedDates.length} 天` : ""}
              </Text>
            </Space>
          </Card>
        ) : null}

        <Card size="small" title="素材库图片搜索">
          <Input.Search
            placeholder="搜索素材库图片名称 / 项目名"
            value={materialKeyword}
            onChange={(e) => setMaterialKeyword(e.target.value)}
            onSearch={setMaterialKeyword}
          />
        </Card>

        {items.length ? items.map((item) => {
          const selectedAsset = materialAssets.find((asset) => asset.id === item.material_asset_id) || null;
          const usingSeriesTargets = hasInheritedSeriesTargets(item);
          return (
            <Card
              key={item.reading_date}
              size="small"
              title={item.reading_date}
              extra={mode === "create" ? (
                <Space>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => applyToAll(item.reading_date)}>
                    应用到全部日期
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeDate(item.reading_date)}>
                    移除
                  </Button>
                </Space>
              ) : null}
            >
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap style={{ width: "100%" }}>
                  <div style={{ minWidth: 220 }}>
                    <Text type="secondary">推送时间</Text>
                    <TimePicker
                      style={{ width: "100%", marginTop: 4 }}
                      value={item.push_time ? dayjs(`2000-01-01 ${item.push_time}`) : null}
                      format="HH:mm"
                      disabled={lockedEditing}
                      onChange={(value) => updateItem(item.reading_date, { push_time: value ? value.format("HH:mm:ss") : "" })}
                    />
                  </div>
                  <div style={{ minWidth: 280 }}>
                    <Text type="secondary">补卡截止时间</Text>
                    <DatePicker
                      locale={datePickerZhCN}
                      showTime
                      style={{ width: "100%", marginTop: 4 }}
                      value={item.makeup_deadline_at ? dayjs(item.makeup_deadline_at) : null}
                      format="YYYY-MM-DD HH:mm"
                      disabled={lockedEditing}
                      onChange={(value) => updateItem(item.reading_date, { makeup_deadline_at: value ? value.format("YYYY-MM-DD HH:mm:ss") : "" })}
                    />
                  </div>
                </Space>
                {mode === "create" ? (
                  <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                    <div style={{ minWidth: 260, flex: 1 }}>
                      <Text type="secondary">所属系列</Text>
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        style={{ width: "100%", marginTop: 4 }}
                        placeholder="未归属系列"
                        value={item.series_id || undefined}
                        disabled={lockedEditing}
                        onChange={(value) => handleItemSeriesChange(item, value || null)}
                        options={readingSeriesOptions}
                      />
                      <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                        当前：{getSeriesLabel(item)}
                      </Text>
                    </div>
                    <Button size="small" type="link" onClick={() => onCreateSeries?.()}>
                      新建系列
                    </Button>
                  </Space>
                ) : (
                  <Text type="secondary">所属系列：{getSeriesLabel(item)}</Text>
                )}
                <Input
                  placeholder="标题"
                  value={item.title}
                  disabled={lockedEditing}
                  onChange={(e) => updateItem(item.reading_date, { title: e.target.value })}
                />
                <Input.TextArea
                  rows={3}
                  placeholder="描述"
                  value={item.description}
                  disabled={lockedEditing}
                  onChange={(e) => updateItem(item.reading_date, { description: e.target.value })}
                />
                <Radio.Group
                  value={item.image_source}
                  disabled={lockedEditing}
                  onChange={(e) => updateItem(item.reading_date, { image_source: e.target.value, material_asset_id: null })}
                  options={[
                    { value: "upload", label: "上传新图片" },
                    { value: "material", label: "从素材库选择图片" },
                    { value: "url", label: "使用图片 URL" },
                  ]}
                />
                {item.image_source === "upload" ? (
                  <Space direction="vertical" size={8}>
                    <Upload
                      maxCount={1}
                      showUploadList={false}
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      disabled={lockedEditing}
                      beforeUpload={(file) => {
                        updateItem(item.reading_date, { image: file });
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />}>{item.image?.name || "选择图片"}</Button>
                    </Upload>
                    {item.image ? <Text type="secondary">已选择：{item.image.name}</Text> : null}
                    {!item.image && item.image_url ? <Image src={item.image_url} width={120} /> : null}
                  </Space>
                ) : item.image_source === "material" ? (
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="选择素材库中的图片素材"
                      value={item.material_asset_id}
                      disabled={lockedEditing}
                      onChange={(value) => updateItem(item.reading_date, { material_asset_id: value })}
                      options={materialAssets.map((asset) => ({
                        value: asset.id,
                        label: `${asset.name} / ${asset.project_name || "未分组"}`,
                      }))}
                    />
                    {selectedAsset ? (
                      <Space direction="vertical" size={6}>
                        <Image src={buildMaterialAssetPreviewUrl(selectedAsset.id)} width={140} />
                        <Text type="secondary">已选素材：{selectedAsset.name}</Text>
                      </Space>
                    ) : null}
                  </Space>
                ) : (
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Input
                      placeholder="输入图片 URL"
                      value={item.image_url}
                      disabled={lockedEditing}
                      onChange={(e) => updateItem(item.reading_date, { image_url: e.target.value })}
                    />
                    {item.image_url ? <Image src={item.image_url} width={140} /> : null}
                  </Space>
                )}
                {usingSeriesTargets ? (
                  <Alert
                    type="info"
                    showIcon
                    message="已继承系列默认派发对象"
                    description={`当前已按系列自动带出推送人群：${item.targets.some((target) => target.target_type === "all") ? "全部员工" : `${item.targets.length} 个对象`}。如需单独指定，请先清空所属系列。`}
                  />
                ) : (
                  <>
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <Text strong>最终派发对象</Text>
                      <Radio.Group
                        value={item.target_type}
                        disabled={lockedEditing}
                        onChange={(e) => updateItem(item.reading_date, {
                          target_type: e.target.value,
                          target_user_ids: [],
                          target_department_ids: [],
                          target_position_ids: [],
                          target_job_level_ids: [],
                          target_employment_status_ids: [],
                          targets: [],
                        })}
                        options={[
                          { value: "user", label: "指定员工" },
                          { value: "department", label: "按部门" },
                          { value: "position", label: "按岗位" },
                          { value: "job_level", label: "按职级" },
                          { value: "employment_status", label: "按在职状态" },
                          { value: "all", label: "全员" },
                          { value: "all_newcomers", label: "仅新人" },
                        ]}
                        optionType="button"
                      />
                    </Space>
                    {item.target_type === "user" ? (
                  <div style={{ width: "100%", minWidth: 0 }}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      style={{ width: "100%" }}
                      maxTagCount="responsive"
                      value={item.target_user_ids}
                      disabled={lockedEditing}
                      onChange={(value) => updateItem(item.reading_date, { target_user_ids: value, targets: [] })}
                      options={employeeOptions}
                      placeholder="选择员工"
                    />
                  </div>
                    ) : null}
                    {item.target_type === "department" ? (
                  <div style={{ width: "100%", minWidth: 0 }}>
                    <DepartmentUserTreeSelect
                      users={employeeUsers}
                      value={item.target_department_ids}
                      disabled={lockedEditing}
                      onChange={(value) => updateItem(item.reading_date, { target_department_ids: value, targets: [] })}
                      placeholder="选择部门会自动包含下级员工，可展开后取消个人"
                    />
                  </div>
                    ) : null}
                    {item.target_type === "position" ? (
                  <div style={{ width: "100%", minWidth: 0 }}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      style={{ width: "100%" }}
                      maxTagCount="responsive"
                      value={item.target_position_ids}
                      disabled={lockedEditing}
                      onChange={(value) => updateItem(item.reading_date, { target_position_ids: value, targets: [] })}
                      options={employeePositionOptions}
                      placeholder="选择岗位"
                    />
                  </div>
                    ) : null}
                    {item.target_type === "job_level" ? (
                  <div style={{ width: "100%", minWidth: 0 }}>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: "100%" }}
                      maxTagCount="responsive"
                      value={item.target_job_level_ids}
                      disabled={lockedEditing}
                      onChange={(value) => updateItem(item.reading_date, { target_job_level_ids: value, targets: [] })}
                      options={JOB_LEVEL_OPTIONS}
                      placeholder="选择 M线 / P线"
                    />
                  </div>
                    ) : null}
                    {item.target_type === "employment_status" ? (
                  <div style={{ width: "100%", minWidth: 0 }}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      style={{ width: "100%" }}
                      maxTagCount="responsive"
                      value={item.target_employment_status_ids}
                      disabled={lockedEditing || !employmentStatusOptions.length}
                      onChange={(value) => updateItem(item.reading_date, { target_employment_status_ids: value, targets: [] })}
                      options={employmentStatusOptions.map((value) => ({ value, label: value }))}
                      placeholder={employmentStatusOptions.length ? "选择在职状态" : "暂无可用在职状态"}
                    />
                  </div>
                    ) : null}
                  </>
                )}
              </Space>
            </Card>
          );
        }) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择日期，再按日期逐条配置读书内容" />
        )}
      </Space>
    </Modal>
  );
}
