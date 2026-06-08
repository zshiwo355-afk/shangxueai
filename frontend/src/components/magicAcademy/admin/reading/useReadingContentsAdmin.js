import { useEffect, useState } from "react";

import {
  createAdminReadingContent,
  createAdminReadingContentsBatch,
  fetchAdminReadingContentDetail,
  fetchAdminReadingContents,
  fetchAdminReadingSeries,
  updateAdminReadingContent,
} from "../../../../lib/api.magic";

export default function useReadingContentsAdmin({
  enabled = false,
  filterOptionsEnabled = false,
  month,
  setMonth,
  message,
  showLoadError,
  onRowsLoaded,
}) {
  const [readingContentKeyword, setReadingContentKeyword] = useState("");
  const [readingContentPage, setReadingContentPage] = useState(1);
  const [readingContentPageSize, setReadingContentPageSize] = useState(10);
  const [readingContentSeriesId, setReadingContentSeriesId] = useState(null);
  const [readingContents, setReadingContents] = useState([]);
  const [readingContentsTotal, setReadingContentsTotal] = useState(0);
  const [readingContentSeriesFilterRows, setReadingContentSeriesFilterRows] = useState([]);
  const [readingContentModalOpen, setReadingContentModalOpen] = useState(false);
  const [readingContentModalMode, setReadingContentModalMode] = useState("create");
  const [readingContentEditing, setReadingContentEditing] = useState(null);
  const [readingContentPreferredSeriesId, setReadingContentPreferredSeriesId] = useState(null);
  const [readingContentSubmitting, setReadingContentSubmitting] = useState(false);

  const reloadReadingContents = async (params = {}) => {
    const result = await fetchAdminReadingContents({
      month: params.month ?? month,
      keyword: params.keyword ?? readingContentKeyword,
      series_id: params.series_id ?? readingContentSeriesId ?? undefined,
      page: params.page ?? readingContentPage,
      page_size: params.page_size ?? readingContentPageSize,
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    setReadingContents(items);
    setReadingContentsTotal(Number(result?.total || 0));
    await onRowsLoaded?.(items);
  };

  const reloadReadingContentSeriesFilterOptions = async () => {
    const result = await fetchAdminReadingSeries({ page: 1, page_size: 200 });
    setReadingContentSeriesFilterRows(Array.isArray(result?.items) ? result.items : []);
  };

  const openCreateReadingContentModal = () => {
    setReadingContentModalMode("create");
    setReadingContentEditing(null);
    setReadingContentPreferredSeriesId(null);
    setReadingContentModalOpen(true);
  };

  const closeReadingContentModal = () => {
    setReadingContentModalOpen(false);
    setReadingContentEditing(null);
  };

  const openEditReadingContentModal = async (row) => {
    try {
      if (row?.has_checkins || row?.is_locked) {
        message.warning("该内容已有打卡记录，为保证统计一致性，核心字段不可修改。");
      }
      const detail = await fetchAdminReadingContentDetail(row.id);
      setReadingContentModalMode("edit");
      setReadingContentEditing(detail);
      setReadingContentPreferredSeriesId(null);
      setReadingContentModalOpen(true);
    } catch (error) {
      message.error(error?.message || "读书内容详情加载失败。");
    }
  };

  const handleSubmitReadingContent = async (modalItems) => {
    try {
      setReadingContentSubmitting(true);
      const items = Array.isArray(modalItems) ? modalItems : [];
      if (readingContentModalMode === "edit" && readingContentEditing?.id) {
        const editItem = items[0];
        const payload = {
          reading_date: editItem.reading_date,
          push_time: editItem.push_time,
          title: editItem.title,
          description: editItem.description || "",
          image_source: editItem.image_source || "upload",
          material_asset_id: editItem.material_asset_id || null,
          series_id: editItem.series_id || null,
          image_url: editItem.image_source === "upload" && !editItem.image ? (editItem.image_url || "") : "",
          target_type: editItem.target_type || "user",
          target_user_ids: editItem.target_user_ids || [],
          target_department_ids: editItem.target_department_ids || [],
          target_position_ids: editItem.target_position_ids || [],
          target_job_level_ids: editItem.target_job_level_ids || [],
          target_employment_status_ids: editItem.target_employment_status_ids || [],
          targets: editItem.targets || [],
          makeup_deadline_at: editItem.makeup_deadline_at || "",
          image: editItem.image || undefined,
        };
        await updateAdminReadingContent(readingContentEditing.id, payload);
        message.success("读书内容已更新。");
      } else {
        const payloadItems = items.map((item) => ({
          client_key: item.client_key,
          reading_date: item.reading_date,
          push_time: item.push_time,
          title: item.title,
          description: item.description || "",
          image_source: item.image_source || "upload",
          material_asset_id: item.material_asset_id || null,
          series_id: item.series_id || null,
          image_url: item.image_source === "upload" && !item.image ? (item.image_url || "") : "",
          target_type: item.target_type || "user",
          target_user_ids: item.target_user_ids || [],
          target_department_ids: item.target_department_ids || [],
          target_position_ids: item.target_position_ids || [],
          target_job_level_ids: item.target_job_level_ids || [],
          target_employment_status_ids: item.target_employment_status_ids || [],
          targets: item.targets || [],
          makeup_deadline_at: item.makeup_deadline_at || "",
          image: item.image || null,
        }));
        if (payloadItems.length === 1) {
          await createAdminReadingContent(payloadItems[0]);
        } else {
          await createAdminReadingContentsBatch({ items: payloadItems });
        }
        const firstReadingDate = payloadItems[0]?.reading_date || "";
        const nextMonth = firstReadingDate ? String(firstReadingDate).slice(0, 7) : "";
        if (nextMonth) {
          setMonth?.(nextMonth);
        }
        message.success("读书内容已创建。");
      }
      setReadingContentModalOpen(false);
      setReadingContentEditing(null);
      setReadingContentPreferredSeriesId(null);
      setReadingContentPage(1);
      await reloadReadingContents({
        page: 1,
        month: readingContentModalMode === "edit"
          ? month
          : (items[0]?.reading_date ? String(items[0].reading_date).slice(0, 7) : month),
      });
    } catch (error) {
      message.error(error?.message || "读书内容保存失败。");
    } finally {
      setReadingContentSubmitting(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    reloadReadingContents().catch((error) => {
      if (typeof showLoadError === "function") {
        showLoadError("magic-reading-contents", error, "读书内容列表加载失败。");
        return;
      }
      message.error(error?.message || "读书内容列表加载失败。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, month, readingContentKeyword, readingContentPage, readingContentPageSize, readingContentSeriesId]);

  useEffect(() => {
    if (!filterOptionsEnabled) return;
    reloadReadingContentSeriesFilterOptions().catch((error) => {
      if (typeof showLoadError === "function") {
        showLoadError("magic-reading-content-series-filter-options", error, "读书内容系列筛选选项加载失败。");
        return;
      }
      message.error(error?.message || "读书内容系列筛选选项加载失败。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterOptionsEnabled]);

  return {
    readingContentKeyword,
    setReadingContentKeyword,
    readingContentPage,
    setReadingContentPage,
    readingContentPageSize,
    setReadingContentPageSize,
    readingContentSeriesId,
    setReadingContentSeriesId,
    readingContents,
    setReadingContents,
    readingContentsTotal,
    setReadingContentsTotal,
    readingContentSeriesFilterRows,
    setReadingContentSeriesFilterRows,
    readingContentModalOpen,
    setReadingContentModalOpen,
    readingContentModalMode,
    setReadingContentModalMode,
    readingContentEditing,
    setReadingContentEditing,
    readingContentPreferredSeriesId,
    setReadingContentPreferredSeriesId,
    readingContentSubmitting,
    setReadingContentSubmitting,
    reloadReadingContents,
    reloadReadingContentSeriesFilterOptions,
    openCreateReadingContentModal,
    openEditReadingContentModal,
    closeReadingContentModal,
    handleSubmitReadingContent,
  };
}
