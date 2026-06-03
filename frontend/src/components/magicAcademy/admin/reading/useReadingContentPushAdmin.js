import { Modal } from "antd";
import { useState } from "react";

import {
  getReadingPushEntries,
  getReadingPushSummary,
  retryReadingPush,
} from "../../../../lib/api.magic";

export default function useReadingContentPushAdmin({
  message,
}) {
  const [readingPushSummaryMap, setReadingPushSummaryMap] = useState({});
  const [pushDetailOpen, setPushDetailOpen] = useState(false);
  const [pushDetailLoading, setPushDetailLoading] = useState(false);
  const [pushDetailTitle, setPushDetailTitle] = useState("");
  const [pushDetailRows, setPushDetailRows] = useState([]);
  const [pushDetailTarget, setPushDetailTarget] = useState(null);
  const [retryingReadingContentId, setRetryingReadingContentId] = useState(null);

  const loadReadingPushSummaries = async (items) => {
    const rows = Array.isArray(items) ? items : [];
    const summaries = await Promise.all(
      rows.map(async (item) => {
        try {
          const result = await getReadingPushSummary(item.id);
          return [item.id, result?.item || null];
        } catch {
          return [item.id, null];
        }
      }),
    );
    setReadingPushSummaryMap(Object.fromEntries(summaries));
  };

  const refreshReadingPushSummary = async (contentId) => {
    try {
      const result = await getReadingPushSummary(contentId);
      setReadingPushSummaryMap((prev) => ({ ...prev, [contentId]: result?.item || null }));
      return result?.item || null;
    } catch {
      return null;
    }
  };

  const closeReadingContentPushDetail = () => {
    setPushDetailOpen(false);
    setPushDetailTarget(null);
    setPushDetailTitle("");
    setPushDetailRows([]);
  };

  const loadReadingContentPushDetail = async (target) => {
    try {
      setPushDetailLoading(true);
      setPushDetailOpen(true);
      setPushDetailTarget(target);
      setPushDetailTitle(target.title);
      const summary = readingPushSummaryMap[target.id] || await refreshReadingPushSummary(target.id);
      const batchId = summary?.id;
      const result = await getReadingPushEntries(target.id, batchId);
      setPushDetailRows(Array.isArray(result?.items) ? result.items : []);
    } catch (error) {
      message.error(error?.message || "推送明细加载失败。");
      setPushDetailOpen(false);
    } finally {
      setPushDetailLoading(false);
    }
  };

  const refreshOpenPushDetailIfNeeded = async (id) => {
    if (!pushDetailOpen || !pushDetailTarget || pushDetailTarget.id !== id) return;
    await loadReadingContentPushDetail(pushDetailTarget);
  };

  const openReadingContentPushDetail = async (row) => {
    await loadReadingContentPushDetail({
      type: "reading_content",
      id: row.id,
      title: `${row.title} · 推送明细`,
    });
  };

  const handleRetryReadingPush = (row) => {
    Modal.confirm({
      title: "确认立即补推",
      content: "本次只会补推历史未成功接收的人和当前新增命中的人，已成功接收的人不会重复推送。确认立即补推吗？",
      okText: "确认补推",
      cancelText: "取消",
      onOk: async () => {
        try {
          setRetryingReadingContentId(row.id);
          const result = await retryReadingPush(row.id);
          if (result?.status === "noop") {
            message.info("没有可补推对象。");
          } else {
            message.success(`补推完成：成功 ${result?.success_count || 0}，失败 ${result?.failed_count || 0}，跳过 ${result?.skipped_count || 0}`);
          }
          await refreshReadingPushSummary(row.id);
          await refreshOpenPushDetailIfNeeded(row.id);
        } catch (error) {
          if (error?.status === 409) {
            message.warning("当前存在推送中任务，请稍后再试。");
          } else {
            message.error(error?.message || "读书补推失败。");
          }
        } finally {
          setRetryingReadingContentId(null);
        }
      },
    });
  };

  return {
    readingPushSummaryMap,
    setReadingPushSummaryMap,
    pushDetailOpen,
    setPushDetailOpen,
    pushDetailLoading,
    setPushDetailLoading,
    pushDetailTitle,
    setPushDetailTitle,
    pushDetailRows,
    setPushDetailRows,
    pushDetailTarget,
    setPushDetailTarget,
    retryingReadingContentId,
    setRetryingReadingContentId,
    loadReadingPushSummaries,
    refreshReadingPushSummary,
    loadReadingContentPushDetail,
    openReadingContentPushDetail,
    closeReadingContentPushDetail,
    handleRetryReadingPush,
  };
}
