import { deleteJson, getJson, postJson, putJson } from "./http";

const publicBase = "/api/public/personality-forms";
const adminBase = "/api/admin/personality-assessments";

export const getPublicAssessment = (code) =>
  getJson(`${publicBase}/${encodeURIComponent(code)}`, "加载测评失败");

export const createAssessmentDraft = (code, profile) =>
  postJson(`${publicBase}/${encodeURIComponent(code)}/drafts`, { profile }, "创建答卷失败");

export const getAssessmentDraft = (code, token) =>
  getJson(
    `${publicBase}/${encodeURIComponent(code)}/drafts/${encodeURIComponent(token)}`,
    "恢复答卷失败",
  );

export const saveAssessmentDraft = (code, token, payload) =>
  putJson(
    `${publicBase}/${encodeURIComponent(code)}/drafts/${encodeURIComponent(token)}`,
    payload,
    "保存答卷失败",
  );

export const submitAssessmentDraft = (code, token, payload) =>
  postJson(
    `${publicBase}/${encodeURIComponent(code)}/drafts/${encodeURIComponent(token)}/submit`,
    payload,
    "提交答卷失败",
  );

export const listAssessmentForms = () => getJson(`${adminBase}/forms`, "加载表单失败");
export const getAssessmentQuestionnaire = () =>
  getJson(`${adminBase}/questionnaire`, "加载原始题目失败");
export const createAssessmentForm = (payload) => postJson(`${adminBase}/forms`, payload, "创建表单失败");
export const updateAssessmentForm = (id, payload) => putJson(`${adminBase}/forms/${id}`, payload, "更新表单失败");
export const setAssessmentFormStatus = (id, status) =>
  postJson(`${adminBase}/forms/${id}/status`, { status }, "更新表单状态失败");
export const deleteAssessmentForm = (id) =>
  deleteJson(`${adminBase}/forms/${id}`, "删除表单失败");
export const duplicateAssessmentForm = (id) =>
  postJson(`${adminBase}/forms/${id}/duplicate`, {}, "复制表单失败");

export const listAssessmentSubmissions = (formId, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return getJson(`${adminBase}/forms/${formId}/submissions${suffix}`, "加载答卷失败");
};
export const deleteAssessmentSubmissions = (formId, submissionIds) =>
  postJson(
    `${adminBase}/forms/${formId}/submissions/delete`,
    { submission_ids: submissionIds },
    "删除答卷失败",
  );

export const getAssessmentSubmission = (id) =>
  getJson(`${adminBase}/submissions/${id}`, "加载答卷详情失败");
export const markAssessmentOfficial = (id) =>
  postJson(`${adminBase}/submissions/${id}/mark-official`, {}, "更新正式记录失败");
export const generateAssessmentAI = (id, regenerate = false) =>
  postJson(`${adminBase}/submissions/${id}/ai-analysis`, { regenerate }, "生成 AI 分析失败");
export const anonymizeAssessmentSubmission = (id) =>
  postJson(`${adminBase}/submissions/${id}/anonymize`, {}, "匿名化答卷失败");
