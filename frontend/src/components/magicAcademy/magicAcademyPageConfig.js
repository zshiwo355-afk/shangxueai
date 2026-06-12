export const ADMIN_SECTION_TABS = {
  courses: ["video_manage", "quiz", "series", "stats"],
  reading: ["reading_contents", "reading_series", "audio_stats", "audio_transcribe"],
};

export const READING_SERIES_STATUS_OPTIONS = [
  { value: "draft", label: "草稿" },
  { value: "active", label: "启用" },
  { value: "paused", label: "暂停" },
  { value: "archived", label: "已归档" },
];

export const READING_SERIES_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  ...READING_SERIES_STATUS_OPTIONS,
];

export const READING_SERIES_STATUS_META = {
  draft: { label: "草稿", color: "default" },
  active: { label: "启用", color: "success" },
  paused: { label: "暂停", color: "warning" },
  archived: { label: "已归档", color: "default" },
};

export const AUDIO_EXPORT_DEFAULT_COLUMNS = [
  "reading_content_id",
  "reading_date",
  "push_time",
  "title",
  "target_summary",
  "employee_name",
  "department",
  "position",
  "should_complete",
  "is_completed",
  "uploaded_at",
  "is_makeup",
  "makeup_deadline",
  "current_status",
];

export const AUDIO_EXPORT_EMPLOYEE_COLUMNS = [
  "employee_id",
  "employee_name",
  "department",
  "position",
  "should_complete",
  "is_completed",
  "uploaded_at",
  "is_makeup",
  "current_status",
];

export const AUDIO_EXPORT_STAT_COLUMNS = [
  "reading_content_id",
  "series_name",
  "reading_date",
  "push_time",
  "title",
  "target_summary",
  "pushed_count",
  "completion_rate",
  "makeup_deadline",
  "content_status",
];

export const AUDIO_EXPORT_FIELD_GROUPS = [
  {
    key: "content",
    title: "读书内容信息",
    fields: [
      { key: "reading_content_id", label: "读书内容ID" },
      { key: "series_name", label: "所属系列" },
      { key: "reading_date", label: "读书日期" },
      { key: "push_time", label: "推送时间" },
      { key: "title", label: "标题" },
      { key: "target_summary", label: "推送对象" },
      { key: "pushed_count", label: "推送人数" },
      { key: "completion_rate", label: "完成率" },
      { key: "makeup_deadline", label: "补卡截止时间" },
      { key: "content_status", label: "内容状态" },
      { key: "created_by_name", label: "创建人" },
      { key: "created_at", label: "创建时间" },
    ],
  },
  {
    key: "employee",
    title: "员工信息",
    fields: [
      { key: "employee_id", label: "员工ID" },
      { key: "employee_name", label: "员工姓名" },
      { key: "department", label: "部门" },
      { key: "position", label: "岗位" },
    ],
  },
  {
    key: "status",
    title: "打卡状态",
    fields: [
      { key: "should_complete", label: "是否应完成" },
      { key: "is_completed", label: "是否完成" },
      { key: "uploaded_at", label: "上传时间" },
      { key: "is_makeup", label: "是否补卡" },
      { key: "current_status", label: "当前状态" },
    ],
  },
];
