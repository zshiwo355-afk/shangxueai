import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  BookOutlined,
  CalendarOutlined,
  DownOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  LockOutlined,
  PlayCircleFilled,
  PlusOutlined,
  ReadOutlined,
  RightOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Calendar,
  Card,
  Checkbox,
  Empty,
  Form,
  DatePicker,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  buildMagicVideoStreamUrl,
  completeMagicVideoUpload,
  completeMagicVideoReplaceUpload,
  createMagicVideo,
  createMagicQuestion,
  createMagicQuizPoint,
  createMagicVideoSeries,
  createMagicWatchConfirmLog,
  createMagicWhitelist,
  createAdminReadingContent,
  deleteMagicQuestion,
  deleteMagicQuizPoint,
  deleteAdminReadingContent,
  deleteMagicVideo,
  deleteMagicVideoSeries,
  deleteMagicWhitelist,
  deleteMyAudio,
  disableMagicVideo,
  downloadMagicFile,
  failMagicVideoUpload,
  failMagicVideoReplaceUpload,
  fetchAdminAudioCalendar,
  fetchAdminReadingContentDetail,
  fetchAdminReadingContents,
  fetchMagicAudioMakeupSetting,
  fetchMagicAudioStats,
  fetchMagicWatchConfirmSetting,
  fetchMyReadingContents,
  fetchMyAudioMakeupOptions,
  fetchMagicVideoAnswers,
  fetchMagicVideoStats,
  fetchMyAudioCalendar,
  fetchMyAudios,
  fetchMyMagicVideoDetail,
  fetchMyMagicVideos,
  initMagicVideoUpload,
  initMagicVideoReplaceUpload,
  listMagicVideoSeries,
  listMagicQuizPoints,
  listMagicVideos,
  listMagicWhitelist,
  publishMagicVideo,
  reorderMagicVideoSeriesItems,
  removeMagicVideoSeriesItem,
  saveMyMagicVideoProgress,
  submitMyMagicQuiz,
  submitMyAudioMakeup,
  updateMagicVideoSeries,
  updateAdminReadingContent,
  updateMagicAudioMakeupSetting,
  updateMagicWatchConfirmSetting,
  updateMagicQuestion,
  updateMagicQuizPoint,
  updateMagicVideo,
  uploadMyAudio,
  addMagicVideoSeriesItem,
} from "../lib/api.magic";
import { adminListUsers } from "../lib/api.admin";
import { buildMaterialAssetPreviewUrl, listAllMaterialAssets } from "../lib/api.materials";
import { getCurrentUser, isAdmin, isSuperAdmin } from "../lib/auth";

const { Title, Text, Paragraph } = Typography;

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function saveBlob({ blob, filename }) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function getCurrentMonthText() {
  return dayjs().format("YYYY-MM");
}

function getTodayText() {
  return dayjs().format("YYYY-MM-DD");
}

function buildAudioCalendarMap(days) {
  return Object.fromEntries((Array.isArray(days) ? days : []).map((item) => [item.date, item]));
}

function getAudioDayStatus(dateText, dayData) {
  const todayText = getTodayText();
  if (dateText > todayText) return "future";
  if (dayData?.uploaded) {
    return dateText === todayText ? "today_uploaded" : "uploaded";
  }
  return dateText === todayText ? "today_missing" : "missing";
}

function renderAudioStatusTag(status, count = 0, uploadedUsers = 0) {
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

function logOssUploadError(error) {
  console.error("Magic video OSS multipart upload error", {
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

function logMagicUploadStageError(stage, error) {
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

function uploadOssPart({ url, blob, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag");
        if (!etag) {
          reject(new Error("OSS 分片上传成功，但未返回 ETag。"));
          return;
        }
        resolve(etag.replaceAll("\"", ""));
        return;
      }
      reject(new Error(`OSS 分片上传失败（HTTP ${xhr.status}）。`));
    };
    xhr.onerror = () => reject(new Error("OSS 分片上传网络异常。"));
    xhr.send(blob);
  });
}

async function uploadOssPartWithRetry(task, retryCount = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("OSS 分片上传失败。");
}

async function multipartUploadToOss(file, uploadPlan, onPercentChange) {
  const uploadedParts = [];
  let committedBytes = 0;
  for (const part of uploadPlan.part_urls || []) {
    const start = (part.part_number - 1) * uploadPlan.part_size;
    const end = Math.min(start + uploadPlan.part_size, file.size);
    const blob = file.slice(start, end);
    const etag = await uploadOssPartWithRetry(() => (
      uploadOssPart({
        url: part.url,
        blob,
        onProgress: (loaded) => {
          const current = committedBytes + loaded;
          const percent = Math.min(99, Math.round((current / file.size) * 100));
          onPercentChange?.(percent);
        },
      })
    ));
    committedBytes += blob.size;
    onPercentChange?.(Math.min(99, Math.round((committedBytes / file.size) * 100)));
    uploadedParts.push({ part_number: part.part_number, etag });
  }
  return uploadedParts;
}

function targetsToOptions(users) {
  const departments = Array.from(new Set(users.map((item) => item.department).filter(Boolean)));
  const positions = Array.from(new Set(users.map((item) => item.position).filter(Boolean)));
  return { departments, positions };
}

const QUESTION_TYPE_OPTIONS = [
  { value: "single", label: "单选" },
  { value: "multiple", label: "多选" },
  { value: "judge", label: "判断" },
  { value: "fill", label: "填空" },
  { value: "short", label: "简答" },
];

const QUESTION_TYPE_LABELS = Object.fromEntries(
  QUESTION_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);
const UNASSIGNED_DEPARTMENT_FILTER = "__UNASSIGNED__";

const VIDEO_STATUS_META = {
  draft: { label: "草稿", color: "default" },
  uploading: { label: "上传中", color: "processing" },
  uploaded: { label: "已上传未发布", color: "blue" },
  published: { label: "已发布", color: "success" },
  failed: { label: "上传失败", color: "error" },
  offline: { label: "已下架", color: "default" },
  disabled: { label: "已下架", color: "default" },
};

function getVideoStatusMeta(videoOrStatus, uploadStatus) {
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

function buildSeriesSections(videos) {
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

function getVideoSourceLabel(item) {
  const source = item?.progress?.source || "";
  if (source === "whitelist_exempt") return "白名单豁免";
  return "";
}

function getAudioSourceMeta(source) {
  if (source === "makeup") return { label: "补卡", color: "processing" };
  if (source === "whitelist_auto") return { label: "白名单自动", color: "purple" };
  return { label: "用户上传", color: "success" };
}

function getReadingTargetSummary(content) {
  const targets = Array.isArray(content?.targets) ? content.targets : [];
  if (targets.some((item) => item.target_type === "all")) return "全部员工";
  const departments = targets.filter((item) => item.target_type === "department").map((item) => item.target_id).filter(Boolean);
  if (departments.length) return `部门：${departments.join("、")}`;
  const users = targets.filter((item) => item.target_type === "user");
  if (users.length) return `指定员工 ${users.length} 人`;
  return "未设置";
}

function normalizeQuestionType(value) {
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

function buildQuestionFormValues(editing) {
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

function applyQuestionTypeDefaults(form, questionType) {
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

function buildQuestionPayload(values, editing) {
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

function VideoFormModal({ open, onCancel, onSubmit, editing, users, submitting, uploadProgress }) {
  const [form] = Form.useForm();
  const [uploadMeta, setUploadMeta] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [materialAssets, setMaterialAssets] = useState([]);
  const [materialKeyword, setMaterialKeyword] = useState("");
  const { message } = AntdApp.useApp();
  const optionSource = useMemo(() => targetsToOptions(users), [users]);
  const videoSource = Form.useWatch("video_source", form) || "upload";
  const materialAssetId = Form.useWatch("material_asset_id", form);
  const selectedMaterialAsset = useMemo(
    () => materialAssets.find((item) => item.id === materialAssetId) || null,
    [materialAssets, materialAssetId],
  );

  const fillVideoForm = () => {
    if (!editing) {
      form.resetFields();
      form.setFieldsValue({
        title: "",
        description: "",
        category: "",
        is_required: false,
        is_newcomer_required: false,
        duration_seconds: undefined,
        status: "draft",
        video_source: "upload",
        material_asset_id: undefined,
        targets: [{ target_type: "all_users", target_value: "" }],
      });
      setUploadMeta(null);
      setSelectedFile(null);
      return;
    }

    const currentTargets = editing?.targets || [{ target_type: "all_users", target_value: "" }];
    const values = {
      title: editing?.title || "",
      description: editing?.description || "",
      category: editing?.category || "",
      is_required: !!editing?.is_required,
      is_newcomer_required: !!editing?.is_newcomer_required,
      duration_seconds: editing?.duration_seconds || editing?.duration || undefined,
      status: editing?.status || "draft",
      video_source: "upload",
      material_asset_id: editing?.material_asset_id || undefined,
      targets: currentTargets.length ? currentTargets : [{ target_type: "all_users", target_value: "" }],
    };
    console.log("edit video record:", editing);
    console.log("set edit video form values:", values);
    form.resetFields();
    form.setFieldsValue(values);
    window.setTimeout(() => {
      console.log("video form values after set:", form.getFieldsValue());
    }, 0);
    setUploadMeta({
      file_name: editing.file_name,
      file_path: editing.file_path,
      mime_type: editing.mime_type,
      file_size: editing.file_size,
      duration_seconds: editing.duration_seconds || 0,
      original_filename: editing.original_filename || editing.file_name,
    });
    setSelectedFile(null);
  };

  useEffect(() => {
    if (!open || editing || videoSource !== "material") return;
    listAllMaterialAssets({ asset_type: "video", keyword: materialKeyword })
      .then((data) => setMaterialAssets(Array.isArray(data) ? data : []))
      .catch((error) => message.error(error?.message || "素材库视频加载失败。"));
  }, [editing, materialKeyword, message, open, videoSource]);

  useEffect(() => {
    if (!open || editing) return;
    if (videoSource === "upload") {
      form.setFieldValue("material_asset_id", undefined);
      return;
    }
    setSelectedFile(null);
    if (selectedMaterialAsset) {
      if (!String(form.getFieldValue("title") || "").trim()) {
        form.setFieldValue("title", selectedMaterialAsset.name || selectedMaterialAsset.file_name || "");
      }
      if (!form.getFieldValue("duration_seconds") && Number(selectedMaterialAsset.duration_seconds || 0) > 0) {
        form.setFieldValue("duration_seconds", Number(selectedMaterialAsset.duration_seconds || 0));
      }
    }
  }, [editing, form, open, selectedMaterialAsset, videoSource]);

  const handleOk = async () => {
    const values = await form.validateFields();
    if (!editing?.id && values.video_source === "upload" && !selectedFile) {
      message.error("请先上传视频文件。");
      return;
    }
    if (!editing?.id && values.video_source === "material" && !values.material_asset_id) {
      message.error("请选择素材库视频。");
      return;
    }
    const payload = {
      title: values.title,
      description: values.description || "",
      category: values.category || "",
      video_source: values.video_source || "upload",
      material_asset_id: values.material_asset_id || null,
      file_name: uploadMeta?.file_name,
      file_path: uploadMeta?.file_path,
      mime_type: selectedFile?.type || uploadMeta?.mime_type,
      file_size: selectedFile?.size || uploadMeta?.file_size || 0,
      duration_seconds: Number(values.duration_seconds || uploadMeta?.duration_seconds || 0),
      is_required: !!values.is_required,
      is_newcomer_required: !!values.is_newcomer_required,
      status: values.status,
      targets: (values.targets || []).map((item) => ({
        target_type: item.target_type,
        target_value: item.target_value || "",
      })),
      original_filename: selectedFile?.name || uploadMeta?.original_filename || uploadMeta?.file_name,
      selected_file: selectedFile,
    };
    await onSubmit(payload);
  };

  const targetValueInput = (field) => {
    const type = form.getFieldValue(["targets", field.name, "target_type"]);
    if (type === "user") {
      return (
        <Select
          showSearch
          optionFilterProp="label"
          options={users.filter((item) => item.role === "user").map((item) => ({
            value: String(item.id),
            label: `${item.real_name || item.display_name || item.username} (${item.username})`,
          }))}
        />
      );
    }
    if (type === "department") {
      return <Select allowClear options={optionSource.departments.map((item) => ({ value: item, label: item }))} />;
    }
    if (type === "position") {
      return <Select allowClear options={optionSource.positions.map((item) => ({ value: item, label: item }))} />;
    }
    if (type === "role") {
      return <Select options={[{ value: "user", label: "普通员工" }, { value: "admin", label: "管理员" }]} />;
    }
    return <Input disabled placeholder="该类型不需要填写值" />;
  };

  return (
    <Modal
      open={open}
      title={editing ? "编辑视频" : "新建视频"}
      onCancel={onCancel}
      onOk={handleOk}
      width={860}
      okText={submitting ? `上传中 ${uploadProgress}%` : "保存"}
      okButtonProps={{ disabled: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      confirmLoading={submitting}
      afterOpenChange={(nextOpen) => {
        if (nextOpen) fillVideoForm();
      }}
      destroyOnHidden={false}
      forceRender
    >
      <Form form={form} layout="vertical">
        <Form.Item label="视频标题" name="title" rules={[{ required: true, message: "请输入视频标题" }]}>
          <Input placeholder="例如：新人必看 - 品牌介绍" />
        </Form.Item>
        <Form.Item label="视频简介" name="description">
          <Input.TextArea rows={3} placeholder="选填" />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item label="视频分类" name="category" style={{ minWidth: 220 }}>
            <Input placeholder="例如：新人培训" />
          </Form.Item>
          <Form.Item label="状态" name="status" style={{ minWidth: 220 }}>
            <Select options={[{ value: "draft", label: "草稿" }, { value: "published", label: "已发布" }, { value: "disabled", label: "停用" }]} />
          </Form.Item>
        </Space>
        {!editing ? (
          <Form.Item label="视频来源" name="video_source">
            <Radio.Group
              options={[
                { value: "upload", label: "上传新视频" },
                { value: "material", label: "从素材库选择" },
              ]}
            />
          </Form.Item>
        ) : null}
        {editing || videoSource === "upload" ? (
          <Form.Item label="视频文件">
            <Upload
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                setSelectedFile(file);
                setUploadMeta({
                  file_name: file.name,
                  original_filename: file.name,
                  mime_type: file.type || "video/mp4",
                  file_size: file.size,
                  duration_seconds: Number(form.getFieldValue("duration_seconds") || 0),
                });
                return false;
              }}
              accept=".mp4,.mov,.webm,.m4v,video/mp4,video/quicktime,video/webm"
              disabled={submitting}
            >
              <Button icon={<UploadOutlined />} loading={submitting}>
                {editing
                  ? (selectedFile ? `已选择新视频：${selectedFile.name}` : "重新上传并覆盖")
                  : (selectedFile ? `已选择视频：${selectedFile.name}` : "选择视频文件")}
              </Button>
            </Upload>
            <Space direction="vertical" size={4} style={{ marginTop: 8, color: "var(--text-mute)" }}>
              <Text type="secondary">
                {uploadMeta
                  ? `${editing ? "当前文件" : "文件名"}：${uploadMeta.original_filename || uploadMeta.file_name}`
                  : "尚未选择文件"}
              </Text>
              {uploadMeta ? <Text type="secondary">文件大小：{formatFileSize(uploadMeta.file_size)}</Text> : null}
              {uploadMeta ? <Text type="secondary">文件类型：{uploadMeta.mime_type || "未知"}</Text> : null}
              {submitting ? <Progress percent={uploadProgress} size="small" /> : null}
            </Space>
          </Form.Item>
        ) : (
          <Card size="small" title="从素材库选择视频">
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <Input.Search
                placeholder="搜索素材名称 / 项目名"
                value={materialKeyword}
                onChange={(e) => setMaterialKeyword(e.target.value)}
                onSearch={setMaterialKeyword}
              />
              <Form.Item
                label="选择视频素材"
                name="material_asset_id"
                rules={[{ required: true, message: "请选择素材库视频" }]}
                style={{ marginBottom: 0 }}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择素材库中的视频素材"
                  options={materialAssets.map((item) => ({
                    value: item.id,
                    label: `${item.name} / ${item.project_name || "未分组"}`,
                  }))}
                />
              </Form.Item>
              {selectedMaterialAsset ? (
                <Space direction="vertical" size={4}>
                  <Text type="secondary">已选素材：{selectedMaterialAsset.name}</Text>
                  <Text type="secondary">原文件名：{selectedMaterialAsset.file_name}</Text>
                  <Text type="secondary">所属项目：{selectedMaterialAsset.project_name || "—"}</Text>
                  <Text type="secondary">文件大小：{formatFileSize(selectedMaterialAsset.file_size || 0)}</Text>
                  <Text type="secondary">上传时间：{selectedMaterialAsset.created_at?.replace("T", " ").slice(0, 19) || "—"}</Text>
                </Space>
              ) : null}
            </Space>
          </Card>
        )}
        <Space size={24}>
          <Form.Item label="是否必修" name="is_required" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="是否新人默认必修" name="is_newcomer_required" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <Form.List name="targets">
          {(fields, { add, remove }) => (
            <Card size="small" title="适用对象" extra={<Button size="small" onClick={() => add({ target_type: "all_users", target_value: "" })}>新增对象</Button>}>
              {fields.map((field) => (
                <Space key={field.key} align="start" style={{ display: "flex", marginBottom: 12 }}>
                  <Form.Item
                    name={[field.name, "target_type"]}
                    rules={[{ required: true, message: "请选择类型" }]}
                    style={{ minWidth: 180 }}
                  >
                    <Select
                      options={[
                        { value: "all_users", label: "全部员工" },
                        { value: "all_newcomers", label: "全部新人" },
                        { value: "department", label: "指定部门" },
                        { value: "position", label: "指定岗位" },
                        { value: "role", label: "指定角色" },
                        { value: "user", label: "指定用户" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "target_value"]} style={{ minWidth: 260 }}>
                    {targetValueInput(field)}
                  </Form.Item>
                  <Button danger onClick={() => remove(field.name)}>删除</Button>
                </Space>
              ))}
            </Card>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

function QuestionFormModal({ open, editing, pointId, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();
  const questionType = Form.useWatch("question_type", form);
  const correctIndexes = Form.useWatch("correct_indexes", form);
  const previousTypeRef = useRef(null);

  useEffect(() => {
    if (!open) {
      previousTypeRef.current = null;
      return;
    }
    const initialValues = buildQuestionFormValues(editing);
    form.setFieldsValue(initialValues);
    previousTypeRef.current = initialValues.question_type;
  }, [editing, form, open]);

  useEffect(() => {
    if (!open || !questionType) return;
    if (previousTypeRef.current == null) {
      previousTypeRef.current = questionType;
      return;
    }
    if (previousTypeRef.current === questionType) return;
    applyQuestionTypeDefaults(form, questionType);
    previousTypeRef.current = questionType;
  }, [form, open, questionType]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(pointId, buildQuestionPayload(values, editing), editing);
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "请检查题目配置后再保存。");
      }
    }
  };

  const handleRemoveOption = (index, remove) => {
    const currentType = normalizeQuestionType(form.getFieldValue("question_type"));
    const currentValue = form.getFieldValue("correct_indexes");
    if (currentType === "multiple") {
      const nextValue = (Array.isArray(currentValue) ? currentValue : [])
        .map((item) => Number(item))
        .filter((item) => item !== index)
        .map((item) => (item > index ? item - 1 : item));
      remove(index);
      form.setFieldValue("correct_indexes", nextValue);
      return;
    }
    const selectedIndex = Number(currentValue);
    remove(index);
    if (!Number.isInteger(selectedIndex)) {
      form.setFieldValue("correct_indexes", undefined);
      return;
    }
    if (selectedIndex === index) {
      form.setFieldValue("correct_indexes", undefined);
      return;
    }
    form.setFieldValue("correct_indexes", selectedIndex > index ? selectedIndex - 1 : selectedIndex);
  };

  const renderQuestionConfig = () => {
    if (questionType === "fill") {
      return (
        <>
          <Text type="secondary">支持多个可接受答案，每行/每项一个，学生填写任一答案即视为正确。</Text>
          <Form.List name="correct_answers">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ display: "flex", marginTop: 12 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="start" style={{ display: "flex" }}>
                    <Form.Item
                      name={[field.name, "value"]}
                      rules={[{
                        validator: async (_, value) => {
                          if (String(value || "").trim()) return;
                          throw new Error("请输入可接受答案");
                        },
                      }]}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <Input placeholder="请输入一个可接受答案" />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)} disabled={fields.length <= 1}>删除</Button>
                  </Space>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add({ value: "" })}>添加答案</Button>
              </Space>
            )}
          </Form.List>
        </>
      );
    }

    if (questionType === "short") {
      return (
        <>
          <Text type="secondary">简答题可填写参考答案，后续可用于人工批改或关键词判断。</Text>
          <Form.Item label="参考答案" name="reference_answer" style={{ marginTop: 12, marginBottom: 0 }}>
            <Input.TextArea rows={4} placeholder="可选填参考答案" />
          </Form.Item>
        </>
      );
    }

    return (
      <>
        <Form.List name="options">
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ display: "flex" }}>
              {fields.map((field, index) => {
                const selectedSet = new Set(Array.isArray(correctIndexes) ? correctIndexes.map((item) => Number(item)) : []);
                const isRadioChecked = Number(correctIndexes) === index;
                const isJudge = questionType === "judge";
                return (
                  <Space key={field.key} align="start" style={{ display: "flex" }}>
                    {questionType === "multiple" ? (
                      <Checkbox
                        checked={selectedSet.has(index)}
                        onChange={(event) => {
                          const current = Array.isArray(correctIndexes) ? correctIndexes.map((item) => Number(item)) : [];
                          const next = event.target.checked
                            ? Array.from(new Set([...current, index])).sort((a, b) => a - b)
                            : current.filter((item) => item !== index);
                          form.setFieldValue("correct_indexes", next);
                        }}
                      />
                    ) : (
                      <Radio checked={isRadioChecked} onChange={() => form.setFieldValue("correct_indexes", index)} />
                    )}
                    <Form.Item
                      name={[field.name, "value"]}
                      rules={[{
                        validator: async (_, value) => {
                          if (String(value || "").trim()) return;
                          throw new Error("请输入选项内容");
                        },
                      }]}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <Input placeholder={isJudge ? "请输入判断选项文本" : `请输入选项 ${index + 1}`} />
                    </Form.Item>
                    {!isJudge ? (
                      <Button danger onClick={() => handleRemoveOption(field.name, remove)} disabled={fields.length <= 2}>删除</Button>
                    ) : null}
                  </Space>
                );
              })}
              {!questionType || questionType === "judge" ? null : (
                <Button icon={<PlusOutlined />} onClick={() => add({ value: "" })}>添加选项</Button>
              )}
            </Space>
          )}
        </Form.List>
        <Form.Item noStyle shouldUpdate>
          {() => (
            <Form.Item
              name="correct_indexes"
              style={{ marginTop: 12, marginBottom: 0 }}
              rules={[{
                validator: async (_, value) => {
                  if (questionType === "multiple") {
                    if (Array.isArray(value) && value.length > 0) return;
                    throw new Error("请至少选择一个正确答案");
                  }
                  if (Number.isInteger(Number(value))) return;
                  throw new Error("请选择正确答案");
                },
              }]}
            >
              <Input type="hidden" />
            </Form.Item>
          )}
        </Form.Item>
      </>
    );
  };

  return (
    <Modal open={open} title={editing ? "编辑题目" : "新增题目"} onCancel={onCancel} onOk={handleOk} destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="题型" name="question_type" rules={[{ required: true, message: "请选择题型" }]}>
          <Select options={QUESTION_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item label="题目内容" name="stem" rules={[{ required: true, message: "请输入题目内容" }]}>
          <Input.TextArea rows={3} placeholder="请输入题目内容" />
        </Form.Item>
        <Form.Item
          label={questionType === "fill" ? "正确答案列表" : questionType === "short" ? "参考答案配置" : "选项配置"}
          style={{ marginBottom: 0 }}
        >
          {renderQuestionConfig()}
        </Form.Item>
      </Form>
    </Modal>
  );
}

function renderQuestionAnswer(question, value, onChange) {
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

function ResponsiveVideoPlayer({ videoRef, src, onLoadedMetadata, onTimeUpdate, onSeeking, onPause, onEnded, onPlay }) {
  return (
    <div className="magic-video-player-wrap">
      <video
        ref={videoRef}
        src={src}
        controls
        className="magic-video-player"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onSeeking={onSeeking}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
      />
    </div>
  );
}

export default function MagicAcademyPage({ embedded = false }) {
  const adminMode = isAdmin();
  const superAdminMode = isSuperAdmin();
  const currentUser = getCurrentUser();
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(adminMode ? "video_manage" : "video_manage");
  const [academyView, setAcademyView] = useState(
    adminMode
      ? "home"
      : (searchParams.get("tab") === "audio"
        ? "reading"
        : searchParams.get("tab") === "courses"
          ? "courses"
          : "home"),
  );
  const [users, setUsers] = useState([]);
  const [videos, setVideos] = useState([]);
  const [videoSeries, setVideoSeries] = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  const [statsRows, setStatsRows] = useState([]);
  const [answerRows, setAnswerRows] = useState([]);
  const [audioRows, setAudioRows] = useState([]);
  const [myVideos, setMyVideos] = useState([]);
  const [myAudios, setMyAudios] = useState([]);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [selectedAdminVideoId, setSelectedAdminVideoId] = useState(null);
  const [videoDetail, setVideoDetail] = useState(null);
  const [videoDetailError, setVideoDetailError] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [videoModal, setVideoModal] = useState(null);
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [publishingVideoId, setPublishingVideoId] = useState(null);
  const [disablingVideoId, setDisablingVideoId] = useState(null);
  const [quizVideoId, setQuizVideoId] = useState(null);
  const [quizPoints, setQuizPoints] = useState([]);
  const [pointModal, setPointModal] = useState(null);
  const [questionModal, setQuestionModal] = useState(null);
  const [seriesModal, setSeriesModal] = useState(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);
  const [employeeSelectedSeriesId, setEmployeeSelectedSeriesId] = useState(null);
  const [seriesItemVideoId, setSeriesItemVideoId] = useState(null);
  const [watchConfirmForm] = Form.useForm();
  const [seriesForm] = Form.useForm();
  const [statsVideoId, setStatsVideoId] = useState(null);
  const [statsDepartment, setStatsDepartment] = useState("");
  const [statsUserId, setStatsUserId] = useState(null);
  const [appliedStatsDepartment, setAppliedStatsDepartment] = useState("");
  const [appliedStatsUserId, setAppliedStatsUserId] = useState(null);
  const [whitelistForm] = Form.useForm();
  const [pointForm] = Form.useForm();
  const [quizAnswerState, setQuizAnswerState] = useState({ open: false, point: null, values: {} });
  const [watchConfirmState, setWatchConfirmState] = useState({ open: false, round: 0 });
  const [audioRemark, setAudioRemark] = useState("");
  const [audioMakeupSetting, setAudioMakeupSetting] = useState({ enabled: false, make_up_days: 0, description: "" });
  const [readingContents, setReadingContents] = useState([]);
  const [readingContentsTotal, setReadingContentsTotal] = useState(0);
  const [readingContentModalOpen, setReadingContentModalOpen] = useState(false);
  const [readingContentModalMode, setReadingContentModalMode] = useState("create");
  const [readingContentEditing, setReadingContentEditing] = useState(null);
  const [readingContentSubmitting, setReadingContentSubmitting] = useState(false);
  const [readingContentKeyword, setReadingContentKeyword] = useState("");
  const [readingContentMonth, setReadingContentMonth] = useState(getCurrentMonthText());
  const [readingContentPage, setReadingContentPage] = useState(1);
  const [readingContentImageFile, setReadingContentImageFile] = useState(null);
  const [readingImageAssets, setReadingImageAssets] = useState([]);
  const [readingImageKeyword, setReadingImageKeyword] = useState("");
  const [myReadingContents, setMyReadingContents] = useState([]);
  const [readingContentForm] = Form.useForm();
  const [myAudioMakeupDays, setMyAudioMakeupDays] = useState([]);
  const [audioMonth, setAudioMonth] = useState(getCurrentMonthText());
  const [audioDepartment, setAudioDepartment] = useState("");
  const [audioUserId, setAudioUserId] = useState(null);
  const [myAudioMonth, setMyAudioMonth] = useState(getCurrentMonthText());
  const [myAudioCalendarDays, setMyAudioCalendarDays] = useState([]);
  const [myAudioSelectedDate, setMyAudioSelectedDate] = useState(getTodayText());
  const [adminAudioCalendarDays, setAdminAudioCalendarDays] = useState([]);
  const [adminAudioSelectedDate, setAdminAudioSelectedDate] = useState(getTodayText());
  const videoRef = useRef(null);
  const progressTimerRef = useRef(null);
  const watchedRef = useRef(0);
  const lastSafeTimeRef = useRef(0);
  const blockingSeekRef = useRef(false);
  const lastSeekWarnAtRef = useRef(0);
  const lockedQuizPointIdRef = useRef(null);
  const watchConfirmAccumulatedRef = useRef(0);
  const watchConfirmLastTimeRef = useRef(null);
  const watchConfirmRoundRef = useRef(0);
  const answeredPointIds = useMemo(() => new Set(videoDetail?.progress?.answered_point_ids || []), [videoDetail]);
  const selectedAdminVideo = useMemo(
    () => videos.find((item) => item.id === selectedAdminVideoId) || null,
    [selectedAdminVideoId, videos],
  );
  const selectedSeries = useMemo(
    () => videoSeries.find((item) => item.id === selectedSeriesId) || null,
    [selectedSeriesId, videoSeries],
  );
  const availableSeriesVideos = useMemo(() => {
    const occupied = new Set(
      videoSeries
        .flatMap((item) => item.items || [])
        .filter((item) => item.video_id && selectedSeries?.items?.every((current) => current.video_id !== item.video_id))
        .map((item) => item.video_id),
    );
    return videos.filter((item) => !occupied.has(item.id));
  }, [selectedSeries, videoSeries, videos]);
  const myAudioCalendarMap = useMemo(() => buildAudioCalendarMap(myAudioCalendarDays), [myAudioCalendarDays]);
  const myAudioMakeupMap = useMemo(
    () => Object.fromEntries((Array.isArray(myAudioMakeupDays) ? myAudioMakeupDays : []).map((item) => [item.date, item])),
    [myAudioMakeupDays],
  );
  const adminAudioCalendarMap = useMemo(() => buildAudioCalendarMap(adminAudioCalendarDays), [adminAudioCalendarDays]);
  const selectedMyAudioDay = myAudioCalendarMap[myAudioSelectedDate] || null;
  const selectedMyAudioMakeup = myAudioMakeupMap[myAudioSelectedDate] || null;
  const selectedAdminAudioDay = adminAudioCalendarMap[adminAudioSelectedDate] || null;
  const employeeUsers = useMemo(
    () => users.filter((item) => item.role === "user"),
    [users],
  );
  const employeeDepartmentOptions = useMemo(
    () => Array.from(new Set(employeeUsers.map((item) => item.department).filter(Boolean))).map((item) => ({
      value: item,
      label: item,
    })),
    [employeeUsers],
  );
  const statsDepartmentOptions = useMemo(
    () => Array.from(new Set(employeeUsers.map((item) => item.department || UNASSIGNED_DEPARTMENT_FILTER))).map((item) => ({
      value: item,
      label: item === UNASSIGNED_DEPARTMENT_FILTER ? "未分配部门" : item,
    })),
    [employeeUsers],
  );
  const filteredStatsEmployees = useMemo(
    () => employeeUsers.filter((item) => (statsDepartment ? (item.department || UNASSIGNED_DEPARTMENT_FILTER) === statsDepartment : true)),
    [employeeUsers, statsDepartment],
  );
  const myRequiredVideos = useMemo(
    () => myVideos.filter((item) => item.is_required && !item.progress?.is_completed),
    [myVideos],
  );
  const myLearningVideos = useMemo(
    () => myVideos.filter((item) => !item.progress?.is_completed && (item.progress?.progress_percent || 0) > 0),
    [myVideos],
  );
  const myCompletedVideos = useMemo(
    () => myVideos.filter((item) => item.progress?.is_completed),
    [myVideos],
  );
  const todayUploadedAudio = useMemo(
    () => myAudios.some((item) => item.uploaded_date === getTodayText()),
    [myAudios],
  );
  const continueStudyVideo = useMemo(
    () => myRequiredVideos.find((item) => !item.is_locked)
      || myLearningVideos.find((item) => !item.is_locked)
      || myVideos.find((item) => !item.is_locked)
      || myVideos[0]
      || null,
    [myLearningVideos, myRequiredVideos, myVideos],
  );
  const myVideoSections = useMemo(() => buildSeriesSections(myVideos), [myVideos]);
  const selectedEmployeeSeries = useMemo(
    () => myVideoSections.seriesSections.find((item) => String(item.seriesId) === String(employeeSelectedSeriesId)) || null,
    [employeeSelectedSeriesId, myVideoSections],
  );
  const latestAudioRecord = useMemo(
    () => (Array.isArray(myAudios) && myAudios.length > 0 ? myAudios[0] : null),
    [myAudios],
  );
  const selectedReadingContents = useMemo(
    () => Array.isArray(myReadingContents) ? myReadingContents : [],
    [myReadingContents],
  );
  const readingImageSource = Form.useWatch("image_source", readingContentForm) || "upload";
  const readingMaterialAssetId = Form.useWatch("material_asset_id", readingContentForm);
  const selectedReadingImageAsset = useMemo(
    () => readingImageAssets.find((item) => item.id === readingMaterialAssetId) || null,
    [readingImageAssets, readingMaterialAssetId],
  );
  const studyCompletionRate = useMemo(() => {
    if (!myVideos.length) return 0;
    return Math.round((myCompletedVideos.length / myVideos.length) * 100);
  }, [myCompletedVideos.length, myVideos.length]);

  useEffect(() => {
    if (adminMode) return;
    const nextView = searchParams.get("tab") === "audio"
      ? "reading"
      : searchParams.get("tab") === "courses"
        ? "courses"
        : "home";
    if (nextView !== academyView) {
      setAcademyView(nextView);
    }
  }, [academyView, adminMode, searchParams]);

  useEffect(() => {
    if (adminMode) return;
    const nextVideoId = searchParams.get("video");
    const nextSeriesId = searchParams.get("series");
    if ((nextSeriesId || null) !== (employeeSelectedSeriesId || null)) {
      setEmployeeSelectedSeriesId(nextSeriesId || null);
    }
    if (searchParams.get("tab") !== "courses") {
      if (selectedVideoId !== null) setSelectedVideoId(null);
      return;
    }
    if ((nextVideoId || null) !== (selectedVideoId || null)) {
      setSelectedVideoId(nextVideoId || null);
    }
  }, [adminMode, employeeSelectedSeriesId, searchParams, selectedVideoId]);

  const openAcademyHome = () => {
    setSelectedVideoId(null);
    setVideoDetail(null);
    setEmployeeSelectedSeriesId(null);
    setAcademyView("home");
    if (!adminMode) setSearchParams({});
  };

  const openCourseCenter = (videoId = null) => {
    setAcademyView("courses");
    setVideoDetailError(null);
    setEmployeeSelectedSeriesId(null);
    if (videoId) {
      setSelectedVideoId(videoId);
    } else {
      setSelectedVideoId(null);
      setVideoDetail(null);
    }
    if (!adminMode) {
      setSearchParams(videoId ? { tab: "courses", video: String(videoId) } : { tab: "courses" });
    }
  };

  const openReadingCenter = () => {
    setAcademyView("reading");
    if (!adminMode) setSearchParams({ tab: "audio" });
  };

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
  };
  const statsEmployeeOptions = useMemo(
    () => filteredStatsEmployees.map((item) => ({
      value: item.id,
      label: `${item.real_name || item.display_name || item.username} (${item.username})`,
    })),
    [filteredStatsEmployees],
  );

  const reloadAdminData = async () => {
    if (!adminMode) return;
    const [userData, videoData, whitelistData, seriesData] = await Promise.all([
      adminListUsers(),
      listMagicVideos(),
      superAdminMode ? listMagicWhitelist() : Promise.resolve([]),
      listMagicVideoSeries(),
    ]);
    setUsers(Array.isArray(userData) ? userData : []);
    setVideos(Array.isArray(videoData) ? videoData : []);
    setWhitelist(Array.isArray(whitelistData) ? whitelistData : []);
    setVideoSeries(Array.isArray(seriesData) ? seriesData : []);
    if (!statsVideoId && videoData?.[0]?.id) setStatsVideoId(videoData[0].id);
    if (!quizVideoId && videoData?.[0]?.id) setQuizVideoId(videoData[0].id);
    if (!selectedSeriesId && seriesData?.[0]?.id) setSelectedSeriesId(seriesData[0].id);
  };

  const reloadMyData = async () => {
    const [videoData, audioData] = await Promise.all([fetchMyMagicVideos(), fetchMyAudios()]);
    setMyVideos(Array.isArray(videoData) ? videoData : []);
    setMyAudios(Array.isArray(audioData) ? audioData : []);
  };

  const reloadMyAudioCalendar = async (monthText = myAudioMonth) => {
    const [result, makeup] = await Promise.all([
      fetchMyAudioCalendar(monthText),
      fetchMyAudioMakeupOptions(monthText),
    ]);
    const days = Array.isArray(result?.days) ? result.days : [];
    setMyAudioCalendarDays(days);
    setMyAudioMakeupDays(Array.isArray(makeup?.days) ? makeup.days : []);
    setAudioMakeupSetting(makeup?.setting || { enabled: false, make_up_days: 0, description: "" });
    if (!days.some((item) => item.date === myAudioSelectedDate)) {
      const fallback = days.find((item) => item.is_today)?.date || days[0]?.date || dayjs(`${monthText}-01`).format("YYYY-MM-DD");
      setMyAudioSelectedDate(fallback);
    }
  };

  const reloadAdminAudioCalendar = async (params = {}) => {
    const result = await fetchAdminAudioCalendar({
      month: params.month ?? audioMonth,
      department: params.department ?? audioDepartment,
      user_id: params.user_id ?? audioUserId,
    });
    const days = Array.isArray(result?.days) ? result.days : [];
    setAdminAudioCalendarDays(days);
    if (!days.some((item) => item.date === adminAudioSelectedDate)) {
      const fallback = days.find((item) => item.is_today)?.date || days[0]?.date || dayjs(`${(params.month ?? audioMonth)}-01`).format("YYYY-MM-DD");
      setAdminAudioSelectedDate(fallback);
    }
  };

  const reloadAdminReadingContents = async (params = {}) => {
    const result = await fetchAdminReadingContents({
      month: params.month ?? readingContentMonth,
      keyword: params.keyword ?? readingContentKeyword,
      page: params.page ?? readingContentPage,
      page_size: 20,
    });
    setReadingContents(Array.isArray(result?.items) ? result.items : []);
    setReadingContentsTotal(Number(result?.total || 0));
  };

  const reloadMyReadingContents = async (dateText = myAudioSelectedDate) => {
    const result = await fetchMyReadingContents(dateText);
    setMyReadingContents(Array.isArray(result) ? result : []);
  };

  useEffect(() => {
    (async () => {
      try {
        await reloadMyData();
        await reloadAdminData();
      } catch (error) {
        message.error(error?.message || "课程管理数据加载失败。");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (academyView !== "courses") {
      setVideoDetail(null);
      setVideoDetailError(null);
      return;
    }
    if (!selectedVideoId) {
      setVideoDetail(null);
      setVideoDetailError(null);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    setVideoDetailError(null);
    fetchMyMagicVideoDetail(selectedVideoId)
      .then((data) => {
        if (!alive) return;
        setVideoDetail(data);
        setVideoDetailError(null);
        watchedRef.current = Math.max(data?.progress?.max_watched_position || 0, 0);
      })
      .catch((error) => {
        if (!alive) return;
        const status = Number(error?.status || 0);
        setVideoDetail(null);
        setVideoDetailError({
          status,
          message: status === 403
            ? (error?.message || "请先完成上一节视频后再学习本节")
            : status === 404
              ? "课程不存在或已被删除"
              : "课程加载失败，请稍后重试",
        });
        message.error(error?.message || "视频详情加载失败。");
      })
      .finally(() => {
        if (alive) setLoadingDetail(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedVideoId, academyView]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizVideoId || !adminMode) return;
    listMagicQuizPoints(quizVideoId).then(setQuizPoints).catch((error) => {
      message.error(error?.message || "答题节点加载失败。");
    });
  }, [quizVideoId, adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizVideoId || !adminMode) return;
    fetchMagicWatchConfirmSetting(quizVideoId).then((data) => {
      watchConfirmForm.setFieldsValue({
        enabled: !!data?.enabled,
        interval_seconds: Number(data?.interval_seconds || 300),
        message: data?.message || "请确认你正在观看视频",
        button_text: data?.button_text || "继续学习",
      });
    }).catch((error) => {
      message.error(error?.message || "观看确认配置加载失败。");
    });
  }, [quizVideoId, adminMode, watchConfirmForm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!statsVideoId || !adminMode) return;
    Promise.all([
      fetchMagicVideoStats(statsVideoId, {
        department: appliedStatsDepartment || undefined,
        user_id: appliedStatsUserId || undefined,
      }),
      fetchMagicVideoAnswers(statsVideoId, {
        department: appliedStatsDepartment || undefined,
        user_id: appliedStatsUserId || undefined,
      }),
    ])
      .then(([stats, answers]) => {
        setStatsRows(Array.isArray(stats) ? stats : []);
        setAnswerRows(Array.isArray(answers) ? answers : []);
      })
      .catch((error) => message.error(error?.message || "统计加载失败。"));
  }, [statsVideoId, adminMode, appliedStatsDepartment, appliedStatsUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!statsUserId) return;
    if (!filteredStatsEmployees.some((item) => item.id === statsUserId)) {
      setStatsUserId(null);
    }
  }, [filteredStatsEmployees, statsUserId]);

  useEffect(() => {
    if (!selectedSeriesId) return;
    if (!videoSeries.some((item) => item.id === selectedSeriesId)) {
      setSelectedSeriesId(videoSeries[0]?.id || null);
    }
  }, [selectedSeriesId, videoSeries]);

  useEffect(() => {
    if (!employeeSelectedSeriesId) return;
    if (!myVideoSections.seriesSections.some((item) => String(item.seriesId) === String(employeeSelectedSeriesId))) {
      setEmployeeSelectedSeriesId(null);
    }
  }, [employeeSelectedSeriesId, myVideoSections]);

  useEffect(() => {
    if (!adminMode) return;
    fetchMagicAudioStats({
      month: audioMonth || undefined,
      department: audioDepartment || undefined,
      user_id: audioUserId || undefined,
    }).then(setAudioRows).catch((error) => {
      message.error(error?.message || "录音统计加载失败。");
    });
  }, [audioMonth, audioDepartment, audioUserId, adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adminMode) return;
    fetchMagicAudioMakeupSetting().then((data) => {
      setAudioMakeupSetting(data || { enabled: false, make_up_days: 0, description: "" });
    }).catch((error) => {
      message.error(error?.message || "补卡设置加载失败。");
    });
  }, [adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adminMode) return;
    reloadAdminReadingContents().catch((error) => {
      message.error(error?.message || "读书内容列表加载失败。");
    });
  }, [adminMode, readingContentKeyword, readingContentMonth, readingContentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adminMode || readingImageSource !== "material") return;
    listAllMaterialAssets({ asset_type: "image", keyword: readingImageKeyword })
      .then((data) => setReadingImageAssets(Array.isArray(data) ? data : []))
      .catch((error) => message.error(error?.message || "图片素材加载失败。"));
  }, [adminMode, message, readingImageKeyword, readingImageSource]);

  useEffect(() => {
    reloadMyAudioCalendar(myAudioMonth).catch((error) => {
      message.error(error?.message || "录音日历加载失败。");
    });
  }, [myAudioMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (adminMode) return;
    reloadMyReadingContents().catch((error) => {
      message.error(error?.message || "读书内容加载失败。");
    });
  }, [adminMode, myAudioSelectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adminMode) return;
    reloadAdminAudioCalendar().catch((error) => {
      message.error(error?.message || "录音日历加载失败。");
    });
  }, [audioMonth, audioDepartment, audioUserId, adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProgress = async (extra = {}) => {
    if (academyView !== "courses") return;
    if (!videoDetail?.id || !videoRef.current) return;
    const element = videoRef.current;
    const safeCurrentTime = Math.min(
      Number(element.currentTime || 0),
      Math.max(lastSafeTimeRef.current || 0, watchedRef.current || 0),
    );
    try {
      const data = await saveMyMagicVideoProgress(videoDetail.id, {
        current_position: safeCurrentTime,
        max_watched_position: watchedRef.current || 0,
        duration_seconds: element.duration || videoDetail.duration_seconds || 0,
        page_visible: !document.hidden,
        ...extra,
      });
      setVideoDetail((prev) => ({ ...prev, progress: data.progress }));
      if (data?.progress?.is_completed && !videoDetail?.progress?.is_completed) {
        await reloadMyData();
      }
    } catch (error) {
      logMagicUploadStageError("progress report", error);
    }
  };

  const showSeekWarning = (text) => {
    const now = Date.now();
    if (now - lastSeekWarnAtRef.current < 2000) return;
    lastSeekWarnAtRef.current = now;
    message.warning(text);
  };

  const maybeOpenQuiz = (currentTime) => {
    if (!videoDetail || videoDetail.can_seek_freely || videoDetail.progress?.is_completed) return false;
    const nextPoint = (videoDetail.quiz_points || []).find((point) => (
      point.enabled && !answeredPointIds.has(point.id) && currentTime >= point.trigger_second
    ));
    if (nextPoint) {
      if (lockedQuizPointIdRef.current === nextPoint.id && quizAnswerState.open) return true;
      lockedQuizPointIdRef.current = nextPoint.id;
      videoRef.current?.pause();
      if (videoRef.current) {
        const lockedTime = Number(nextPoint.trigger_second || 0);
        videoRef.current.currentTime = lockedTime;
        lastSafeTimeRef.current = lockedTime;
        watchedRef.current = Math.max(watchedRef.current, lockedTime);
      }
      setQuizAnswerState({ open: true, point: nextPoint, values: {} });
      return true;
    }
    return false;
  };

  const getAllowedSeekTime = () => {
    if (!videoDetail || videoDetail.can_seek_freely || videoDetail.progress?.is_completed) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(watchedRef.current || 0, lastSafeTimeRef.current || 0) + 2;
  };

  const clampToSafePosition = (reason = "请按顺序观看视频，暂不能跳过未学习内容。") => {
    if (!videoRef.current) return;
    const activeLockedPoint = (videoDetail?.quiz_points || []).find((point) => point.id === lockedQuizPointIdRef.current);
    const fallback = activeLockedPoint
      ? Number(activeLockedPoint.trigger_second || 0)
      : Math.max(lastSafeTimeRef.current || 0, watchedRef.current || 0);
    blockingSeekRef.current = true;
    videoRef.current.currentTime = fallback;
    lastSafeTimeRef.current = fallback;
    videoRef.current.pause();
    window.setTimeout(() => {
      blockingSeekRef.current = false;
    }, 0);
    showSeekWarning(reason);
  };

  const handleVideoLoaded = () => {
    if (!videoRef.current || !videoDetail) return;
    const saved = Number(videoDetail.progress?.current_position || 0);
    videoRef.current.currentTime = saved;
    watchedRef.current = Math.max(Number(videoDetail.progress?.max_watched_position || 0), saved);
    lastSafeTimeRef.current = saved;
    lockedQuizPointIdRef.current = null;
    watchConfirmAccumulatedRef.current = 0;
    watchConfirmLastTimeRef.current = saved;
    watchConfirmRoundRef.current = 0;
    setWatchConfirmState({ open: false, round: 0 });
  };

  const maybeOpenWatchConfirm = (currentTime) => {
    const setting = videoDetail?.watch_confirm_setting;
    if (!setting?.enabled) return false;
    if (watchConfirmState.open || quizAnswerState.open) return false;
    if (videoDetail?.progress?.is_completed && currentTime >= Number(videoDetail.duration_seconds || 0)) return false;
    const threshold = Number(setting.interval_seconds || 0);
    if (threshold <= 0) return false;
    if (watchConfirmAccumulatedRef.current < threshold) return false;
    videoRef.current?.pause();
    watchConfirmRoundRef.current += 1;
    setWatchConfirmState({ open: true, round: watchConfirmRoundRef.current });
    return true;
  };

  const handleVideoPlay = () => {
    if (!videoRef.current) return;
    watchConfirmLastTimeRef.current = Number(videoRef.current.currentTime || 0);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || !videoDetail) return;
    if (document.hidden) {
      videoRef.current.pause();
      return;
    }
    if (blockingSeekRef.current) return;
    const currentTime = videoRef.current.currentTime || 0;
    if (quizAnswerState.open && quizAnswerState.point) {
      const lockedTime = Number(quizAnswerState.point.trigger_second || 0);
      if (currentTime > lockedTime + 0.5) {
        clampToSafePosition("请先完成当前节点答题，再继续学习。");
        return;
      }
    }
    watchedRef.current = Math.max(watchedRef.current, currentTime);
    lastSafeTimeRef.current = Math.min(currentTime, watchedRef.current);
    if (maybeOpenQuiz(currentTime)) return;
    const lastTime = watchConfirmLastTimeRef.current;
    const delta = lastTime == null ? 0 : currentTime - lastTime;
    if (delta > 0 && delta < 2.5) {
      watchConfirmAccumulatedRef.current += delta;
    }
    watchConfirmLastTimeRef.current = currentTime;
    maybeOpenWatchConfirm(currentTime);
  };

  const handleSeeking = () => {
    if (!videoRef.current || !videoDetail || videoDetail.can_seek_freely || videoDetail.progress?.is_completed) return;
    if (blockingSeekRef.current) return;
    const targetTime = Number(videoRef.current.currentTime || 0);
    const lockedPoint = quizAnswerState.point || (videoDetail.quiz_points || []).find((point) => point.id === lockedQuizPointIdRef.current);
    if (lockedPoint && !answeredPointIds.has(lockedPoint.id) && targetTime > Number(lockedPoint.trigger_second || 0) + 0.5) {
      clampToSafePosition("请先完成当前节点答题，再继续学习。");
      return;
    }
    if (targetTime > getAllowedSeekTime()) {
      clampToSafePosition("请按顺序观看视频，暂不能跳过未学习内容。");
    }
  };

  useEffect(() => {
    if (academyView !== "courses") return undefined;
    const listener = () => {
      if (document.hidden) {
        videoRef.current?.pause();
        saveProgress({ page_visible: false });
      }
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, [videoDetail, academyView]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (academyView !== "courses") {
      clearInterval(progressTimerRef.current);
      return undefined;
    }
    if (!videoDetail?.id) return;
    clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => saveProgress(), 5000);
    return () => clearInterval(progressTimerRef.current);
  }, [videoDetail?.id, academyView]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitVideo = async (payload) => {
    let uploadInitResult = null;
    let uploadCompleted = false;
    try {
      setVideoSubmitting(true);
      setVideoUploadProgress(0);
      if (!videoModal?.id && payload.video_source === "material") {
        const metadataPayload = { ...payload };
        delete metadataPayload.selected_file;
        await createMagicVideo(metadataPayload);
        message.success("已从素材库创建课程视频。");
      } else if (videoModal?.id && !payload.selected_file) {
        const metadataPayload = { ...payload };
        delete metadataPayload.selected_file;
        await updateMagicVideo(videoModal.id, metadataPayload);
        message.success("视频元数据已更新。");
      } else if (videoModal?.id && payload.selected_file) {
        const file = payload.selected_file;
        try {
          uploadInitResult = await initMagicVideoReplaceUpload(videoModal.id, {
            original_filename: payload.original_filename,
            file_size: file.size,
            mime_type: file.type || payload.mime_type || "video/mp4",
            duration_seconds: Number(payload.duration_seconds || 0),
          });
        } catch (error) {
          logMagicUploadStageError("replace init", error);
          message.error(error?.message || "新视频替换初始化失败。");
          return;
        }

        let parts;
        try {
          parts = await multipartUploadToOss(file, uploadInitResult, setVideoUploadProgress);
        } catch (error) {
          logMagicUploadStageError("replace oss upload", error);
          logOssUploadError(error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key && uploadInitResult?.upload_id) {
            try {
              await failMagicVideoReplaceUpload(uploadInitResult.video_id, {
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "OSS 上传失败",
              });
            } catch (failError) {
              logMagicUploadStageError("replace upload fail callback", failError);
            }
          }
          message.error(error?.message || "新视频上传失败，原视频未被替换。");
          return;
        }

        try {
          await completeMagicVideoReplaceUpload(videoModal.id, {
            oss_object_key: uploadInitResult.oss_object_key,
            file_size: file.size,
            upload_id: uploadInitResult.upload_id,
            parts,
            title: payload.title,
            description: payload.description || "",
            category: payload.category || "",
            duration_seconds: Number(payload.duration_seconds || 0),
            is_required: !!payload.is_required,
            is_newcomer_required: !!payload.is_newcomer_required,
            status: payload.status,
            targets: payload.targets || [],
          });
          uploadCompleted = true;
          setVideoUploadProgress(100);
          message.success("视频已重新上传并覆盖。");
        } catch (error) {
          logMagicUploadStageError("replace complete", error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key && uploadInitResult?.upload_id) {
            try {
              await failMagicVideoReplaceUpload(uploadInitResult.video_id, {
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "完成替换上传失败。",
              });
            } catch (failError) {
              logMagicUploadStageError("replace upload fail callback", failError);
            }
          }
          message.error(error?.message || "新视频上传失败，原视频未被替换。");
          return;
        }
      } else {
        const file = payload.selected_file;
        try {
          uploadInitResult = await initMagicVideoUpload({
            title: payload.title,
            description: payload.description || "",
            category: payload.category || "",
            original_filename: payload.original_filename,
            file_size: file.size,
            mime_type: file.type || payload.mime_type || "video/mp4",
            duration_seconds: Number(payload.duration_seconds || 0),
            is_required: !!payload.is_required,
            is_newcomer_required: !!payload.is_newcomer_required,
            status: payload.status,
            targets: payload.targets || [],
          });
        } catch (error) {
          logMagicUploadStageError("init", error);
          message.error(error?.message || "上传初始化失败。");
          return;
        }

        let parts;
        try {
          parts = await multipartUploadToOss(file, uploadInitResult, setVideoUploadProgress);
        } catch (error) {
          logMagicUploadStageError("oss upload", error);
          logOssUploadError(error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key) {
            try {
              await failMagicVideoUpload({
                video_id: uploadInitResult.video_id,
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "OSS 上传失败",
              });
            } catch (failError) {
              logMagicUploadStageError("upload fail callback", failError);
            }
          }
          message.error(error?.message || "视频文件上传 OSS 失败。");
          return;
        }

        try {
          await completeMagicVideoUpload({
            video_id: uploadInitResult.video_id,
            oss_object_key: uploadInitResult.oss_object_key,
            file_size: file.size,
            upload_id: uploadInitResult.upload_id,
            parts,
          });
          uploadCompleted = true;
          setVideoUploadProgress(100);
          message.success("视频已上传并入库。");
        } catch (error) {
          logMagicUploadStageError("complete", error);
          if (uploadInitResult?.video_id && uploadInitResult?.oss_object_key) {
            try {
              await failMagicVideoUpload({
                video_id: uploadInitResult.video_id,
                oss_object_key: uploadInitResult.oss_object_key,
                upload_id: uploadInitResult.upload_id,
                reason: error?.message || "完成视频上传失败。",
              });
            } catch (failError) {
              logMagicUploadStageError("upload fail callback", failError);
            }
          }
          message.error(error?.message || "视频上传完成确认失败。");
          return;
        }
      }
      setVideoModal(null);
      try {
        await reloadAdminData();
      } catch (error) {
        logMagicUploadStageError("refresh list", error);
        if (uploadCompleted) {
          message.warning("视频已上传成功，但列表刷新失败，请手动刷新页面。");
          return;
        }
        throw error;
      }
    } catch (error) {
      logMagicUploadStageError("submit video", error);
      if (!uploadCompleted && uploadInitResult?.video_id && uploadInitResult?.oss_object_key) {
        try {
          await failMagicVideoUpload({
            video_id: uploadInitResult.video_id,
            oss_object_key: uploadInitResult.oss_object_key,
            upload_id: uploadInitResult.upload_id,
            reason: error?.message || "上传失败",
          });
        } catch (failError) {
          logMagicUploadStageError("upload fail callback", failError);
        }
      }
      message.error(error?.message || "保存失败。");
    } finally {
      setVideoSubmitting(false);
      setVideoUploadProgress(0);
    }
  };

  const submitPoint = async () => {
    const values = await pointForm.validateFields();
    try {
      if (pointModal?.id) {
        await updateMagicQuizPoint(pointModal.id, values);
      } else {
        await createMagicQuizPoint(quizVideoId, values);
      }
      message.success("节点已保存。");
      setPointModal(null);
      setQuizPoints(await listMagicQuizPoints(quizVideoId));
    } catch (error) {
      message.error(error?.message || "保存节点失败。");
    }
  };

  const submitQuestion = async (pointId, payload, editing) => {
    try {
      if (editing?.id) await updateMagicQuestion(editing.id, payload);
      else await createMagicQuestion(pointId, payload);
      message.success("题目已保存。");
      setQuestionModal(null);
      setQuizPoints(await listMagicQuizPoints(quizVideoId));
    } catch (error) {
      message.error(error?.message || "保存题目失败。");
    }
  };

  const openEmployeeSeriesDetail = (seriesId) => {
    setAcademyView("courses");
    setVideoDetailError(null);
    setSelectedVideoId(null);
    setEmployeeSelectedSeriesId(String(seriesId));
    if (!adminMode) setSearchParams({ tab: "courses", series: String(seriesId) });
  };

  const closeEmployeeSeriesDetail = () => {
    setSelectedVideoId(null);
    setVideoDetail(null);
    setVideoDetailError(null);
    setEmployeeSelectedSeriesId(null);
    if (!adminMode) setSearchParams({ tab: "courses" });
  };

  const openStudyVideo = (videoOrId) => {
    const target = typeof videoOrId === "object"
      ? videoOrId
      : myVideos.find((item) => item.id === videoOrId) || { id: videoOrId };
    if (target?.is_locked) {
      message.warning(target.locked_reason || "请先完成上一节视频后再学习本节");
      return;
    }
    const videoId = target?.id;
    setAcademyView("courses");
    setVideoDetailError(null);
    setEmployeeSelectedSeriesId(target?.series_id ? String(target.series_id) : null);
    setSelectedVideoId(videoId);
    if (!adminMode) {
      const nextParams = { tab: "courses", video: String(videoId) };
      if (target?.series_id) nextParams.series = String(target.series_id);
      setSearchParams(nextParams);
    }
  };

  const backToStudyList = () => {
    setVideoDetailError(null);
    setSelectedVideoId(null);
    setVideoDetail(null);
    watchedRef.current = 0;
    lastSafeTimeRef.current = 0;
    blockingSeekRef.current = false;
    lockedQuizPointIdRef.current = null;
    watchConfirmAccumulatedRef.current = 0;
    watchConfirmLastTimeRef.current = null;
    watchConfirmRoundRef.current = 0;
    setWatchConfirmState({ open: false, round: 0 });
    if (!adminMode) {
      setSearchParams(employeeSelectedSeriesId ? { tab: "courses", series: String(employeeSelectedSeriesId) } : { tab: "courses" });
    }
  };

  const openAdminVideoDetail = (videoId) => {
    setSelectedAdminVideoId(videoId);
    setQuizVideoId(videoId);
  };

  const backToAdminVideoList = () => {
    setSelectedAdminVideoId(null);
    setQuizVideoId(null);
    setQuizPoints([]);
  };

  const handlePublishVideo = async (videoId) => {
    try {
      setPublishingVideoId(videoId);
      await publishMagicVideo(videoId);
      message.success("发布成功");
      await reloadAdminData();
    } catch (error) {
      message.error(error?.message || "发布视频失败。");
    } finally {
      setPublishingVideoId(null);
    }
  };

  const handleDisableVideo = async (videoId) => {
    try {
      setDisablingVideoId(videoId);
      await disableMagicVideo(videoId);
      message.success("已下架");
      await reloadAdminData();
    } catch (error) {
      message.error(error?.message || "下架视频失败。");
    } finally {
      setDisablingVideoId(null);
    }
  };

  const submitSeries = async () => {
    const values = await seriesForm.validateFields();
    try {
      if (seriesModal?.id) {
        await updateMagicVideoSeries(seriesModal.id, values);
        message.success("系列已更新。");
      } else {
        await createMagicVideoSeries(values);
        message.success("系列已创建。");
      }
      setSeriesModal(null);
      await reloadAdminData();
    } catch (error) {
      message.error(error?.message || "系列保存失败。");
    }
  };

  const handleAddSeriesItem = async () => {
    if (!selectedSeriesId || !seriesItemVideoId) {
      message.warning("请先选择系列和视频。");
      return;
    }
    try {
      await addMagicVideoSeriesItem(selectedSeriesId, { video_id: seriesItemVideoId });
      setSeriesItemVideoId(null);
      await reloadAdminData();
      message.success("视频已加入系列。");
    } catch (error) {
      message.error(error?.message || "添加失败。");
    }
  };

  const handleMoveSeriesItem = async (videoId, direction) => {
    if (!selectedSeries?.items?.length) return;
    const currentIndex = selectedSeries.items.findIndex((item) => item.video_id === videoId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selectedSeries.items.length) return;
    const ordered = [...selectedSeries.items];
    const [moved] = ordered.splice(currentIndex, 1);
    ordered.splice(nextIndex, 0, moved);
    try {
      await reorderMagicVideoSeriesItems(selectedSeries.id, {
        video_ids: ordered.map((item) => item.video_id),
      });
      await reloadAdminData();
    } catch (error) {
      message.error(error?.message || "排序失败。");
    }
  };

  const handleSaveWatchConfirmSetting = async () => {
    if (!quizVideoId) {
      message.warning("请先选择视频。");
      return;
    }
    try {
      const values = await watchConfirmForm.validateFields();
      await updateMagicWatchConfirmSetting(quizVideoId, values);
      await reloadAdminData();
      message.success("观看确认配置已保存。");
    } catch (error) {
      message.error(error?.message || "保存失败。");
    }
  };

  const handleQuizSubmit = async () => {
    try {
      const point = quizAnswerState.point;
      const answers = (point?.questions || []).map((question) => ({
        question_id: question.id,
        answer: quizAnswerState.values[question.id],
      }));
      const result = await submitMyMagicQuiz(videoDetail.id, {
        quiz_point_id: point.id,
        answers,
        skip_by_whitelist: false,
      });
      if (!result.passed) {
        message.warning("答错或漏答，需要全部答对才能继续，请重新作答。");
        lockedQuizPointIdRef.current = point?.id || null;
        return;
      }
      message.success("答题通过，可以继续播放。");
      const resumeTime = Number(point?.trigger_second || videoRef.current?.currentTime || 0);
      watchedRef.current = Math.max(watchedRef.current, resumeTime);
      lastSafeTimeRef.current = Math.max(lastSafeTimeRef.current, resumeTime);
      lockedQuizPointIdRef.current = null;
      setQuizAnswerState({ open: false, point: null, values: {} });
      const detail = await fetchMyMagicVideoDetail(videoDetail.id);
      setVideoDetail(detail);
      watchedRef.current = Math.max(detail?.progress?.max_watched_position || 0, watchedRef.current);
      lastSafeTimeRef.current = Math.max(lastSafeTimeRef.current, resumeTime);
      if (videoRef.current) {
        videoRef.current.currentTime = resumeTime;
      }
      videoRef.current?.play?.().catch(() => {});
      await reloadMyData();
    } catch (error) {
      message.error(error?.message || "提交答题失败。");
    }
  };

  const handleWatchConfirmContinue = async () => {
    try {
      const currentTime = Number(videoRef.current?.currentTime || 0);
      await createMagicWatchConfirmLog(videoDetail.id, {
        progress_seconds: currentTime,
        confirm_round: watchConfirmState.round || 1,
      });
    } catch (error) {
      message.warning(error?.message || "确认记录提交失败，已继续播放。");
    } finally {
      watchConfirmAccumulatedRef.current = 0;
      watchConfirmLastTimeRef.current = Number(videoRef.current?.currentTime || 0);
      setWatchConfirmState((prev) => ({ ...prev, open: false }));
      videoRef.current?.play?.().catch(() => {});
    }
  };

  const adminVideoColumns = [
    { title: "标题", dataIndex: "title" },
    { title: "分类", dataIndex: "category", render: (v) => v || "—" },
    {
      title: "系列",
      key: "series",
      render: (_, row) => row.series_id ? `${row.series_title} / 第 ${row.series_order} 节` : "—",
    },
    { title: "时长", dataIndex: "duration_seconds", render: (v) => formatTime(v) },
    {
      title: "状态",
      dataIndex: "status",
      render: (_, row) => {
        const meta = getVideoStatusMeta(row);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: "上传", dataIndex: "upload_status", render: (v) => <Tag color={v === "completed" ? "success" : v === "failed" ? "error" : "processing"}>{v || "completed"}</Tag> },
    { title: "必修", dataIndex: "is_required", render: (v) => v ? <Tag color="gold">必修</Tag> : "—" },
    {
      title: "操作",
      key: "action",
      width: 280,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" type="link" onClick={() => openAdminVideoDetail(row.id)}>查看 / 配置</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => setVideoModal(row)}>编辑</Button>
          {row.status === "published" ? (
            <Tag color="success">已发布</Tag>
          ) : (
            <Button
              size="small"
              type="primary"
              loading={publishingVideoId === row.id}
              disabled={!row.can_publish || disablingVideoId === row.id}
              onClick={() => handlePublishVideo(row.id)}
            >
              发布
            </Button>
          )}
          {row.status === "published" ? (
            <Button
              size="small"
              loading={disablingVideoId === row.id}
              disabled={publishingVideoId === row.id}
              onClick={() => handleDisableVideo(row.id)}
            >
              下架
            </Button>
          ) : null}
          <Popconfirm title="确认删除该视频？" onConfirm={async () => { await deleteMagicVideo(row.id); await reloadAdminData(); }}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const statsColumns = [
    { title: "姓名", dataIndex: "name" },
    { title: "部门", dataIndex: "department", render: (v) => v || "未分配部门" },
    { title: "已观看", dataIndex: "watched_seconds", render: (v) => formatTime(v) },
    { title: "进度", dataIndex: "progress_percent", render: (v) => `${Math.round(v || 0)}%` },
    { title: "完成", dataIndex: "is_completed", render: (v) => v ? <Tag color="success">已完成</Tag> : <Tag>未完成</Tag> },
    { title: "答题通过", dataIndex: "quiz_passed", render: (v) => v ? "是" : "否" },
    { title: "答题次数", dataIndex: "answer_attempt_count" },
    { title: "白名单", dataIndex: "is_whitelist_user", render: (v) => v ? <Tag color="purple">白名单</Tag> : "—" },
  ];

  const answerColumns = [
    { title: "姓名", dataIndex: "name" },
    { title: "节点", dataIndex: "quiz_point", render: (v) => `${formatTime(v)}` },
    { title: "题目", dataIndex: "question", ellipsis: true },
    { title: "用户答案", dataIndex: "user_answer", render: (v) => Array.isArray(v) ? v.join(" / ") : "" },
    { title: "是否正确", dataIndex: "is_correct", render: (v) => v ? "是" : "否" },
    { title: "提交次数", dataIndex: "attempt_no" },
  ];

  const whitelistColumns = [
    { title: "视频", dataIndex: "video_title" },
    { title: "用户", dataIndex: "user_name" },
    { title: "部门", dataIndex: "department", render: (v) => v || "—" },
    { title: "备注", dataIndex: "note", render: (v) => v || "—" },
    {
      title: "操作",
      render: (_, row) => (
        <Popconfirm title="移出白名单？" onConfirm={async () => { await deleteMagicWhitelist(row.id); await reloadAdminData(); }}>
          <Button size="small" danger>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  const audioColumns = [
    { title: "姓名", dataIndex: "name" },
    { title: "部门", dataIndex: "department", render: (v) => v || "—" },
    { title: "月份", dataIndex: "month" },
    { title: "应上传天数", dataIndex: "expected_upload_days" },
    { title: "实际上传天数", dataIndex: "actual_upload_days" },
    { title: "实际上传次数", dataIndex: "actual_upload_count" },
    { title: "补卡次数", dataIndex: "makeup_count" },
    { title: "缺少次数", dataIndex: "missing_count" },
    { title: "上传率", dataIndex: "upload_rate", render: (v) => `${v}%` },
  ];

  const audioExportPath = useMemo(() => {
    const params = new URLSearchParams();
    if (audioMonth) params.set("month", audioMonth);
    if (audioDepartment) params.set("department", audioDepartment);
    if (audioUserId) params.set("user_id", String(audioUserId));
    const query = params.toString();
    return `/api/magic-academy/admin/audio-stats/export${query ? `?${query}` : ""}`;
  }, [audioDepartment, audioMonth, audioUserId]);

  const statsExportPath = useMemo(() => {
    if (!statsVideoId) return "";
    const params = new URLSearchParams();
    if (appliedStatsDepartment) params.set("department", appliedStatsDepartment);
    if (appliedStatsUserId) params.set("user_id", String(appliedStatsUserId));
    const query = params.toString();
    return `/api/magic-academy/videos/${statsVideoId}/export-progress${query ? `?${query}` : ""}`;
  }, [statsVideoId, appliedStatsDepartment, appliedStatsUserId]);

  const answerExportPath = useMemo(() => {
    if (!statsVideoId) return "";
    const params = new URLSearchParams();
    if (appliedStatsDepartment) params.set("department", appliedStatsDepartment);
    if (appliedStatsUserId) params.set("user_id", String(appliedStatsUserId));
    const query = params.toString();
    return `/api/magic-academy/videos/${statsVideoId}/export-answers${query ? `?${query}` : ""}`;
  }, [statsVideoId, appliedStatsDepartment, appliedStatsUserId]);

  const handleStatsSearch = () => {
    setAppliedStatsDepartment(statsDepartment);
    setAppliedStatsUserId(statsUserId || null);
  };

  const handleStatsReset = () => {
    setStatsDepartment("");
    setStatsUserId(null);
    setAppliedStatsDepartment("");
    setAppliedStatsUserId(null);
  };

  const handleExportStats = async (type) => {
    if (!statsVideoId) {
      message.warning("请先选择视频。");
      return;
    }
    if (type === "progress" && statsRows.length === 0) {
      message.warning("当前筛选条件下暂无学习统计数据。");
      return;
    }
    if (type === "answers" && answerRows.length === 0) {
      message.warning("当前筛选条件下暂无答题详情数据。");
      return;
    }
    const path = type === "progress" ? statsExportPath : answerExportPath;
    await saveBlob(await downloadMagicFile(path));
  };

  const handleSaveAudioMakeupSetting = async () => {
    try {
      const nextPayload = {
        enabled: !!audioMakeupSetting.enabled,
        make_up_days: Number(audioMakeupSetting.make_up_days || 0),
      };
      const data = await updateMagicAudioMakeupSetting(nextPayload);
      setAudioMakeupSetting(data || nextPayload);
      message.success("补卡设置已保存。");
    } catch (error) {
      message.error(error?.message || "补卡设置保存失败。");
    }
  };

  const openCreateReadingContentModal = () => {
    setReadingContentModalMode("create");
    setReadingContentEditing(null);
    setReadingContentImageFile(null);
    setReadingImageKeyword("");
    setReadingImageAssets([]);
    readingContentForm.resetFields();
    readingContentForm.setFieldsValue({
      reading_date: dayjs(),
      title: "",
      description: "",
      image_source: "upload",
      material_asset_id: undefined,
      target_type: "user",
      target_user_ids: [],
      target_department_ids: [],
    });
    setReadingContentModalOpen(true);
  };

  const openEditReadingContentModal = async (row) => {
    try {
      const detail = await fetchAdminReadingContentDetail(row.id);
      setReadingContentModalMode("edit");
      setReadingContentEditing(detail);
      setReadingContentImageFile(null);
      setReadingImageKeyword("");
      setReadingImageAssets([]);
      readingContentForm.resetFields();
      readingContentForm.setFieldsValue({
        reading_date: detail?.reading_date ? dayjs(detail.reading_date) : dayjs(),
        title: detail?.title || "",
        description: detail?.description || "",
        image_source: "upload",
        material_asset_id: undefined,
        target_type: detail?.targets?.[0]?.target_type || "user",
        target_user_ids: (detail?.targets || []).filter((item) => item.target_type === "user").map((item) => Number(item.target_id)),
        target_department_ids: (detail?.targets || []).filter((item) => item.target_type === "department").map((item) => item.target_id),
      });
      setReadingContentModalOpen(true);
    } catch (error) {
      message.error(error?.message || "读书内容详情加载失败。");
    }
  };

  const handleSubmitReadingContent = async () => {
    try {
      const values = await readingContentForm.validateFields();
      if (readingContentModalMode === "create" && !readingContentImageFile) {
        message.warning("请先上传读书内容图片。");
        return;
      }
      setReadingContentSubmitting(true);
      const payload = {
        reading_date: values.reading_date.format("YYYY-MM-DD"),
        title: values.title,
        description: values.description || "",
        image_source: values.image_source || "upload",
        material_asset_id: values.material_asset_id || null,
        target_type: values.target_type,
        target_user_ids: values.target_user_ids || [],
        target_department_ids: values.target_department_ids || [],
        image: values.image_source === "upload" ? (readingContentImageFile || undefined) : undefined,
      };
      if (readingContentModalMode === "edit" && readingContentEditing?.id) {
        await updateAdminReadingContent(readingContentEditing.id, payload);
        message.success("读书内容已更新。");
      } else {
        await createAdminReadingContent(payload);
        message.success("读书内容已创建。");
      }
      setReadingContentModalOpen(false);
      setReadingContentEditing(null);
      setReadingContentImageFile(null);
      await reloadAdminReadingContents({ page: 1 });
      setReadingContentPage(1);
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "读书内容保存失败。");
      }
    } finally {
      setReadingContentSubmitting(false);
    }
  };

  const handleDeleteReadingContent = async (row) => {
    try {
      await deleteAdminReadingContent(row.id);
      message.success("读书内容已删除。");
      await reloadAdminReadingContents();
    } catch (error) {
      message.error(error?.message || "删除读书内容失败。");
    }
  };

  const renderEmployeeAudioCell = (value) => {
    const dateText = value.format("YYYY-MM-DD");
    const dayData = myAudioCalendarMap[dateText];
    const makeupData = myAudioMakeupMap[dateText];
    let status = getAudioDayStatus(dateText, dayData);
    if (!dayData?.uploaded && makeupData?.can_makeup) status = "makeup_available";
    else if (!dayData?.uploaded && makeupData?.is_expired) status = "makeup_expired";
    return (
      <div className={`magic-audio-calendar-cell ${status === "future" ? "is-future" : ""}`}>
        {renderAudioStatusTag(status, dayData?.count || 0, 0)}
      </div>
    );
  };

  const renderAdminAudioCell = (value) => {
    const dateText = value.format("YYYY-MM-DD");
    const dayData = adminAudioCalendarMap[dateText];
    const status = getAudioDayStatus(dateText, dayData);
    return (
      <div className={`magic-audio-calendar-cell ${status === "future" ? "is-future" : ""}`}>
        {renderAudioStatusTag(status, dayData?.count || 0, dayData?.uploaded_user_count || 0)}
      </div>
    );
  };

  const renderAudioRecordList = (records, showUser = false) => (
    <List
      dataSource={records}
      locale={{ emptyText: "当天暂无录音上传" }}
      renderItem={(item) => (
        <List.Item>
          <List.Item.Meta
            title={(
              <Space wrap>
                <Text strong>{item.file_name || "未命名录音"}</Text>
                <Tag color={getAudioSourceMeta(item.source).color}>{item.source_label || getAudioSourceMeta(item.source).label}</Tag>
                {showUser && item.user_name ? <Tag>{item.user_name}</Tag> : null}
                {showUser && item.department ? <Tag color="blue">{item.department}</Tag> : null}
              </Space>
            )}
            description={(
              <Space wrap>
                <Text type="secondary">大小：{formatFileSize(item.file_size || 0)}</Text>
                <Text type="secondary">类型：{item.file_type || "—"}</Text>
                <Text type="secondary">备注：{item.remark || "—"}</Text>
                <Text type="secondary">上传时间：{item.uploaded_time?.replace("T", " ").slice(0, 19) || "—"}</Text>
              </Space>
            )}
          />
        </List.Item>
      )}
    />
  );

  const handleSubmitAudioMakeup = async () => {
    try {
      if (!selectedMyAudioMakeup?.can_makeup) {
        message.warning(selectedMyAudioMakeup?.reason || "当前日期不可补卡。");
        return;
      }
      await submitMyAudioMakeup({
        makeup_date: myAudioSelectedDate,
        file_name: "makeup-checkin.m4a",
        file_size: 0,
        mime_type: "audio/m4a",
        remark: audioRemark,
      });
      setAudioRemark("");
      message.success("补卡成功。");
      await reloadMyData();
      await reloadMyAudioCalendar();
    } catch (error) {
      message.error(error?.message || "补卡失败。");
    }
  };

  const studyTabContent = selectedVideoId ? (
    <div className="magic-academy-detail">
      {videoDetailError ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={videoDetailError.message}
        >
          <Button onClick={backToStudyList}>返回课程列表</Button>
        </Empty>
      ) : !videoDetail ? (
        <div className="workspace-panel">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loadingDetail ? "视频详情加载中" : "暂未选择课程"} />
        </div>
      ) : (
        <div className="workspace-dual workspace-dual--lined">
          <div className="workspace-panel">
            <div className="workspace-panel__head">
              <Space size={8} wrap>
                <strong>{videoDetail.title}</strong>
                {videoDetail.is_required ? <Tag bordered={false} color="gold">必修</Tag> : null}
                <Tag bordered={false} color={videoDetail.progress?.is_completed ? "success" : "processing"}>
                  {videoDetail.progress?.is_completed ? "已完成" : "学习中"}
                </Tag>
              </Space>
            </div>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              {videoDetail.description ? (
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>{videoDetail.description}</Paragraph>
              ) : null}
              <ResponsiveVideoPlayer
                videoRef={videoRef}
                src={buildMagicVideoStreamUrl(videoDetail.id)}
                onLoadedMetadata={handleVideoLoaded}
                onTimeUpdate={handleTimeUpdate}
                onSeeking={handleSeeking}
                onPlay={handleVideoPlay}
                onPause={() => saveProgress()}
                onEnded={() => saveProgress()}
              />
              <Progress
                percent={Math.round(videoDetail.progress?.progress_percent || 0)}
                size="small"
                showInfo={false}
              />
              <Space wrap size={[12, 8]}>
                <Text type="secondary">分类：{videoDetail.category || "未分类"}</Text>
                <Text type="secondary">已观看：{formatTime(videoDetail.progress?.max_watched_position || 0)} / {formatTime(videoDetail.duration_seconds || 0)}</Text>
                <Text type="secondary">当前进度：{Math.round(videoDetail.progress?.progress_percent || 0)}%</Text>
              </Space>
              {!videoDetail.progress?.is_completed ? (
                <Text type="secondary">请按顺序观看，节点答题需全部答对方可继续；完成后支持自由回看。</Text>
              ) : null}
              {(videoDetail.quiz_points || []).length > 0 ? (
                <Space wrap size={[8, 8]}>
                  <Text type="secondary" style={{ marginRight: 4 }}>节点答题</Text>
                  {(videoDetail.quiz_points || []).map((point) => (
                    <Tag bordered={false} key={point.id} color={answeredPointIds.has(point.id) ? "success" : "default"}>
                      {formatTime(point.trigger_second)} · {answeredPointIds.has(point.id) ? "已通过" : "待答题"}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Space>
          </div>

          <aside className="workspace-panel workspace-panel--aside">
            <div className="workspace-panel">
              <div className="workspace-panel__head">
                <Space>
                  <BookOutlined />
                  <strong>学习总览</strong>
                </Space>
              </div>
              <div className="workspace-mini-grid">
                <div>
                  <span>总课程</span>
                  <strong>{myVideos.length}</strong>
                </div>
                <div>
                  <span>已完成</span>
                  <strong>{myCompletedVideos.length}</strong>
                </div>
                <div>
                  <span>完成率</span>
                  <strong>{studyCompletionRate}%</strong>
                </div>
                <div>
                  <span>待学必修</span>
                  <strong>{myRequiredVideos.length}</strong>
                </div>
              </div>
            </div>

            {continueStudyVideo && continueStudyVideo.id !== videoDetail.id ? (
              <div className="workspace-panel">
                <div className="workspace-panel__head">
                  <Space>
                    <PlayCircleFilled />
                    <strong>下一步建议</strong>
                  </Space>
                </div>
                <div className="workspace-note-block">
                  <strong>{continueStudyVideo.title}</strong>
                  <p>建议优先处理待学必修和未完成课程，把节奏连起来。</p>
                  <div className="workspace-note-block__actions">
                    <Button type="primary" block onClick={() => openStudyVideo(continueStudyVideo.id)}>
                      切到推荐课程
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  ) : selectedEmployeeSeries ? (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
            <Space direction="vertical" size={2}>
              <Title level={4} style={{ margin: 0 }}>{selectedEmployeeSeries.title}</Title>
              {selectedEmployeeSeries.description ? (
                <Text type="secondary">{selectedEmployeeSeries.description}</Text>
              ) : null}
            </Space>
            <Space wrap>
              <Tag bordered={false}>{`共 ${selectedEmployeeSeries.items.length} 节`}</Tag>
              <Tag bordered={false} color="blue">
                {`已完成 ${selectedEmployeeSeries.items.filter((item) => item.progress?.is_completed).length} / ${selectedEmployeeSeries.items.length}`}
              </Tag>
              {selectedEmployeeSeries.sequentialUnlockEnabled ? <Tag bordered={false} color="purple">顺序解锁</Tag> : null}
            </Space>
          </Space>
          <Progress
            percent={selectedEmployeeSeries.items.length ? Math.round((selectedEmployeeSeries.items.filter((item) => item.progress?.is_completed).length / selectedEmployeeSeries.items.length) * 100) : 0}
            size="small"
            showInfo={false}
          />
        </Space>
      </Card>

      <div className="workspace-line-list">
        {selectedEmployeeSeries.items.map((item, idx) => {
          const progressPercent = Math.round(item.progress?.progress_percent || 0);
          const isCompleted = !!item.progress?.is_completed;
          const isLocked = !!item.is_locked;
          const statusLabel = isCompleted ? "已完成" : isLocked ? "待解锁" : progressPercent > 0 ? "学习中" : "可学习";
          const actionLabel = isCompleted ? "重新学习" : isLocked ? "待解锁" : progressPercent > 0 ? "继续学习" : "开始学习";
          return (
            <div
              key={item.id}
              className="workspace-line-item workspace-line-item--stack fade-in-up"
              style={{ "--fade-delay": `${idx * 60}ms` }}
            >
              <div className="workspace-line-item__content">
                <Space size={[8, 8]} wrap>
                  <strong>{`第 ${item.series_order} 节 · ${item.title}`}</strong>
                  {isCompleted ? (
                    <Tag bordered={false} color="success">已完成</Tag>
                  ) : isLocked ? (
                    <Tag bordered={false} color="default" icon={<LockOutlined />}>待解锁</Tag>
                  ) : (
                    <Tag bordered={false} color="processing">{statusLabel}</Tag>
                  )}
                  {getVideoSourceLabel(item) ? <Tag bordered={false} color="purple">{getVideoSourceLabel(item)}</Tag> : null}
                </Space>
                <span>
                  {item.category || "未分类课程"}
                  {isLocked ? ` · ${item.locked_reason || "请先完成上一节"}` : item.description ? ` · ${item.description.slice(0, 40)}` : ""}
                </span>
                <Progress percent={progressPercent} size="small" showInfo={false} />
              </div>
              <Button type="link" disabled={isLocked} onClick={() => openStudyVideo(item)}>
                {actionLabel}
                <ArrowRightOutlined />
              </Button>
            </div>
          );
        })}
      </div>
    </Space>
  ) : (
    myVideos.length === 0 ? (
      <div className="workspace-panel">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无学习视频" />
      </div>
    ) : (
      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        {myVideoSections.seriesSections.length > 0 ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Text strong>系列课程</Text>
            {myVideoSections.seriesSections.map((section) => (
              <Card
                key={section.key}
                title={section.title}
                extra={section.sequentialUnlockEnabled ? <Tag bordered={false} color="purple">顺序解锁</Tag> : null}
              >
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {section.description ? <Text type="secondary">{section.description}</Text> : null}
                  <Space wrap>
                    <Tag bordered={false}>{`共 ${section.items.length} 节`}</Tag>
                    <Tag bordered={false} color="blue">
                      {`已完成 ${section.items.filter((item) => item.progress?.is_completed).length} / ${section.items.length}`}
                    </Tag>
                  </Space>
                  <Progress
                    percent={section.items.length ? Math.round((section.items.filter((item) => item.progress?.is_completed).length / section.items.length) * 100) : 0}
                    size="small"
                    showInfo={false}
                  />
                  <Button type="primary" onClick={() => openEmployeeSeriesDetail(section.seriesId)}>
                    {section.items.some((item) => !item.progress?.is_completed && !item.is_locked) ? "进入学习" : "查看系列"}
                  </Button>
                </Space>
              </Card>
            ))}
          </Space>
        ) : null}
        {myVideoSections.standalone.length > 0 ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Text strong>普通课程</Text>
            <div className="workspace-line-list">
              {myVideoSections.standalone.map((item, idx) => {
                const progressPercent = Math.round(item.progress?.progress_percent || 0);
                const actionLabel = item.progress?.is_completed ? "重新学习" : progressPercent > 0 ? "继续学习" : "开始学习";
                return (
                  <div
                    key={item.id}
                    className="workspace-line-item workspace-line-item--stack fade-in-up"
                    style={{ "--fade-delay": `${idx * 60}ms` }}
                  >
                    <div className="workspace-line-item__content">
                      <Space size={[8, 8]} wrap>
                        <strong>{item.title}</strong>
                        {item.is_required ? <Tag bordered={false} color="gold">必修</Tag> : null}
                        {item.is_whitelisted ? <Tag bordered={false} color="purple">白名单</Tag> : null}
                        {currentUser?.is_newcomer && item.is_newcomer_required ? <Tag bordered={false} color="gold">新人必看</Tag> : null}
                        <Tag bordered={false} color={item.progress?.is_completed ? "success" : "processing"}>
                          {item.progress?.is_completed ? "已完成" : progressPercent > 0 ? "学习中" : "未开始"}
                        </Tag>
                      </Space>
                      <span>{item.category || "未分类课程"}{item.description ? ` · ${item.description.slice(0, 40)}` : ""}</span>
                      <Progress percent={progressPercent} size="small" showInfo={false} />
                    </div>
                    <Button type="link" onClick={() => openStudyVideo(item)}>
                      {actionLabel}
                      <ArrowRightOutlined />
                    </Button>
                  </div>
                );
              })}
            </div>
          </Space>
        ) : null}
      </Space>
    )
  );

  const audioTabContent = (
    <div className="workspace-dual workspace-dual--lined">
      <div className="workspace-panel">
        <div className="workspace-panel" style={{ marginBottom: 16 }}>
          <div className="workspace-panel__head">
            <Space>
              <ReadOutlined />
              <strong>{myAudioSelectedDate === getTodayText() ? "今日读书内容" : `${myAudioSelectedDate} 读书内容`}</strong>
            </Space>
          </div>
          {selectedReadingContents.length > 0 ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              {selectedReadingContents.map((item) => (
                <Card key={item.id} size="small">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Space wrap>
                      <Text strong>{item.title}</Text>
                      <Tag bordered={false} color="blue">{item.reading_date}</Tag>
                    </Space>
                    {item.description ? <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph> : null}
                    {item.image_url ? (
                      <Image
                        src={item.image_url}
                        alt={item.title}
                        style={{ maxWidth: 420, borderRadius: 12 }}
                        preview={{ src: item.image_url }}
                      />
                    ) : null}
                  </Space>
                </Card>
              ))}
            </Space>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={myAudioSelectedDate === getTodayText() ? "今日暂无读书内容" : "该日期暂无读书内容"}
            />
          )}
        </div>

        <div className="workspace-panel__head">
          <Space>
            <UploadOutlined />
            <strong>提交今日打卡</strong>
          </Space>
          <Tag bordered={false} color={todayUploadedAudio ? "success" : "default"}>
            {todayUploadedAudio ? "今日已上传" : "今日待上传"}
          </Tag>
        </div>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Input.TextArea
            rows={2}
            placeholder="备注（选填）"
            value={audioRemark}
            onChange={(e) => setAudioRemark(e.target.value)}
          />
          <Upload
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              try {
                await uploadMyAudio({
                  file_name: file?.name || "",
                  file_size: Number(file?.size || 0),
                  mime_type: file?.type || "",
                  remark: audioRemark,
                });
                setAudioRemark("");
                message.success("打卡记录已提交。");
                await reloadMyData();
                await reloadMyAudioCalendar();
                onSuccess?.({});
              } catch (error) {
                onError?.(error);
                message.error(error?.message || "上传失败。");
              }
            }}
          >
            <Button type="primary" icon={<UploadOutlined />}>提交打卡记录</Button>
          </Upload>
          <Text type="secondary">支持 mp3、m4a、wav、aac、amr、webm、ogg；仅记录文件名、时间与备注，单文件不超过 50MB。</Text>
        </Space>

        <div className="workspace-panel" style={{ marginTop: 16 }}>
          <div className="workspace-panel__head">
            <Space>
              <CalendarOutlined />
              <strong>我的上传记录</strong>
            </Space>
          </div>
          <Table
            rowKey="id"
            size="middle"
            dataSource={myAudios}
            pagination={{ pageSize: 8 }}
            columns={[
              { title: "文件名", dataIndex: "file_name" },
              { title: "备注", dataIndex: "remark", render: (v) => v || "—" },
              { title: "状态", dataIndex: "status", render: (v) => <Tag bordered={false} color="success">{v || "已上传"}</Tag> },
              { title: "上传时间", dataIndex: "uploaded_time", render: (v) => v?.replace("T", " ").slice(0, 19) || "—" },
              {
                title: "操作",
                render: (_, row) => (
                  <Popconfirm title="确认删除这条录音记录？" onConfirm={async () => {
                    await deleteMyAudio(row.id);
                    await reloadMyData();
                    await reloadMyAudioCalendar();
                  }}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </div>
      </div>

      <aside className="workspace-panel workspace-panel--aside">
        <div className="workspace-panel">
          <div className="workspace-panel__head">
            <Space>
              <CalendarOutlined />
              <strong>上传日历</strong>
            </Space>
          </div>
          <Calendar
            fullscreen={false}
            value={dayjs(myAudioSelectedDate)}
            onSelect={(value) => setMyAudioSelectedDate(value.format("YYYY-MM-DD"))}
            onPanelChange={(value) => {
              setMyAudioMonth(value.format("YYYY-MM"));
              setMyAudioSelectedDate(value.startOf("month").format("YYYY-MM-DD"));
            }}
            cellRender={renderEmployeeAudioCell}
          />
        </div>

        <div className="workspace-panel">
          <div className="workspace-panel__head">
            <Space>
              <BookOutlined />
              <strong>{myAudioSelectedDate || "选中日期"} 的记录</strong>
            </Space>
            {renderAudioStatusTag(
              selectedMyAudioDay?.uploaded
                ? getAudioDayStatus(myAudioSelectedDate, selectedMyAudioDay)
                : selectedMyAudioMakeup?.can_makeup
                  ? "makeup_available"
                  : selectedMyAudioMakeup?.is_expired
                    ? "makeup_expired"
                    : getAudioDayStatus(myAudioSelectedDate, selectedMyAudioDay),
              selectedMyAudioDay?.count || 0,
              0,
            )}
          </div>
          {!selectedMyAudioDay?.uploaded ? (
            <div className="workspace-note-block" style={{ marginBottom: 12 }}>
              <strong>补卡说明</strong>
              <p>{audioMakeupSetting.description || "当前未开启补卡"}</p>
              {selectedMyAudioMakeup?.can_makeup ? (
                <Button type="primary" onClick={handleSubmitAudioMakeup}>
                  补 {myAudioSelectedDate} 的卡
                </Button>
              ) : (
                <Text type="secondary">{selectedMyAudioMakeup?.reason || "当前日期不可补卡"}</Text>
              )}
            </div>
          ) : null}
          {renderAudioRecordList(selectedMyAudioDay?.records || [])}
        </div>
      </aside>
    </div>
  );

  const adminTabs = (adminMode ? [
    {
      key: "video_manage",
      label: "视频管理",
      children: selectedAdminVideo ? (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <button type="button" className="magic-academy-crumb__back" onClick={backToAdminVideoList}>
            <ArrowLeftOutlined />
            <span>返回视频列表</span>
          </button>
          <Card>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div className="magic-video-detail-shell">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>{selectedAdminVideo.title}</Title>
                    <Space wrap>
                      <Tag bordered={false} color={getVideoStatusMeta(selectedAdminVideo).color}>{getVideoStatusMeta(selectedAdminVideo).label}</Tag>
                      <Tag bordered={false} color={selectedAdminVideo.upload_status === "completed" ? "success" : selectedAdminVideo.upload_status === "failed" ? "error" : "processing"}>
                        上传 {selectedAdminVideo.upload_status || "completed"}
                      </Tag>
                      {selectedAdminVideo.is_required ? <Tag bordered={false} color="gold">必修</Tag> : null}
                    </Space>
                  </Space>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>{selectedAdminVideo.description || "暂无简介"}</Paragraph>
                  <ResponsiveVideoPlayer src={buildMagicVideoStreamUrl(selectedAdminVideo.id)} />
                  <Space wrap>
                    <Text>分类：{selectedAdminVideo.category || "未分类"}</Text>
                    <Text>时长：{formatTime(selectedAdminVideo.duration_seconds || 0)}</Text>
                    <Text>文件大小：{formatFileSize(selectedAdminVideo.file_size || 0)}</Text>
                  </Space>
                  <Space wrap>
                    {selectedAdminVideo.status !== "published" ? (
                      <Button
                        type="primary"
                        loading={publishingVideoId === selectedAdminVideo.id}
                        disabled={!selectedAdminVideo.can_publish || disablingVideoId === selectedAdminVideo.id}
                        onClick={() => handlePublishVideo(selectedAdminVideo.id)}
                      >
                        发布
                      </Button>
                    ) : (
                      <Button
                        loading={disablingVideoId === selectedAdminVideo.id}
                        disabled={publishingVideoId === selectedAdminVideo.id}
                        onClick={() => handleDisableVideo(selectedAdminVideo.id)}
                      >
                        下架
                      </Button>
                    )}
                    <Button icon={<EditOutlined />} onClick={() => setVideoModal(selectedAdminVideo)}>编辑视频</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPointModal({})}>新增节点</Button>
                  </Space>
                </Space>
              </div>
            </Space>
          </Card>
          <List
            grid={{ gutter: 16, xs: 1, md: 2 }}
            dataSource={quizPoints}
            locale={{ emptyText: "当前视频还没有配置答题节点" }}
            renderItem={(point) => (
              <List.Item>
                <Card
                  title={`节点 ${formatTime(point.trigger_second)}`}
                  extra={<Space><Button size="small" onClick={() => { pointForm.setFieldsValue(point); setPointModal(point); }}>编辑节点</Button><Button size="small" onClick={() => setQuestionModal({ pointId: point.id })}>新增题目</Button></Space>}
                >
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Tag>题目数 {point.question_count}</Tag>
                    <Tag color={point.enabled ? "success" : "default"}>{point.enabled ? "启用" : "停用"}</Tag>
                    <Tag color="blue">需全部答对</Tag>
                  </Space>
                  <List
                    dataSource={point.questions || []}
                    renderItem={(question) => (
                      <List.Item
                        actions={[
                          <Button key="edit" size="small" onClick={() => setQuestionModal({ ...question, pointId: point.id })}>编辑</Button>,
                          <Popconfirm key="del" title="删除题目？" onConfirm={async () => { await deleteMagicQuestion(question.id); setQuizPoints(await listMagicQuizPoints(selectedAdminVideo.id)); }}>
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={`${QUESTION_TYPE_LABELS[normalizeQuestionType(question.question_type)] || question.question_type} · ${question.stem}`}
                          description={`答案：${(question.correct_answers || []).join(" / ") || "无"}`}
                        />
                      </List.Item>
                    )}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Popconfirm title="删除整个答题节点？" onConfirm={async () => { await deleteMagicQuizPoint(point.id); setQuizPoints(await listMagicQuizPoints(selectedAdminVideo.id)); }}>
                      <Button danger size="small">删除节点</Button>
                    </Popconfirm>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </Space>
      ) : (
        <>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--text-mute)" }}>共 {videos.length} 个视频</span>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setVideoModal({})}>新增视频</Button>
          </div>
          <Table rowKey="id" dataSource={videos} columns={adminVideoColumns} pagination={{ pageSize: 8 }} />
        </>
      ),
    },
    {
      key: "quiz",
      label: "视频答题配置",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card>
            <Space>
              <Text>选择视频：</Text>
              <Select style={{ minWidth: 260 }} value={quizVideoId} onChange={setQuizVideoId} options={videos.map((item) => ({ value: item.id, label: item.title }))} />
              <Button type="primary" onClick={() => { pointForm.resetFields(); setPointModal({}); }}>新增节点</Button>
            </Space>
          </Card>
          <Card title="观看确认弹窗">
            <Form
              form={watchConfirmForm}
              layout="vertical"
              preserve={false}
              initialValues={{
                enabled: false,
                interval_seconds: 300,
                message: "请确认你正在观看视频",
                button_text: "继续学习",
              }}
            >
              <Form.Item label="启用确认弹窗" name="enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item label="弹窗间隔（秒）" name="interval_seconds" rules={[{ required: true, message: "请输入间隔秒数" }]}>
                <InputNumber min={30} max={86400} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="弹窗文案" name="message" rules={[{ required: true, message: "请输入弹窗文案" }]}>
                <Input placeholder="请确认你正在观看视频" />
              </Form.Item>
              <Form.Item label="按钮文案" name="button_text" rules={[{ required: true, message: "请输入按钮文案" }]}>
                <Input placeholder="继续学习" />
              </Form.Item>
              <Button type="primary" onClick={handleSaveWatchConfirmSetting}>保存配置</Button>
            </Form>
          </Card>
          <List
            grid={{ gutter: 16, xs: 1, md: 2 }}
            dataSource={quizPoints}
            renderItem={(point) => (
              <List.Item>
                <Card
                  title={`节点 ${formatTime(point.trigger_second)}`}
                  extra={<Space><Button size="small" onClick={() => { pointForm.setFieldsValue(point); setPointModal(point); }}>编辑节点</Button><Button size="small" onClick={() => setQuestionModal({ pointId: point.id })}>新增题目</Button></Space>}
                >
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Tag>题目数 {point.question_count}</Tag>
                    <Tag color={point.enabled ? "success" : "default"}>{point.enabled ? "启用" : "停用"}</Tag>
                    <Tag color="blue">需全部答对</Tag>
                  </Space>
                  <List
                    dataSource={point.questions || []}
                    renderItem={(question) => (
                      <List.Item
                        actions={[
                          <Button key="edit" size="small" onClick={() => setQuestionModal({ ...question, pointId: point.id })}>编辑</Button>,
                          <Popconfirm key="del" title="删除题目？" onConfirm={async () => { await deleteMagicQuestion(question.id); setQuizPoints(await listMagicQuizPoints(quizVideoId)); }}>
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={`${QUESTION_TYPE_LABELS[normalizeQuestionType(question.question_type)] || question.question_type} · ${question.stem}`}
                          description={`答案：${(question.correct_answers || []).join(" / ") || "无"}`}
                        />
                      </List.Item>
                    )}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Popconfirm title="删除整个答题节点？" onConfirm={async () => { await deleteMagicQuizPoint(point.id); setQuizPoints(await listMagicQuizPoints(quizVideoId)); }}>
                      <Button danger size="small">删除节点</Button>
                    </Popconfirm>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </Space>
      ),
    },
    {
      key: "series",
      label: "系列管理",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card
            title="系列列表"
            extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => {
              seriesForm.resetFields();
              seriesForm.setFieldsValue({ enabled: true, sequential_unlock_enabled: true, description: "" });
              setSeriesModal({});
            }}>新增系列</Button>}
          >
            <Table
              rowKey="id"
              dataSource={videoSeries}
              pagination={false}
              rowSelection={{
                type: "radio",
                selectedRowKeys: selectedSeriesId ? [selectedSeriesId] : [],
                onChange: (keys) => setSelectedSeriesId(keys[0] || null),
              }}
              columns={[
                { title: "系列名称", dataIndex: "title" },
                { title: "描述", dataIndex: "description", render: (value) => value || "—" },
                { title: "视频数", render: (_, row) => row.items?.length || 0 },
                { title: "顺序解锁", dataIndex: "sequential_unlock_enabled", render: (value) => value ? "开启" : "关闭" },
                { title: "状态", dataIndex: "enabled", render: (value) => value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag> },
                {
                  title: "操作",
                  render: (_, row) => (
                    <Space>
                      <Button
                        size="small"
                        onClick={() => {
                          seriesForm.setFieldsValue(row);
                          setSeriesModal(row);
                        }}
                      >
                        编辑
                      </Button>
                      <Popconfirm title="删除该系列？系列下视频只会解除关系，不会删除视频。" onConfirm={async () => {
                        await deleteMagicVideoSeries(row.id);
                        await reloadAdminData();
                        message.success("系列已删除。");
                      }}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
          {selectedSeries ? (
            <Card title={`系列视频 · ${selectedSeries.title}`}>
              <Space wrap style={{ marginBottom: 16 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 320 }}
                  placeholder="选择要加入系列的视频"
                  value={seriesItemVideoId || undefined}
                  onChange={(value) => setSeriesItemVideoId(value || null)}
                  options={availableSeriesVideos.map((item) => ({ value: item.id, label: item.title }))}
                />
                <Button type="primary" onClick={handleAddSeriesItem}>加入系列</Button>
              </Space>
              <Table
                rowKey="video_id"
                dataSource={selectedSeries.items || []}
                pagination={false}
                columns={[
                  { title: "顺序", dataIndex: "sort_order", width: 90 },
                  { title: "视频", dataIndex: "title" },
                  { title: "分类", dataIndex: "category", render: (value) => value || "—" },
                  {
                    title: "操作",
                    render: (_, row, index) => (
                      <Space>
                        <Button size="small" disabled={index === 0} icon={<ArrowUpOutlined />} onClick={() => handleMoveSeriesItem(row.video_id, -1)} />
                        <Button size="small" disabled={index === (selectedSeries.items?.length || 0) - 1} icon={<DownOutlined />} onClick={() => handleMoveSeriesItem(row.video_id, 1)} />
                        <Popconfirm title="确认移出该系列？" onConfirm={async () => {
                          await removeMagicVideoSeriesItem(selectedSeries.id, row.video_id);
                          await reloadAdminData();
                        }}>
                          <Button size="small" danger>移除</Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </Space>
      ),
    },
    {
      key: "stats",
      label: "视频学习统计",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card>
            <Space wrap>
              <Text>选择视频：</Text>
              <Select style={{ minWidth: 260 }} value={statsVideoId} onChange={setStatsVideoId} options={videos.map((item) => ({ value: item.id, label: item.title }))} />
              <Select
                allowClear
                style={{ width: 180 }}
                placeholder="选择部门"
                value={statsDepartment || undefined}
                onChange={(value) => setStatsDepartment(value || "")}
                options={statsDepartmentOptions}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 240 }}
                placeholder="选择员工"
                value={statsUserId || undefined}
                onChange={(value) => setStatsUserId(value || null)}
                options={statsEmployeeOptions}
              />
              <Button type="primary" onClick={handleStatsSearch}>查询</Button>
              <Button onClick={handleStatsReset}>重置</Button>
              <Button icon={<DownloadOutlined />} disabled={!statsVideoId} onClick={() => handleExportStats("progress")}>导出学习统计</Button>
              <Button icon={<DownloadOutlined />} disabled={!statsVideoId} onClick={() => handleExportStats("answers")}>导出答题详情</Button>
            </Space>
          </Card>
          <Card title="学习统计">
            <Table rowKey="user_id" dataSource={statsRows} columns={statsColumns} pagination={{ pageSize: 8 }} />
          </Card>
          <Card title="答题详情">
            <Table rowKey={(row) => `${row.name}-${row.submitted_at}-${row.question}`} dataSource={answerRows} columns={answerColumns} pagination={{ pageSize: 8 }} />
          </Card>
        </Space>
      ),
    },
    superAdminMode ? {
      key: "whitelist",
      label: "视频限制白名单",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card title="添加白名单">
            <Form form={whitelistForm} layout="inline" onFinish={async (values) => {
              try {
                await createMagicWhitelist(values);
                whitelistForm.resetFields();
                await reloadAdminData();
                message.success("已加入白名单。");
              } catch (error) {
                message.error(error?.message || "添加失败。");
              }
            }}>
              <Form.Item name="video_id" rules={[{ required: true, message: "请选择视频" }]}>
                <Select style={{ width: 240 }} placeholder="选择视频" options={videos.map((item) => ({ value: item.id, label: item.title }))} />
              </Form.Item>
              <Form.Item name="user_id" rules={[{ required: true, message: "请选择用户" }]}>
                <Select style={{ width: 240 }} placeholder="选择用户" options={users.filter((item) => item.role === "user").map((item) => ({ value: item.id, label: `${item.real_name || item.display_name || item.username} (${item.username})` }))} />
              </Form.Item>
              <Form.Item name="note">
                <Input style={{ width: 220 }} placeholder="备注（选填）" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit">添加</Button>
              </Form.Item>
            </Form>
          </Card>
          <Card>
            <Table rowKey="id" dataSource={whitelist} columns={whitelistColumns} pagination={{ pageSize: 8 }} />
          </Card>
        </Space>
      ),
    } : null,
    {
      key: "reading_contents",
      label: "读书内容推送",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card>
            <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
              <Space wrap>
                <Input
                  style={{ width: 160 }}
                  placeholder="YYYY-MM"
                  value={readingContentMonth}
                  onChange={(e) => {
                    setReadingContentMonth(e.target.value);
                    setReadingContentPage(1);
                  }}
                />
                <Input.Search
                  style={{ width: 240 }}
                  placeholder="搜索标题/描述"
                  value={readingContentKeyword}
                  onChange={(e) => {
                    setReadingContentKeyword(e.target.value);
                    setReadingContentPage(1);
                  }}
                  onSearch={(value) => {
                    setReadingContentKeyword(value);
                    setReadingContentPage(1);
                  }}
                />
              </Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateReadingContentModal}>
                新增读书内容
              </Button>
            </Space>
          </Card>
          <Card>
            <Table
              rowKey="id"
              dataSource={readingContents}
              pagination={{
                current: readingContentPage,
                pageSize: 20,
                total: readingContentsTotal,
                onChange: (page) => setReadingContentPage(page),
              }}
              columns={[
                { title: "日期", dataIndex: "reading_date", width: 120 },
                { title: "标题", dataIndex: "title" },
                { title: "描述", dataIndex: "description", render: (value) => value || "—" },
                {
                  title: "图片",
                  dataIndex: "image_url",
                  render: (value, row) => value ? (
                    <Image
                      src={value}
                      alt={row.title}
                      width={96}
                      style={{ borderRadius: 8 }}
                      preview={{ src: value }}
                    />
                  ) : "—",
                },
                { title: "推送对象", render: (_, row) => getReadingTargetSummary(row) },
                { title: "推送人数", dataIndex: "push_count", width: 100 },
                { title: "创建人", dataIndex: "creator_name", render: (value) => value || "—", width: 120 },
                { title: "创建时间", dataIndex: "created_at", render: (value) => value?.replace("T", " ").slice(0, 19) || "—", width: 180 },
                {
                  title: "操作",
                  width: 180,
                  render: (_, row) => (
                    <Space>
                      <Button size="small" onClick={() => openEditReadingContentModal(row)}>编辑</Button>
                      <Popconfirm title="删除后员工端将不再显示该读书内容，确认继续？" onConfirm={() => handleDeleteReadingContent(row)}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Space>
      ),
    },
    {
      key: "audio_stats",
      label: "录音上传统计",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card title="补卡设置">
            <Space wrap align="center">
              <Text>开启补卡</Text>
              <Switch
                checked={!!audioMakeupSetting.enabled}
                onChange={(checked) => setAudioMakeupSetting((prev) => ({ ...prev, enabled: checked }))}
              />
              <Text>允许补卡天数</Text>
              <InputNumber
                min={0}
                max={365}
                value={Number(audioMakeupSetting.make_up_days || 0)}
                onChange={(value) => setAudioMakeupSetting((prev) => ({ ...prev, make_up_days: Number(value || 0) }))}
              />
              <Button type="primary" onClick={handleSaveAudioMakeupSetting}>保存设置</Button>
              <Text type="secondary">{audioMakeupSetting.description || "当前未开启补卡"}</Text>
            </Space>
          </Card>
          <Card>
            <Space wrap>
              <Input style={{ width: 160 }} placeholder="YYYY-MM" value={audioMonth} onChange={(e) => setAudioMonth(e.target.value)} />
              <Select
                allowClear
                style={{ width: 180 }}
                placeholder="按部门筛选"
                value={audioDepartment || undefined}
                onChange={(value) => setAudioDepartment(value || "")}
                options={Array.from(new Set(users.map((item) => item.department).filter(Boolean))).map((item) => ({ value: item, label: item }))}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 220 }}
                placeholder="按员工筛选"
                value={audioUserId || undefined}
                onChange={(value) => setAudioUserId(value || null)}
                options={users.filter((item) => item.role === "user").map((item) => ({ value: item.id, label: `${item.real_name || item.display_name || item.username} (${item.username})` }))}
              />
              <Button icon={<DownloadOutlined />} onClick={async () => saveBlob(await downloadMagicFile(audioExportPath))}>导出 Excel</Button>
              <Text type="secondary">管理员只能看统计，不返回音频地址，也不能试听和下载。</Text>
            </Space>
          </Card>
          <Card title="员工录音上传日历">
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Calendar
                fullscreen={false}
                value={dayjs(adminAudioSelectedDate)}
                onSelect={(value) => setAdminAudioSelectedDate(value.format("YYYY-MM-DD"))}
                onPanelChange={(value) => {
                  setAudioMonth(value.format("YYYY-MM"));
                  setAdminAudioSelectedDate(value.startOf("month").format("YYYY-MM-DD"));
                }}
                cellRender={renderAdminAudioCell}
              />
              <Card
                size="small"
                title={`选中日期记录 · ${adminAudioSelectedDate || "未选择日期"}`}
                extra={renderAudioStatusTag(
                  getAudioDayStatus(adminAudioSelectedDate, selectedAdminAudioDay),
                  selectedAdminAudioDay?.count || 0,
                  selectedAdminAudioDay?.uploaded_user_count || 0,
                )}
              >
                {audioUserId ? (
                  renderAudioRecordList(selectedAdminAudioDay?.records || [])
                ) : (
                  renderAudioRecordList(selectedAdminAudioDay?.records || [], true)
                )}
              </Card>
            </Space>
          </Card>
          <Card>
            <Table rowKey="user_id" dataSource={audioRows} columns={audioColumns} pagination={{ pageSize: 8 }} />
          </Card>
        </Space>
      ),
    },
  ].filter(Boolean) : []);

  const renderMagicHome = () => (
    <>
      <section className="showcase-section fade-in-up" style={{ "--fade-delay": "120ms" }}>
        <div className="showcase-section__header">
          <span className="showcase-eyebrow">Modules</span>
          <Title level={2} className="showcase-title">两条主线</Title>
          <p className="showcase-lead">课程学习与读书打卡分开管理，路径更短、信息不混。</p>
        </div>

        <div className="entry-grid entry-grid--two">
          <button
            type="button"
            className="entry-card entry-card--feature fade-in-up"
            style={{ "--fade-delay": "180ms" }}
            onClick={() => openCourseCenter()}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">01</span>
              <span className="entry-card__tag">VIDEO COURSES</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">课程学习</h3>
              <p className="entry-card__subtitle">视频 · 节点答题 · 学习进度</p>
            </div>
            <p className="entry-card__desc">
              {continueStudyVideo
                ? `推荐继续：${continueStudyVideo.title}`
                : "进入课程列表，按推荐顺序逐个完成。"}
            </p>
            <span className="entry-card__cta">
              {continueStudyVideo ? "继续学习" : "浏览课程"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>

          <button
            type="button"
            className="entry-card fade-in-up"
            style={{ "--fade-delay": "260ms" }}
            onClick={openReadingCenter}
          >
            <div className="entry-card__top">
              <span className="entry-card__num">02</span>
              <span className="entry-card__tag">DAILY READING</span>
            </div>
            <span className="entry-card__divider" />
            <div>
              <h3 className="entry-card__title">读书打卡</h3>
              <p className="entry-card__subtitle">每日上传 · 月度统计</p>
            </div>
            <p className="entry-card__desc">
              {todayUploadedAudio
                ? "今天已经完成打卡，可以继续保持节奏。"
                : "今天还没有上传录音，建议学习结束后顺手完成。"}
            </p>
            <span className="entry-card__cta">
              {todayUploadedAudio ? "查看打卡记录" : "去完成打卡"}
              <span className="entry-card__cta-arrow"><ArrowRightOutlined /></span>
            </span>
            <span className="entry-card__bg" />
          </button>
        </div>
      </section>

      <section className="showcase-section">
        <div className="stats-row fade-in-up">
          <div className="stats-row__item">
            <span className="stats-row__value">{myRequiredVideos.length}</span>
            <span className="stats-row__label">待学必修</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{myLearningVideos.length}</span>
            <span className="stats-row__label">进行中</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{myCompletedVideos.length}</span>
            <span className="stats-row__label">已完成</span>
          </div>
          <span className="stats-row__sep">/</span>
          <div className="stats-row__item">
            <span className="stats-row__value">{todayUploadedAudio ? "✓" : "—"}</span>
            <span className="stats-row__label">今日打卡</span>
          </div>
        </div>
      </section>

      {latestAudioRecord ? (
        <section className="showcase-section">
          <div className="workspace-panel">
            <div className="workspace-panel__head">
              <Space>
                <BookOutlined />
                <strong>最近上传</strong>
              </Space>
              <Button type="link" icon={<RightOutlined />} onClick={openReadingCenter}>打卡中心</Button>
            </div>
            <div className="workspace-note-block">
              <strong>{latestAudioRecord.file_name || "未命名录音"}</strong>
              <p>{latestAudioRecord.remark || "暂无备注"}</p>
              <span className="workspace-note-block__meta">
                {latestAudioRecord.uploaded_time?.replace("T", " ").slice(0, 19) || "-"}
              </span>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );

  const renderBreadcrumb = ({ title, subtitle, onBack, backText = "返回课程管理" }) => (
    <div className="magic-academy-crumb fade-in-up">
      <button type="button" className="magic-academy-crumb__back" onClick={onBack}>
        <ArrowLeftOutlined />
        <span>{backText}</span>
      </button>
      <div className="magic-academy-crumb__title">
        <Title level={2} className="showcase-title" style={{ margin: 0, fontSize: 26 }}>{title}</Title>
        {subtitle ? <p className="showcase-lead" style={{ margin: 0 }}>{subtitle}</p> : null}
      </div>
    </div>
  );

  const renderCourseCenter = () => (
    <>
      {selectedVideoId
        ? renderBreadcrumb({
            title: videoDetail?.title || "课程详情",
            subtitle: "按节点答题完成视频学习",
            onBack: backToStudyList,
            backText: selectedEmployeeSeries ? "返回系列详情" : "返回课程列表",
          })
        : selectedEmployeeSeries
          ? renderBreadcrumb({
              title: selectedEmployeeSeries.title,
              subtitle: "系列课程按顺序解锁，完成上一节后自动进入下一节。",
              onBack: closeEmployeeSeriesDetail,
              backText: "返回课程学习",
            })
        : renderBreadcrumb({
            title: "课程学习",
            subtitle: "按推荐顺序学习视频，节点答题需全部答对方可继续。",
            onBack: () => navigate("/workspace/magic"),
            backText: "返回学习工作台",
          })}
      {studyTabContent}
    </>
  );

  const renderReadingCheckin = () => (
    <>
      {renderBreadcrumb({
        title: "读书打卡",
        subtitle: "录音上传、上传日历与历史记录，集中在这里。",
        onBack: openAcademyHome,
        backText: "返回课程管理",
      })}
      {audioTabContent}
    </>
  );

  const userViewContent = !adminMode
    ? (academyView === "courses"
        ? renderCourseCenter()
        : academyView === "reading"
          ? renderReadingCheckin()
          : renderMagicHome())
    : null;

  const yearMark = "魔";

  return (
    <div className={adminMode ? undefined : "workspace-shell workspace-shell--editorial workspace-shell--minimal"}>
      {!adminMode && academyView === "home" ? (
        <section className="showcase-hero">
          <span className="showcase-hero__year" aria-hidden="true">{yearMark}</span>
          <div className="showcase-hero__inner">
            <div className="showcase-hero__intro">
              <span className="showcase-eyebrow fade-in-up" style={{ "--fade-delay": "0ms" }}>
                Magic Academy
              </span>
              <Title level={1} className="showcase-hero__title fade-in-up" style={{ "--fade-delay": "80ms" }}>
                课程 · 答题 · 打卡
              </Title>
              <p className="showcase-hero__english fade-in-up" style={{ "--fade-delay": "160ms" }}>
                KEEP LEARNING · KEEP GROWING
              </p>
              <Paragraph className="showcase-hero__desc fade-in-up" style={{ "--fade-delay": "220ms" }}>
                视频课程帮你建立知识框架，节点答题确认理解深度，
                读书打卡让每天的学习沉淀下来。
              </Paragraph>
              <div className="showcase-hero__actions fade-in-up" style={{ "--fade-delay": "300ms" }}>
                <button
                  type="button"
                  className="cta-arrow-btn"
                  onClick={() => openCourseCenter()}
                >
                  <ReadOutlined />
                  <span>{continueStudyVideo ? "继续学习" : "进入课程"}</span>
                  <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
                </button>
                <button
                  type="button"
                  className="cta-arrow-btn cta-arrow-btn--ghost"
                  onClick={openReadingCenter}
                >
                  <CalendarOutlined />
                  <span>{todayUploadedAudio ? "查看打卡" : "今日打卡"}</span>
                  <span className="cta-arrow-btn__arrow"><ArrowRightOutlined /></span>
                </button>
              </div>
            </div>
            <aside className="showcase-hero__side fade-in-up" style={{ "--fade-delay": "380ms" }}>
              <span className="showcase-hero__side-eyebrow">Learning at a glance</span>
              <ul className="showcase-hero__side-list">
                <li className="showcase-hero__side-item">
                  <span>待学必修</span>
                  <strong>{myRequiredVideos.length}</strong>
                </li>
                <li className="showcase-hero__side-item">
                  <span>进行中</span>
                  <strong>{myLearningVideos.length}</strong>
                </li>
                <li className="showcase-hero__side-item">
                  <span>已完成</span>
                  <strong>{myCompletedVideos.length}</strong>
                </li>
                <li className="showcase-hero__side-item">
                  <span>今日打卡</span>
                  <strong>{todayUploadedAudio ? "已完成" : "待完成"}</strong>
                </li>
              </ul>
            </aside>
          </div>
        </section>
      ) : null}

      {adminMode ? (
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={adminTabs}
        />
      ) : (
        userViewContent
      )}

      <VideoFormModal
        open={!!videoModal}
        editing={videoModal && videoModal.id ? videoModal : null}
        users={users}
        submitting={videoSubmitting}
        uploadProgress={videoUploadProgress}
        onCancel={() => setVideoModal(null)}
        onSubmit={submitVideo}
      />

      <Modal
        open={readingContentModalOpen}
        title={readingContentModalMode === "edit" ? "编辑读书内容" : "新增读书内容"}
        onCancel={() => {
          if (readingContentSubmitting) return;
          setReadingContentModalOpen(false);
          setReadingContentEditing(null);
          setReadingContentImageFile(null);
        }}
        onOk={handleSubmitReadingContent}
        okText="保存"
        confirmLoading={readingContentSubmitting}
        width={760}
        destroyOnHidden
      >
        <Form
          form={readingContentForm}
          layout="vertical"
          preserve={false}
          initialValues={{
            reading_date: dayjs(),
            title: "",
            description: "",
            target_type: "user",
            target_user_ids: [],
            target_department_ids: [],
          }}
        >
          <Form.Item label="阅读日期" name="reading_date" rules={[{ required: true, message: "请选择阅读日期" }]}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="例如：今日阅读：第一章" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
          <Form.Item label="图片来源" name="image_source">
            <Radio.Group
              options={[
                { value: "upload", label: "上传新图片" },
                { value: "material", label: "从素材库选择图片" },
              ]}
            />
          </Form.Item>
          <Form.Item label="推送范围" name="target_type" rules={[{ required: true, message: "请选择推送范围" }]}>
            <Select
              options={[
                { value: "all", label: "全部员工" },
                { value: "department", label: "按部门" },
                { value: "user", label: "指定员工" },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const targetType = getFieldValue("target_type");
              if (targetType === "department") {
                return (
                  <Form.Item label="推送部门" name="target_department_ids" rules={[{ required: true, message: "请选择至少一个部门" }]}>
                    <Select mode="multiple" options={employeeDepartmentOptions} placeholder="选择部门" />
                  </Form.Item>
                );
              }
              if (targetType === "user") {
                return (
                  <Form.Item label="推送员工" name="target_user_ids" rules={[{ required: true, message: "请选择至少一个员工" }]}>
                    <Select
                      mode="multiple"
                      showSearch
                      optionFilterProp="label"
                      options={employeeUsers.map((item) => ({
                        value: item.id,
                        label: `${item.real_name || item.display_name || item.username} (${item.username})`,
                      }))}
                      placeholder="选择员工"
                    />
                  </Form.Item>
                );
              }
              return <Form.Item label="推送对象"><Text type="secondary">当前将推送给全部普通员工。</Text></Form.Item>;
            }}
          </Form.Item>
          {readingImageSource === "upload" ? (
            <Form.Item label="图片" required>
              <Upload
                maxCount={1}
                showUploadList={false}
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                beforeUpload={(file) => {
                  setReadingContentImageFile(file);
                  readingContentForm.setFieldValue("material_asset_id", undefined);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>
                  {readingContentImageFile ? `已选择图片：${readingContentImageFile.name}` : "选择图片"}
                </Button>
              </Upload>
              <Space direction="vertical" size={6} style={{ marginTop: 8 }}>
                {readingContentEditing?.image_url && !readingContentImageFile ? (
                  <Image src={readingContentEditing.image_url} alt={readingContentEditing.title} width={120} />
                ) : null}
                <Text type="secondary">仅支持 jpg / jpeg / png / webp，文件不超过 10MB，图片会直接上传到 OSS。</Text>
              </Space>
            </Form.Item>
          ) : (
            <Card size="small" title="从素材库选择图片">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Input.Search
                  placeholder="搜索图片素材名称 / 项目名"
                  value={readingImageKeyword}
                  onChange={(e) => setReadingImageKeyword(e.target.value)}
                  onSearch={setReadingImageKeyword}
                />
                <Form.Item
                  label="选择图片素材"
                  name="material_asset_id"
                  rules={[{ required: true, message: "请选择素材库图片" }]}
                  style={{ marginBottom: 0 }}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择素材库中的图片素材"
                    options={readingImageAssets.map((item) => ({
                      value: item.id,
                      label: `${item.name} / ${item.project_name || "未分组"}`,
                    }))}
                  />
                </Form.Item>
                {selectedReadingImageAsset ? (
                  <Space direction="vertical" size={6}>
                    <Image
                      src={buildMaterialAssetPreviewUrl(selectedReadingImageAsset.id)}
                      alt={selectedReadingImageAsset.name}
                      width={140}
                    />
                    <Text type="secondary">已选素材：{selectedReadingImageAsset.name}</Text>
                    <Text type="secondary">原文件名：{selectedReadingImageAsset.file_name}</Text>
                    <Text type="secondary">所属项目：{selectedReadingImageAsset.project_name || "—"}</Text>
                  </Space>
                ) : null}
              </Space>
            </Card>
          )}
        </Form>
      </Modal>

      <Modal
        open={watchConfirmState.open}
        title="观看确认"
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={[
          <Button key="continue" type="primary" onClick={handleWatchConfirmContinue}>
            {videoDetail?.watch_confirm_setting?.button_text || "继续学习"}
          </Button>,
        ]}
      >
        <Paragraph style={{ marginBottom: 0 }}>
          {videoDetail?.watch_confirm_setting?.message || "请确认你正在观看视频"}
        </Paragraph>
      </Modal>

      <Modal
        open={!!seriesModal}
        title={seriesModal?.id ? "编辑系列" : "新增系列"}
        onCancel={() => setSeriesModal(null)}
        onOk={submitSeries}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={seriesForm} layout="vertical" preserve={false} initialValues={seriesModal || { enabled: true, sequential_unlock_enabled: true }}>
          <Form.Item label="系列名称" name="title" rules={[{ required: true, message: "请输入系列名称" }]}>
            <Input placeholder="例如：新人入职系列" />
          </Form.Item>
          <Form.Item label="系列描述" name="description">
            <Input.TextArea rows={3} placeholder="系列说明（选填）" />
          </Form.Item>
          <Form.Item label="启用顺序解锁" name="sequential_unlock_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="启用系列" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!pointModal} title={pointModal?.id ? "编辑答题节点" : "新增答题节点"} onCancel={() => setPointModal(null)} onOk={submitPoint} destroyOnHidden>
        <Form form={pointForm} layout="vertical" preserve={false} initialValues={pointModal || { trigger_second: 0, question_count: 0, pass_score: 100, enabled: true }}>
          <Form.Item label="触发时间（秒）" name="trigger_second" rules={[{ required: true, message: "请输入触发时间" }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="题目数量" name="question_count">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <QuestionFormModal
        open={!!questionModal}
        editing={questionModal?.id ? questionModal : null}
        pointId={questionModal?.pointId}
        onCancel={() => setQuestionModal(null)}
        onSubmit={submitQuestion}
      />

      <Modal
        open={quizAnswerState.open}
        title={quizAnswerState.point ? `答题节点 ${formatTime(quizAnswerState.point.trigger_second)}` : "答题"}
        onCancel={() => {}}
        onOk={handleQuizSubmit}
        closable={false}
        maskClosable={false}
        okText="提交答案"
        cancelButtonProps={{ style: { display: "none" } }}
        width={720}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          {(quizAnswerState.point?.questions || []).map((question, index) => (
            <Card key={question.id} size="small" title={`${index + 1}. ${question.stem}`}>
              {renderQuestionAnswer(question, quizAnswerState.values[question.id], (value) => {
                setQuizAnswerState((prev) => ({
                  ...prev,
                  values: { ...prev.values, [question.id]: value },
                }));
              })}
            </Card>
          ))}
        </Space>
      </Modal>
    </div>
  );
}
