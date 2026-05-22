/** 学员端「考试」API：试卷派发、答题、结果。 */
import { getJson, postJson } from "./http";

/** 我的考试列表（试卷派发）。 */
export async function fetchMyPaperAssignments() {
  return getJson("/api/papers/my-assignments", "考试列表加载失败。");
}

/** 答题用：取试卷题目（不含正确答案）。 */
export async function fetchAssignmentForTaking(assignmentId) {
  return getJson(`/api/papers/assignments/${assignmentId}`, "考试详情加载失败。");
}

/** 我的答题记录列表。 */
export async function fetchMyAssignmentSubmissions(assignmentId) {
  return getJson(
    `/api/papers/assignments/${assignmentId}/my-submissions`,
    "答题记录加载失败。",
  );
}

/** 提交答卷。 */
export async function submitAssignment(assignmentId, answers) {
  return postJson(
    `/api/papers/assignments/${assignmentId}/submit`,
    { answers },
    "提交失败。",
  );
}

/** 学员视角的答卷详情（含得分；正确答案是否展示由后端按试卷设置控制）。 */
export async function fetchMySubmissionResult(submissionId) {
  return getJson(`/api/papers/submissions/${submissionId}`, "答卷加载失败。");
}
