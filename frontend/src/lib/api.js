/** 兼容入口：从这里继续导出训练相关 API；新代码请直接 import 具体的 api.*.js。 */
export {
  startTraining,
  sendChat,
  finishTraining,
  resetTraining,
  fetchMyTrainingRecords,
  fetchTrainingRecord,
} from "./api.training";
export { fetchOptions } from "./api.options";
