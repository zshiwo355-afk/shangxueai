import dayjs from "dayjs";

export function getDefaultAdminTab(section) {
  return section === "reading" ? "reading_contents" : "video_manage";
}

export function normalizeSeriesTargetsFromForm(values) {
  if (values.target_all) return [{ target_type: "all", target_id: null }];
  return [
    ...(values.target_department_ids || []).map((item) => {
      const numericId = Number(item);
      if (Number.isFinite(numericId) && String(item || "").trim() !== "") {
        return { target_type: "user", target_id: numericId };
      }
      return { target_type: "department", target_id: item };
    }),
    ...(values.target_position_ids || []).map((item) => ({ target_type: "position", target_id: item })),
    ...(values.target_job_level_ids || []).map((item) => ({ target_type: "job_level", target_id: item })),
    ...(values.target_employment_status_ids || []).map((item) => ({ target_type: "employment_status", target_id: item })),
    ...(values.target_user_ids || []).map((item) => ({ target_type: "user", target_id: item })),
  ];
}

export function buildSeriesTargetFormValues(targets = []) {
  return {
    target_all: targets.some((item) => item.target_type === "all"),
    target_department_ids: targets.filter((item) => item.target_type === "department").map((item) => item.target_id),
    target_position_ids: targets.filter((item) => item.target_type === "position").map((item) => item.target_id),
    target_job_level_ids: targets.filter((item) => item.target_type === "job_level").map((item) => item.target_id),
    target_employment_status_ids: targets.filter((item) => item.target_type === "employment_status").map((item) => item.target_id),
    target_user_ids: targets.filter((item) => item.target_type === "user").map((item) => Number(item.target_id)).filter(Boolean),
  };
}

export function getSeriesTargetSummary(targets = []) {
  if (!targets.length) return "未设置";
  if (targets.some((item) => item.target_type === "all")) return "全部员工";
  const departments = targets.filter((item) => item.target_type === "department");
  const positions = targets.filter((item) => item.target_type === "position");
  const jobLevels = targets.filter((item) => item.target_type === "job_level");
  const employmentStatuses = targets.filter((item) => item.target_type === "employment_status");
  const users = targets.filter((item) => item.target_type === "user");
  const parts = [];
  if (departments.length) parts.push(`部门 ${departments.length} 个`);
  if (positions.length) parts.push(`岗位 ${positions.length} 个`);
  if (jobLevels.length) parts.push(`职级 ${jobLevels.map((item) => item.target_id).join("、")}`);
  if (employmentStatuses.length) parts.push(`在职状态 ${employmentStatuses.length} 个`);
  if (users.length) parts.push(`人员 ${users.length} 人`);
  return parts.join("、") || "未设置";
}

export function isReadingDateOutOfRange(readingDate, startDate, endDate) {
  const current = dayjs(readingDate);
  if (startDate && current.isBefore(dayjs(startDate), "day")) return true;
  if (endDate && current.isAfter(dayjs(endDate), "day")) return true;
  return false;
}

export function isSamePrimitiveArray(left = [], right = []) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}
