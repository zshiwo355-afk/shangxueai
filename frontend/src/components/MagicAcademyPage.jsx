import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UploadOutlined,
  VideoCameraOutlined,
  DownloadOutlined,
  CheckCircleFilled,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildMagicVideoStreamUrl,
  completeMagicVideoUpload,
  createMagicQuestion,
  createMagicQuizPoint,
  createMagicWhitelist,
  deleteMagicQuestion,
  deleteMagicQuizPoint,
  deleteMagicVideo,
  deleteMagicWhitelist,
  deleteMyAudio,
  disableMagicVideo,
  downloadMagicFile,
  failMagicVideoUpload,
  fetchMagicAudioStats,
  fetchMagicVideoAnswers,
  fetchMagicVideoStats,
  fetchMyAudios,
  fetchMyMagicVideoDetail,
  fetchMyMagicVideos,
  initMagicVideoUpload,
  listMagicQuizPoints,
  listMagicVideos,
  listMagicWhitelist,
  publishMagicVideo,
  saveMyMagicVideoProgress,
  submitMyMagicQuiz,
  updateMagicQuestion,
  updateMagicQuizPoint,
  updateMagicVideo,
  uploadMyAudio,
} from "../lib/api.magic";
import { adminListUsers } from "../lib/api.admin";
import { getCurrentUser, isAdmin } from "../lib/auth";

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
  const { message } = AntdApp.useApp();
  const optionSource = useMemo(() => targetsToOptions(users), [users]);

  useEffect(() => {
    if (!open) return;
    const currentTargets = editing?.targets || [{ target_type: "all_users", target_value: "" }];
    form.setFieldsValue({
      title: editing?.title || "",
      description: editing?.description || "",
      category: editing?.category || "",
      is_required: !!editing?.is_required,
      is_newcomer_required: !!editing?.is_newcomer_required,
      duration_seconds: editing?.duration_seconds || 0,
      status: editing?.status || "draft",
      targets: currentTargets.length ? currentTargets : [{ target_type: "all_users", target_value: "" }],
    });
    setUploadMeta(editing ? {
      file_name: editing.file_name,
      file_path: editing.file_path,
      mime_type: editing.mime_type,
      file_size: editing.file_size,
      duration_seconds: editing.duration_seconds || 0,
      original_filename: editing.original_filename || editing.file_name,
    } : null);
    setSelectedFile(null);
  }, [editing, form, open]);

  const handleOk = async () => {
    const values = await form.validateFields();
    if (!editing?.id && !selectedFile) {
      message.error("请先上传视频文件。");
      return;
    }
    if (editing?.id && selectedFile) {
      message.error("当前版本暂不支持在编辑时替换视频文件，请仅修改元数据或重新新建视频。");
      return;
    }
    const payload = {
      title: values.title,
      description: values.description || "",
      category: values.category || "",
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
      title={editing ? "编辑视频" : "新增视频"}
      onCancel={onCancel}
      onOk={handleOk}
      width={860}
      okText={submitting ? `上传中 ${uploadProgress}%` : "保存"}
      okButtonProps={{ disabled: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="视频标题" name="title" rules={[{ required: true, message: "请输入视频标题" }]}>
          <Input placeholder="例如：新人必看 - 品牌介绍" />
        </Form.Item>
        <Form.Item label="视频简介" name="description">
          <Input.TextArea rows={3} placeholder="选填" />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item label="视频分类" name="category" style={{ minWidth: 180 }}>
            <Input placeholder="例如：新人培训" />
          </Form.Item>
          <Form.Item label="视频时长（秒）" name="duration_seconds" style={{ minWidth: 180 }}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="状态" name="status" initialValue="draft" style={{ minWidth: 180 }}>
            <Select options={[{ value: "draft", label: "草稿" }, { value: "published", label: "已发布" }, { value: "disabled", label: "停用" }]} />
          </Form.Item>
        </Space>
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
              {editing ? "重新选择视频（当前版本仅展示，不会替换）" : "选择视频文件"}
            </Button>
          </Upload>
          <Space direction="vertical" size={4} style={{ marginTop: 8, color: "var(--text-mute)" }}>
            <Text type="secondary">
              {uploadMeta ? `文件名：${uploadMeta.original_filename || uploadMeta.file_name}` : "尚未选择文件"}
            </Text>
            {uploadMeta ? <Text type="secondary">文件大小：{formatFileSize(uploadMeta.file_size)}</Text> : null}
            {uploadMeta ? <Text type="secondary">文件类型：{uploadMeta.mime_type || "未知"}</Text> : null}
            {submitting ? <Progress percent={uploadProgress} size="small" /> : null}
          </Space>
        </Form.Item>
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
    <Modal open={open} title={editing ? "编辑题目" : "新增题目"} onCancel={onCancel} onOk={handleOk} destroyOnClose>
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

export default function MagicAcademyPage() {
  const adminMode = isAdmin();
  const currentUser = getCurrentUser();
  const { message } = AntdApp.useApp();
  const [activeTab, setActiveTab] = useState(adminMode ? "video_manage" : "study");
  const [users, setUsers] = useState([]);
  const [videos, setVideos] = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  const [statsRows, setStatsRows] = useState([]);
  const [answerRows, setAnswerRows] = useState([]);
  const [audioRows, setAudioRows] = useState([]);
  const [myVideos, setMyVideos] = useState([]);
  const [myAudios, setMyAudios] = useState([]);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [videoDetail, setVideoDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [videoModal, setVideoModal] = useState(null);
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [quizVideoId, setQuizVideoId] = useState(null);
  const [quizPoints, setQuizPoints] = useState([]);
  const [pointModal, setPointModal] = useState(null);
  const [questionModal, setQuestionModal] = useState(null);
  const [statsVideoId, setStatsVideoId] = useState(null);
  const [whitelistForm] = Form.useForm();
  const [pointForm] = Form.useForm();
  const [quizAnswerState, setQuizAnswerState] = useState({ open: false, point: null, values: {} });
  const [audioRemark, setAudioRemark] = useState("");
  const [audioMonth, setAudioMonth] = useState("");
  const [audioDepartment, setAudioDepartment] = useState("");
  const [audioUserId, setAudioUserId] = useState(null);
  const videoRef = useRef(null);
  const progressTimerRef = useRef(null);
  const watchedRef = useRef(0);
  const answeredPointIds = useMemo(() => new Set(videoDetail?.progress?.answered_point_ids || []), [videoDetail]);

  const reloadAdminData = async () => {
    if (!adminMode) return;
    const [userData, videoData, whitelistData] = await Promise.all([
      adminListUsers(),
      listMagicVideos(),
      listMagicWhitelist(),
    ]);
    setUsers(Array.isArray(userData) ? userData : []);
    setVideos(Array.isArray(videoData) ? videoData : []);
    setWhitelist(Array.isArray(whitelistData) ? whitelistData : []);
    if (!statsVideoId && videoData?.[0]?.id) setStatsVideoId(videoData[0].id);
    if (!quizVideoId && videoData?.[0]?.id) setQuizVideoId(videoData[0].id);
  };

  const reloadMyData = async () => {
    const [videoData, audioData] = await Promise.all([fetchMyMagicVideos(), fetchMyAudios()]);
    setMyVideos(Array.isArray(videoData) ? videoData : []);
    setMyAudios(Array.isArray(audioData) ? audioData : []);
    if (!selectedVideoId && videoData?.[0]?.id) setSelectedVideoId(videoData[0].id);
  };

  useEffect(() => {
    (async () => {
      try {
        await reloadMyData();
        await reloadAdminData();
      } catch (error) {
        message.error(error?.message || "魔学院数据加载失败。");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== "study") {
      setVideoDetail(null);
      return;
    }
    if (!selectedVideoId) {
      setVideoDetail(null);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    fetchMyMagicVideoDetail(selectedVideoId)
      .then((data) => {
        if (!alive) return;
        setVideoDetail(data);
        watchedRef.current = Math.max(data?.progress?.max_watched_position || 0, 0);
      })
      .catch((error) => {
        if (alive) message.error(error?.message || "视频详情加载失败。");
      })
      .finally(() => {
        if (alive) setLoadingDetail(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedVideoId, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizVideoId || !adminMode) return;
    listMagicQuizPoints(quizVideoId).then(setQuizPoints).catch((error) => {
      message.error(error?.message || "答题节点加载失败。");
    });
  }, [quizVideoId, adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!statsVideoId || !adminMode) return;
    Promise.all([fetchMagicVideoStats(statsVideoId), fetchMagicVideoAnswers(statsVideoId)])
      .then(([stats, answers]) => {
        setStatsRows(Array.isArray(stats) ? stats : []);
        setAnswerRows(Array.isArray(answers) ? answers : []);
      })
      .catch((error) => message.error(error?.message || "统计加载失败。"));
  }, [statsVideoId, adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const saveProgress = async (extra = {}) => {
    if (activeTab !== "study") return;
    if (!videoDetail?.id || !videoRef.current) return;
    const element = videoRef.current;
    try {
      const data = await saveMyMagicVideoProgress(videoDetail.id, {
        current_position: element.currentTime || 0,
        max_watched_position: watchedRef.current || 0,
        duration_seconds: element.duration || videoDetail.duration_seconds || 0,
        page_visible: !document.hidden,
        ...extra,
      });
      setVideoDetail((prev) => ({ ...prev, progress: data.progress }));
    } catch (error) {
      logMagicUploadStageError("progress report", error);
    }
  };

  const maybeOpenQuiz = (currentTime) => {
    if (!videoDetail || videoDetail.is_whitelisted) return;
    const nextPoint = (videoDetail.quiz_points || []).find((point) => (
      point.enabled && !answeredPointIds.has(point.id) && currentTime >= point.trigger_second
    ));
    if (nextPoint) {
      videoRef.current?.pause();
      setQuizAnswerState({ open: true, point: nextPoint, values: {} });
    }
  };

  const handleVideoLoaded = () => {
    if (!videoRef.current || !videoDetail) return;
    const saved = Number(videoDetail.progress?.current_position || 0);
    videoRef.current.currentTime = saved;
    watchedRef.current = Math.max(Number(videoDetail.progress?.max_watched_position || 0), saved);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || !videoDetail) return;
    if (document.hidden) {
      videoRef.current.pause();
      return;
    }
    const currentTime = videoRef.current.currentTime || 0;
    watchedRef.current = Math.max(watchedRef.current, currentTime);
    maybeOpenQuiz(currentTime);
  };

  const handleSeeking = () => {
    if (!videoRef.current || !videoDetail || videoDetail.is_whitelisted) return;
    const allowed = Math.max(watchedRef.current, Number(videoDetail.progress?.max_watched_position || 0));
    if (videoRef.current.currentTime > allowed + 1) {
      videoRef.current.currentTime = allowed;
      message.warning("当前视频暂不支持快进到未观看位置。");
    }
  };

  useEffect(() => {
    if (activeTab !== "study") return undefined;
    const listener = () => {
      if (document.hidden) {
        videoRef.current?.pause();
        saveProgress({ page_visible: false });
      }
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, [videoDetail, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== "study") {
      clearInterval(progressTimerRef.current);
      return undefined;
    }
    if (!videoDetail?.id) return;
    clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => saveProgress(), 5000);
    return () => clearInterval(progressTimerRef.current);
  }, [videoDetail?.id, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitVideo = async (payload) => {
    let uploadInitResult = null;
    let uploadCompleted = false;
    try {
      setVideoSubmitting(true);
      setVideoUploadProgress(0);
      if (videoModal?.id) {
        await updateMagicVideo(videoModal.id, payload);
        message.success("视频已更新。");
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
        message.warning(`本次得分 ${result.score}，未达到 ${result.required_score} 分，请重新作答。`);
        return;
      }
      message.success("答题通过，可以继续播放。");
      setQuizAnswerState({ open: false, point: null, values: {} });
      const detail = await fetchMyMagicVideoDetail(videoDetail.id);
      setVideoDetail(detail);
      watchedRef.current = Math.max(detail?.progress?.max_watched_position || 0, watchedRef.current);
      videoRef.current?.play?.().catch(() => {});
      await reloadMyData();
    } catch (error) {
      message.error(error?.message || "提交答题失败。");
    }
  };

  const adminVideoColumns = [
    { title: "标题", dataIndex: "title" },
    { title: "分类", dataIndex: "category", render: (v) => v || "—" },
    { title: "时长", dataIndex: "duration_seconds", render: (v) => formatTime(v) },
    { title: "状态", dataIndex: "status", render: (v) => <Tag color={v === "published" ? "success" : v === "disabled" ? "default" : "processing"}>{v}</Tag> },
    { title: "上传", dataIndex: "upload_status", render: (v) => <Tag color={v === "completed" ? "success" : v === "failed" ? "error" : "processing"}>{v || "completed"}</Tag> },
    { title: "必修", dataIndex: "is_required", render: (v) => v ? <Tag color="gold">必修</Tag> : "—" },
    {
      title: "操作",
      key: "action",
      width: 280,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => setVideoModal(row)}>编辑</Button>
          <Button size="small" onClick={async () => { await publishMagicVideo(row.id); await reloadAdminData(); }}>发布</Button>
          <Button size="small" onClick={async () => { await disableMagicVideo(row.id); await reloadAdminData(); }}>停用</Button>
          <Popconfirm title="确认删除该视频？" onConfirm={async () => { await deleteMagicVideo(row.id); await reloadAdminData(); }}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const statsColumns = [
    { title: "姓名", dataIndex: "name" },
    { title: "部门", dataIndex: "department", render: (v) => v || "—" },
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

  const userTabs = [
    {
      key: "study",
      label: "我的学习",
      children: (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
          <Card title="学习任务" variant="outlined">
            {myVideos.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无学习视频" /> : (
              <List
                dataSource={myVideos}
                renderItem={(item) => (
                  <List.Item
                    style={{ cursor: "pointer", background: selectedVideoId === item.id ? "rgba(24,144,255,0.06)" : "transparent", paddingInline: 8 }}
                    onClick={() => setSelectedVideoId(item.id)}
                  >
                    <List.Item.Meta
                      avatar={<VideoCameraOutlined style={{ fontSize: 18, color: "var(--accent)" }} />}
                      title={<Space>{item.title}{item.is_required ? <Tag color="gold">必修</Tag> : null}{item.is_whitelisted ? <Tag color="purple">白名单</Tag> : null}</Space>}
                      description={
                        <Space direction="vertical" size={4}>
                          <Text type="secondary">{item.category || "未分类"}</Text>
                          <Progress percent={Math.round(item.progress?.progress_percent || 0)} size="small" />
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
          <Card title={videoDetail?.title || "选择一个视频开始学习"} loading={loadingDetail}>
            {!videoDetail ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可学习视频" /> : (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>{videoDetail.description || "暂无简介"}</Paragraph>
                <Space wrap>
                  <Tag>{videoDetail.category || "未分类"}</Tag>
                  <Tag color={videoDetail.progress?.is_completed ? "success" : "processing"}>{videoDetail.progress?.is_completed ? "已完成" : "学习中"}</Tag>
                  {currentUser?.is_newcomer && videoDetail.is_newcomer_required ? <Tag color="gold">新人必看</Tag> : null}
                </Space>
                <video
                  ref={videoRef}
                  src={buildMagicVideoStreamUrl(videoDetail.id)}
                  controls
                  style={{ width: "100%", background: "#000", borderRadius: 12 }}
                  onLoadedMetadata={handleVideoLoaded}
                  onTimeUpdate={handleTimeUpdate}
                  onSeeking={handleSeeking}
                  onPause={() => saveProgress()}
                  onEnded={() => saveProgress()}
                />
                <Space wrap>
                  <Text>当前进度：{Math.round(videoDetail.progress?.progress_percent || 0)}%</Text>
                  <Text>已观看：{formatTime(videoDetail.progress?.max_watched_position || 0)} / {formatTime(videoDetail.duration_seconds || 0)}</Text>
                  {videoDetail.progress?.is_completed ? <Tag icon={<CheckCircleFilled />} color="success">已完成</Tag> : null}
                </Space>
                {(videoDetail.quiz_points || []).length > 0 ? (
                  <Card size="small" title="答题节点">
                    <Space wrap>
                      {(videoDetail.quiz_points || []).map((point) => (
                        <Tag key={point.id} color={answeredPointIds.has(point.id) ? "success" : "default"}>
                          {formatTime(point.trigger_second)} / {answeredPointIds.has(point.id) ? "已通过" : "待答题"}
                        </Tag>
                      ))}
                    </Space>
                  </Card>
                ) : null}
              </Space>
            )}
          </Card>
        </div>
      ),
    },
    {
      key: "audio",
      label: "我的录音",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card title="上传读书录音">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input.TextArea rows={2} placeholder="备注（选填）" value={audioRemark} onChange={(e) => setAudioRemark(e.target.value)} />
              <Upload
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  try {
                    await uploadMyAudio(file, audioRemark);
                    setAudioRemark("");
                    message.success("录音已上传。");
                    await reloadMyData();
                    onSuccess?.({});
                  } catch (error) {
                    onError?.(error);
                    message.error(error?.message || "上传失败。");
                  }
                }}
              >
                <Button type="primary" icon={<UploadOutlined />}>上传录音</Button>
              </Upload>
              <Text type="secondary">支持 mp3、m4a、wav、aac、amr、webm、ogg，单个文件不超过 50MB。</Text>
            </Space>
          </Card>
          <Card title="我的上传记录">
            <Table
              rowKey="id"
              dataSource={myAudios}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: "文件名", dataIndex: "file_name" },
                { title: "大小", dataIndex: "file_size", render: (v) => `${(v / 1024 / 1024).toFixed(2)}MB` },
                { title: "类型", dataIndex: "file_type" },
                { title: "备注", dataIndex: "remark", render: (v) => v || "—" },
                { title: "上传时间", dataIndex: "uploaded_time", render: (v) => v?.replace("T", " ").slice(0, 19) || "—" },
                {
                  title: "操作",
                  render: (_, row) => (
                    <Popconfirm title="确认删除这条录音记录？" onConfirm={async () => { await deleteMyAudio(row.id); await reloadMyData(); }}>
                      <Button size="small" danger>删除</Button>
                    </Popconfirm>
                  ),
                },
              ]}
            />
          </Card>
        </Space>
      ),
    },
  ];

  const adminTabs = adminMode ? [
    {
      key: "video_manage",
      label: "视频管理",
      children: (
        <Card extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setVideoModal({})}>新增视频</Button>}>
          <Table rowKey="id" dataSource={videos} columns={adminVideoColumns} pagination={{ pageSize: 8 }} />
        </Card>
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
                    <Tag>通过分 {point.pass_score}</Tag>
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
      key: "stats",
      label: "视频学习统计",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card>
            <Space wrap>
              <Text>选择视频：</Text>
              <Select style={{ minWidth: 260 }} value={statsVideoId} onChange={setStatsVideoId} options={videos.map((item) => ({ value: item.id, label: item.title }))} />
              <Button icon={<DownloadOutlined />} onClick={async () => saveBlob(await downloadMagicFile(`/api/magic-academy/videos/${statsVideoId}/export-progress`))}>导出学习统计</Button>
              <Button icon={<DownloadOutlined />} onClick={async () => saveBlob(await downloadMagicFile(`/api/magic-academy/videos/${statsVideoId}/export-answers`))}>导出答题详情</Button>
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
    {
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
    },
    {
      key: "audio_stats",
      label: "录音上传统计",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
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
          <Card>
            <Table rowKey="user_id" dataSource={audioRows} columns={audioColumns} pagination={{ pageSize: 8 }} />
          </Card>
        </Space>
      ),
    },
  ] : [];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Card variant="borderless" style={{ background: "linear-gradient(135deg, #0f766e, #155e75)", color: "#fff" }}>
          <Space direction="vertical" size={6}>
            <Space>
              <Title level={3} style={{ margin: 0, color: "#fff" }}>魔学院</Title>
              {adminMode ? <Tag color="gold">管理员视图</Tag> : <Tag color="blue">员工视图</Tag>}
            </Space>
            <Text style={{ color: "rgba(255,255,255,0.88)" }}>
              覆盖视频学习、节点答题、学习统计、白名单，以及读书录音上传和月度统计。
            </Text>
          </Space>
        </Card>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            ...userTabs,
            ...adminTabs,
          ]}
        />
      </Space>

      <VideoFormModal
        open={!!videoModal}
        editing={videoModal && videoModal.id ? videos.find((item) => item.id === videoModal.id) : null}
        users={users}
        submitting={videoSubmitting}
        uploadProgress={videoUploadProgress}
        onCancel={() => setVideoModal(null)}
        onSubmit={submitVideo}
      />

      <Modal open={!!pointModal} title={pointModal?.id ? "编辑答题节点" : "新增答题节点"} onCancel={() => setPointModal(null)} onOk={submitPoint} destroyOnClose>
        <Form form={pointForm} layout="vertical" preserve={false} initialValues={pointModal || { trigger_second: 0, question_count: 0, pass_score: 60, enabled: true }}>
          <Form.Item label="触发时间（秒）" name="trigger_second" rules={[{ required: true, message: "请输入触发时间" }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="题目数量" name="question_count">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="通过分数" name="pass_score">
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
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
