import { Tag, Checkbox, Input, Radio } from "antd";
import dayjs from "dayjs";

export { multipartUploadToOss, logOssUploadError } from "../../lib/ossMultipart";

export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function saveBlob({ blob, filename }) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function getCurrentMonthText() {
  return dayjs().format("YYYY-MM");
}

export function getTodayText() {
  return dayjs().format("YYYY-MM-DD");
}

export function buildAudioCalendarMap(days) {
  return Object.fromEntries((Array.isArray(days) ? days : []).map((item) => [item.date, item]));
}

export function getAudioDayStatus(dateText, dayData) {
  const todayText = getTodayText();
  if (dateText > todayText) return "future";
  if (dayData?.uploaded) {
    return dateText === todayText ? "today_uploaded" : "uploaded";
  }
  return dateText === todayText ? "today_missing" : "missing";
}

export function renderAudioStatusTag(status, count = 0, uploadedUsers = 0) {
  if (status === "future") return <Tag bordered={false} color="default">未来</Tag>;
  if (status === "makeup_available") return <Tag bordered={false} color="processing">可补卡</Tag>;
  if (status === "makeup_expired") return <Tag bordered={false} color="default">已过期</Tag>;
  if (status === "today_uploaded") return <Tag bordered={false} color="success">今日已上传</Tag>;
  if (status === "today_missing") return <Tag bordered={false} color="error">今日未上传</Tag>;
  if (status === "uploaded") {
    return <Tag bordered={false} color="success">{uploadedUsers > 0 ? `已上传 ${uploadedUsers} 人` : `已上传${count > 1 ? ` ${count} 条` : ""}`}</Tag>;
  }
  return <Tag bordered={false} color="default">未上传</Tag>;
}

export function logMagicUploadStageError(stage, error) {
  console.error(`Magic video ${stage} failed`, {
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: error?.message,
    requestId: error?.requestId,
    hostId: error?.hostId,
    stack: error?.stack,
    error,
  });
}

export function targetsToOptions(users) {
  const departments = Array.from(new Set(users.map((item) => item.department).filter(Boolean)));
  const positions = Array.from(new Set(users.map((item) => item.position).filter(Boolean)));
  return { departments, positions };
}

export function buildVideoDispatchFormValues(targets) {
  const safeTargets = Array.isArray(targets) && targets.length
    ? targets
    : [{ target_type: "all_users", target_value: "" }];
  const departments = safeTargets
    .filter((item) => item.target_type === "department" && item.target_value)
    .map((item) => item.target_value);
  if (departments.length) {
    return {
      dispatch_mode: "department",
      target_user_ids: [],
      target_department_ids: departments,
      target_positions: [],
      target_job_levels: [],
      target_employment_statuses: [],
      newcomer_only: false,
    };
  }
  const positions = safeTargets
    .filter((item) => item.target_type === "position" && item.target_value)
    .map((item) => item.target_value);
  if (positions.length) {
    return {
      dispatch_mode: "position",
      target_user_ids: [],
      target_department_ids: [],
      target_positions: positions,
      target_job_levels: [],
      target_employment_statuses: [],
      newcomer_only: false,
    };
  }
  const jobLevels = safeTargets
    .filter((item) => item.target_type === "job_level" && item.target_value)
    .map((item) => item.target_value);
  if (jobLevels.length) {
    return {
      dispatch_mode: "job_level",
      target_user_ids: [],
      target_department_ids: [],
      target_positions: [],
      target_job_levels: jobLevels,
      target_employment_statuses: [],
      newcomer_only: false,
    };
  }
  const employmentStatuses = safeTargets
    .filter((item) => item.target_type === "employment_status" && item.target_value)
    .map((item) => item.target_value);
  if (employmentStatuses.length) {
    return {
      dispatch_mode: "employment_status",
      target_user_ids: [],
      target_department_ids: [],
      target_positions: [],
      target_job_levels: [],
      target_employment_statuses: employmentStatuses,
      newcomer_only: false,
    };
  }
  if (safeTargets.some((item) => item.target_type === "all_newcomers")) {
    return {
      dispatch_mode: "all",
      target_user_ids: [],
      target_department_ids: [],
      target_positions: [],
      target_job_levels: [],
      target_employment_statuses: [],
      newcomer_only: true,
    };
  }
  if (safeTargets.some((item) => item.target_type === "all_users")) {
    return {
      dispatch_mode: "all",
      target_user_ids: [],
      target_department_ids: [],
      target_positions: [],
      target_job_levels: [],
      target_employment_statuses: [],
      newcomer_only: false,
    };
  }
  return {
    dispatch_mode: "user",
    target_user_ids: safeTargets
      .filter((item) => item.target_type === "user" && item.target_value)
      .map((item) => String(item.target_value)),
    target_department_ids: [],
    target_positions: [],
    target_job_levels: [],
    target_employment_statuses: [],
    newcomer_only: false,
  };
}

export function buildVideoTargetsFromDispatch(values) {
  if (values.dispatch_mode === "department") {
    return (values.target_department_ids || []).map((item) => {
      const numericId = Number(item);
      if (Number.isFinite(numericId) && String(item || "").trim() !== "") {
        return {
          target_type: "user",
          target_value: String(numericId),
        };
      }
      return {
        target_type: "department",
        target_value: item,
      };
    });
  }
  if (values.dispatch_mode === "position") {
    return (values.target_positions || []).map((item) => ({
      target_type: "position",
      target_value: item,
    }));
  }
  if (values.dispatch_mode === "employment_status") {
    return (values.target_employment_statuses || []).map((item) => ({
      target_type: "employment_status",
      target_value: item,
    }));
  }
  if (values.dispatch_mode === "job_level") {
    return (values.target_job_levels || []).map((item) => ({
      target_type: "job_level",
      target_value: item,
    }));
  }
  if (values.dispatch_mode === "all") {
    return [{
      target_type: values.newcomer_only ? "all_newcomers" : "all_users",
      target_value: "",
    }];
  }
  return (values.target_user_ids || []).map((item) => ({
    target_type: "user",
    target_value: String(item),
  }));
}

export function buildReadingDispatchFormValues(targets) {
  const safeTargets = Array.isArray(targets) && targets.length
    ? targets
    : [{ target_type: "user", target_id: "" }];
  const departments = safeTargets
    .filter((item) => item.target_type === "department" && item.target_id)
    .map((item) => item.target_id);
  if (departments.length) {
    return {
      dispatch_mode: "department",
      target_user_ids: [],
      target_department_ids: departments,
      target_position_ids: [],
      target_job_level_ids: [],
      target_employment_status_ids: [],
      newcomer_only: false,
    };
  }
  const positions = safeTargets
    .filter((item) => item.target_type === "position" && item.target_id)
    .map((item) => item.target_id);
  if (positions.length) {
    return {
      dispatch_mode: "position",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: positions,
      target_job_level_ids: [],
      target_employment_status_ids: [],
      newcomer_only: false,
    };
  }
  const jobLevels = safeTargets
    .filter((item) => item.target_type === "job_level" && item.target_id)
    .map((item) => item.target_id);
  if (jobLevels.length) {
    return {
      dispatch_mode: "job_level",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: [],
      target_job_level_ids: jobLevels,
      target_employment_status_ids: [],
      newcomer_only: false,
    };
  }
  const employmentStatuses = safeTargets
    .filter((item) => item.target_type === "employment_status" && item.target_id)
    .map((item) => item.target_id);
  if (employmentStatuses.length) {
    return {
      dispatch_mode: "employment_status",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: [],
      target_job_level_ids: [],
      target_employment_status_ids: employmentStatuses,
      newcomer_only: false,
    };
  }
  if (safeTargets.some((item) => item.target_type === "all_newcomers")) {
    return {
      dispatch_mode: "all",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: [],
      target_job_level_ids: [],
      target_employment_status_ids: [],
      newcomer_only: true,
    };
  }
  if (safeTargets.some((item) => item.target_type === "all")) {
    return {
      dispatch_mode: "all",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: [],
      target_job_level_ids: [],
      target_employment_status_ids: [],
      newcomer_only: false,
    };
  }
  return {
    dispatch_mode: "user",
    target_user_ids: safeTargets
      .filter((item) => item.target_type === "user" && item.target_id)
      .map((item) => Number(item.target_id)),
    target_department_ids: [],
    target_position_ids: [],
    target_job_level_ids: [],
    target_employment_status_ids: [],
    newcomer_only: false,
  };
}

export function buildReadingDispatchPayload(values) {
  if (values.dispatch_mode === "department") {
    const userIds = (values.target_department_ids || [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
    if (userIds.length) {
      return {
        target_type: "user",
        target_user_ids: userIds,
        target_department_ids: [],
        target_position_ids: [],
        target_job_level_ids: [],
        target_employment_status_ids: [],
      };
    }
    return {
      target_type: "department",
      target_user_ids: [],
      target_department_ids: values.target_department_ids || [],
      target_position_ids: [],
      target_job_level_ids: [],
      target_employment_status_ids: [],
    };
  }
  if (values.dispatch_mode === "position") {
    return {
      target_type: "position",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: values.target_position_ids || [],
      target_job_level_ids: [],
      target_employment_status_ids: [],
    };
  }
  if (values.dispatch_mode === "employment_status") {
    return {
      target_type: "employment_status",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: [],
      target_job_level_ids: [],
      target_employment_status_ids: values.target_employment_status_ids || [],
    };
  }
  if (values.dispatch_mode === "job_level") {
    return {
      target_type: "job_level",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: [],
      target_job_level_ids: values.target_job_level_ids || [],
      target_employment_status_ids: [],
    };
  }
  if (values.dispatch_mode === "all") {
    return {
      target_type: values.newcomer_only ? "all_newcomers" : "all",
      target_user_ids: [],
      target_department_ids: [],
      target_position_ids: [],
      target_job_level_ids: [],
      target_employment_status_ids: [],
    };
  }
  return {
    target_type: "user",
    target_user_ids: values.target_user_ids || [],
    target_department_ids: [],
    target_position_ids: [],
    target_job_level_ids: [],
    target_employment_status_ids: [],
  };
}

export const QUESTION_TYPE_OPTIONS = [
  { value: "single", label: "单选" },
  { value: "multiple", label: "多选" },
  { value: "judge", label: "判断" },
  { value: "fill", label: "填空" },
  { value: "short", label: "简答" },
];

export const QUESTION_TYPE_LABELS = Object.fromEntries(
  QUESTION_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);

export const UNASSIGNED_DEPARTMENT_FILTER = "__UNASSIGNED__";

const VIDEO_STATUS_META = {
  draft: { label: "草稿", color: "default" },
  uploading: { label: "上传中", color: "processing" },
  uploaded: { label: "已上传未发布", color: "blue" },
  published: { label: "已发布", color: "success" },
  failed: { label: "上传失败", color: "error" },
  offline: { label: "已下架", color: "default" },
  disabled: { label: "已停用", color: "default" },
};

export function getVideoStatusMeta(videoOrStatus, uploadStatus) {
  if (videoOrStatus && typeof videoOrStatus === "object") {
    const status = videoOrStatus.status || "draft";
    const statusLabel = videoOrStatus.status_label;
    if (statusLabel) {
      return {
        label: statusLabel,
        color: VIDEO_STATUS_META[status]?.color || "default",
      };
    }
    return getVideoStatusMeta(status, videoOrStatus.upload_status);
  }
  if (uploadStatus === "failed") return VIDEO_STATUS_META.failed;
  if (uploadStatus && uploadStatus !== "completed") return VIDEO_STATUS_META.uploading;
  if (videoOrStatus === "published") return VIDEO_STATUS_META.published;
  if (videoOrStatus === "disabled") return VIDEO_STATUS_META.disabled;
  if (uploadStatus === "completed" && videoOrStatus === "draft") return VIDEO_STATUS_META.uploaded;
  return VIDEO_STATUS_META[videoOrStatus] || { label: videoOrStatus || "草稿", color: "default" };
}

export function buildSeriesSections(videos) {
  const seriesMap = new Map();
  const standalone = [];
  (Array.isArray(videos) ? videos : []).forEach((item) => {
    if (item.series_id) {
      const key = String(item.series_id);
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          key,
          seriesId: item.series_id,
          title: item.series_title || "未命名系列",
          description: item.series_description || "",
          sequentialUnlockEnabled: !!item.sequential_unlock_enabled,
          items: [],
        });
      }
      seriesMap.get(key).items.push(item);
      return;
    }
    standalone.push(item);
  });
  const seriesSections = Array.from(seriesMap.values()).map((section) => ({
    ...section,
    items: section.items.sort((a, b) => Number(a.series_order || 0) - Number(b.series_order || 0)),
  }));
  standalone.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  return { seriesSections, standalone };
}

export function getVideoSourceLabel(item, revealWhitelist = false) {
  const source = item?.progress?.source || "";
  if (source === "whitelist_exempt") return revealWhitelist ? "白名单豁免" : "";
  return "";
}

export function getAudioSourceMeta(source, revealWhitelist = false) {
  if (source === "makeup") return { label: "补卡", color: "processing" };
  if (source === "whitelist_auto") {
    return revealWhitelist
      ? { label: "白名单自动", color: "purple" }
      : { label: "用户上传", color: "success" };
  }
  return { label: "用户上传", color: "success" };
}

export function getReadingTargetSummary(content) {
  const targets = Array.isArray(content?.targets) ? content.targets : [];
  if (targets.some((item) => item.target_type === "all")) return "全部员工";
  if (targets.some((item) => item.target_type === "all_newcomers")) return "仅新人";
  const departments = targets.filter((item) => item.target_type === "department").map((item) => item.target_id).filter(Boolean);
  if (departments.length) return `部门：${departments.join("、")}`;
  const positions = targets.filter((item) => item.target_type === "position").map((item) => item.target_id).filter(Boolean);
  if (positions.length) return `岗位：${positions.join("、")}`;
  const jobLevels = targets.filter((item) => item.target_type === "job_level").map((item) => item.target_id).filter(Boolean);
  if (jobLevels.length) return `职级：${jobLevels.join("、")}`;
  const users = targets.filter((item) => item.target_type === "user");
  if (users.length) return `指定员工 ${users.length} 人`;
  return "未设置";
}

export function normalizeQuestionType(value) {
  if (value === "blank") return "fill";
  if (value === "short_answer") return "short";
  return value || "single";
}

function toApiQuestionType(value) {
  if (value === "fill") return "blank";
  if (value === "short") return "short_answer";
  return value || "single";
}

function normalizeStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed !== text) return normalizeStringList(parsed);
  } catch {
    // Ignore old non-JSON values and continue with fallback parsing.
  }
  if (text.includes("\n")) {
    return text.split("\n").map((item) => item.trim()).filter(Boolean);
  }
  if (text.includes(",") || text.includes("，")) {
    return text.replaceAll("，", ",").split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [text];
}

function buildOptionItems(values, minCount = 0) {
  const items = normalizeStringList(values).map((item) => ({ value: item }));
  while (items.length < minCount) items.push({ value: "" });
  return items;
}

function buildAnswerItems(values, minCount = 0) {
  const items = normalizeStringList(values).map((item) => ({ value: item }));
  while (items.length < minCount) items.push({ value: "" });
  return items;
}

function resolveCorrectIndexes(options, correctAnswers, multiple = false) {
  const optionTexts = normalizeStringList(options);
  const answers = normalizeStringList(correctAnswers);
  const matchedIndexes = answers.map((answer) => {
    const numericIndex = Number(answer);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < optionTexts.length) {
      return numericIndex;
    }
    return optionTexts.findIndex((item) => item === answer);
  }).filter((index) => index >= 0);
  const uniqueIndexes = Array.from(new Set(matchedIndexes));
  if (multiple) return uniqueIndexes;
  return uniqueIndexes[0];
}

export function buildQuestionFormValues(editing) {
  const questionType = normalizeQuestionType(editing?.question_type || "single");
  const options = normalizeStringList(editing?.options);
  const correctAnswers = normalizeStringList(editing?.correct_answers);

  if (questionType === "judge") {
    const judgeOptions = buildOptionItems(options.length ? options.slice(0, 2) : ["正确", "错误"], 2).slice(0, 2);
    return {
      question_type: questionType,
      stem: editing?.stem || "",
      options: judgeOptions,
      correct_indexes: resolveCorrectIndexes(judgeOptions.map((item) => item.value), correctAnswers, false),
      correct_answers: [],
      reference_answer: "",
    };
  }

  if (questionType === "fill") {
    return {
      question_type: questionType,
      stem: editing?.stem || "",
      options: [],
      correct_indexes: [],
      correct_answers: buildAnswerItems(correctAnswers, 1),
      reference_answer: "",
    };
  }

  if (questionType === "short") {
    return {
      question_type: questionType,
      stem: editing?.stem || "",
      options: [],
      correct_indexes: [],
      correct_answers: [],
      reference_answer: correctAnswers[0] || "",
    };
  }

  const choiceOptions = buildOptionItems(options, 4);
  return {
    question_type: questionType,
    stem: editing?.stem || "",
    options: choiceOptions,
    correct_indexes: resolveCorrectIndexes(
      choiceOptions.map((item) => item.value),
      correctAnswers,
      questionType === "multiple",
    ),
    correct_answers: [],
    reference_answer: "",
  };
}

export function applyQuestionTypeDefaults(form, questionType) {
  if (questionType === "judge") {
    form.setFieldsValue({
      options: [{ value: "正确" }, { value: "错误" }],
      correct_indexes: undefined,
      correct_answers: [],
      reference_answer: "",
    });
    return;
  }
  if (questionType === "fill") {
    form.setFieldsValue({
      options: [],
      correct_indexes: [],
      correct_answers: [{ value: "" }],
      reference_answer: "",
    });
    return;
  }
  if (questionType === "short") {
    form.setFieldsValue({
      options: [],
      correct_indexes: [],
      correct_answers: [],
      reference_answer: "",
    });
    return;
  }
  form.setFieldsValue({
    options: [{ value: "" }, { value: "" }, { value: "" }, { value: "" }],
    correct_indexes: questionType === "multiple" ? [] : undefined,
    correct_answers: [],
    reference_answer: "",
  });
}

export function buildQuestionPayload(values, editing) {
  const questionType = normalizeQuestionType(values.question_type);
  const stem = String(values.stem || "").trim();
  if (!stem) throw new Error("请输入题目内容。");

  const optionTexts = (values.options || []).map((item) => String(item?.value || "").trim());
  const answerTexts = (values.correct_answers || []).map((item) => String(item?.value || "").trim()).filter(Boolean);
  let options = [];
  let correctAnswers = [];

  if (questionType === "single" || questionType === "multiple" || questionType === "judge") {
    if ((questionType === "judge" && optionTexts.length !== 2) || (questionType !== "judge" && optionTexts.length < 2)) {
      throw new Error(questionType === "judge" ? "判断题必须保留两个选项。" : "请至少保留两个选项。");
    }
    if (optionTexts.some((item) => !item)) {
      throw new Error("请填写完整的选项内容。");
    }
    options = questionType === "judge" ? optionTexts.slice(0, 2) : optionTexts;
    if (questionType === "multiple") {
      const selectedIndexes = Array.isArray(values.correct_indexes) ? values.correct_indexes.map((item) => Number(item)) : [];
      correctAnswers = selectedIndexes
        .filter((index) => Number.isInteger(index) && index >= 0 && index < options.length)
        .map((index) => options[index]);
      if (!correctAnswers.length) throw new Error("请至少选择一个正确答案。");
    } else {
      const selectedIndex = Number(values.correct_indexes);
      if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
        throw new Error("请选择正确答案。");
      }
      correctAnswers = [options[selectedIndex]];
    }
  } else if (questionType === "fill") {
    if (!answerTexts.length) throw new Error("请至少填写一个正确答案。");
    correctAnswers = answerTexts;
  } else if (questionType === "short") {
    const referenceAnswer = String(values.reference_answer || "").trim();
    correctAnswers = referenceAnswer ? [referenceAnswer] : [];
  }

  return {
    question_type: toApiQuestionType(questionType),
    stem,
    options,
    correct_answers: correctAnswers,
    score: Number(editing?.score || 1),
    sort_order: Number(editing?.sort_order || 0),
    is_required: editing?.is_required ?? true,
  };
}

export function renderQuestionAnswer(question, value, onChange) {
  const questionType = normalizeQuestionType(question.question_type);
  if (questionType === "single") {
    return <Radio.Group value={value} onChange={(e) => onChange(e.target.value)} options={(question.options || []).map((item) => ({ value: item, label: item }))} />;
  }
  if (questionType === "multiple") {
    return <Checkbox.Group value={value || []} onChange={onChange} options={(question.options || []).map((item) => ({ value: item, label: item }))} />;
  }
  if (questionType === "judge") {
    const judgeOptions = (question.options || []).length ? question.options : ["正确", "错误"];
    return <Radio.Group value={value} onChange={(e) => onChange(e.target.value)} options={judgeOptions.map((item) => ({ value: item, label: item }))} />;
  }
  if (questionType === "fill") {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="请输入答案" />;
  }
  return <Input.TextArea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder="请输入简答内容" />;
}
