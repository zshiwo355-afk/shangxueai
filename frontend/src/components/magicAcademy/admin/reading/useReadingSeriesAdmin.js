import { Modal } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import {
  archiveAdminReadingSeries,
  createAdminReadingSeries,
  fetchAdminReadingSeries,
  fetchAdminReadingSeriesDetail,
  updateAdminReadingSeries,
} from "../../../../lib/api.magic";
import {
  buildSeriesTargetFormValues,
  isReadingDateOutOfRange,
  normalizeSeriesTargetsFromForm,
} from "../../magicAcademyPageHelpers";

export default function useReadingSeriesAdmin({
  enabled = false,
  optionsEnabled = false,
  readingSeriesForm,
  reloadReadingContentSeriesFilterOptions,
  setReadingContentPreferredSeriesId,
  message,
  showLoadError,
  onSeriesChanged,
}) {
  const [readingSeriesRows, setReadingSeriesRows] = useState([]);
  const [readingSeriesSelectRows, setReadingSeriesSelectRows] = useState([]);
  const [readingSeriesModal, setReadingSeriesModal] = useState(null);
  const [readingSeriesKeyword, setReadingSeriesKeyword] = useState("");
  const [readingSeriesPage, setReadingSeriesPage] = useState(1);
  const [readingSeriesTotal, setReadingSeriesTotal] = useState(0);
  const [readingSeriesStatus, setReadingSeriesStatus] = useState("");
  const [readingSeriesSubmitting, setReadingSeriesSubmitting] = useState(false);
  const [readingSeriesRefreshKey, setReadingSeriesRefreshKey] = useState(0);
  const [readingSeriesDetailOpen, setReadingSeriesDetailOpen] = useState(false);
  const [readingSeriesDetailLoading, setReadingSeriesDetailLoading] = useState(false);
  const [readingSeriesDetail, setReadingSeriesDetail] = useState(null);

  const reloadReadingSeries = async (params = {}) => {
    const result = await fetchAdminReadingSeries({
      keyword: params.keyword ?? readingSeriesKeyword,
      status: params.status ?? readingSeriesStatus,
      page: params.page ?? readingSeriesPage,
      page_size: 10,
    });
    setReadingSeriesRows(Array.isArray(result?.items) ? result.items : []);
    setReadingSeriesTotal(Number(result?.total || 0));
  };

  const reloadReadingSeriesSelectOptions = async () => {
    const result = await fetchAdminReadingSeries({ page: 1, page_size: 100, only_selectable: true });
    setReadingSeriesSelectRows(Array.isArray(result?.items) ? result.items : []);
  };

  const openReadingSeriesModal = (row = null) => {
    readingSeriesForm.resetFields();
    readingSeriesForm.setFieldsValue({
      title: row?.title || "",
      description: row?.description || "",
      date_range: row?.start_date && row?.end_date ? [dayjs(row.start_date), dayjs(row.end_date)] : null,
      status: row?.status || "draft",
      ...buildSeriesTargetFormValues(row?.targets || []),
    });
    setReadingSeriesModal(row || {});
  };

  const closeReadingSeriesModal = () => {
    setReadingSeriesModal(null);
  };

  const handleSubmitReadingSeries = async () => {
    try {
      const values = await readingSeriesForm.validateFields();
      setReadingSeriesSubmitting(true);
      const payload = {
        title: values.title,
        description: values.description || "",
        start_date: values.date_range?.[0] ? values.date_range[0].format("YYYY-MM-DD") : null,
        end_date: values.date_range?.[1] ? values.date_range[1].format("YYYY-MM-DD") : null,
        status: values.status || "draft",
        targets: normalizeSeriesTargetsFromForm(values),
      };
      if (!payload.targets.length) {
        message.warning("当前系列未设置派发对象，后续新增内容时需要单独选择派发对象。");
      }
      if (readingSeriesModal?.id && Number(readingSeriesModal.content_count || 0) > 0) {
        const detail = await fetchAdminReadingSeriesDetail(readingSeriesModal.id);
        const outOfRangeCount = (detail?.contents || []).filter((item) => (
          isReadingDateOutOfRange(item.reading_date, payload.start_date, payload.end_date)
        )).length;
        if (outOfRangeCount > 0) {
          const confirmed = await new Promise((resolve) => {
            Modal.confirm({
              title: "计划周期变更确认",
              content: `该系列下已有 ${outOfRangeCount} 条读书内容超出新的计划周期，保存后这些内容会被标记为超出周期，但不会删除。是否继续？`,
              okText: "继续保存",
              cancelText: "取消",
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });
          if (!confirmed) return;
        }
      }
      if (readingSeriesModal?.id) {
        await updateAdminReadingSeries(readingSeriesModal.id, payload);
        message.success("读书系列已更新。");
      } else {
        const createdSeries = await createAdminReadingSeries(payload);
        setReadingContentPreferredSeriesId?.(createdSeries?.id || null);
        message.success("读书系列已创建。");
      }
      closeReadingSeriesModal();
      await Promise.all([
        reloadReadingSeriesSelectOptions(),
        reloadReadingContentSeriesFilterOptions?.(),
      ]);
      setReadingSeriesRefreshKey((prev) => prev + 1);
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error?.message || "读书系列保存失败。");
    } finally {
      setReadingSeriesSubmitting(false);
    }
  };

  const openReadingSeriesDetail = async (row) => {
    try {
      setReadingSeriesDetailLoading(true);
      setReadingSeriesDetailOpen(true);
      const detail = await fetchAdminReadingSeriesDetail(row.id);
      setReadingSeriesDetail(detail);
    } catch (error) {
      message.error(error?.message || "读书系列详情加载失败。");
    } finally {
      setReadingSeriesDetailLoading(false);
    }
  };

  const handleArchiveReadingSeries = async (row) => {
    try {
      await archiveAdminReadingSeries(row.id);
      message.success("读书系列已归档。");
      await reloadReadingSeries();
      await reloadReadingSeriesSelectOptions();
      await onSeriesChanged?.();
    } catch (error) {
      message.error(error?.message || "归档读书系列失败。");
    }
  };

  const handleToggleReadingSeriesStatus = async (row) => {
    const nextStatus = row.status === "active" ? "paused" : "active";
    if (nextStatus === "paused") {
      const confirmed = await new Promise((resolve) => {
        Modal.confirm({
          title: "暂停读书系列",
          content: "暂停后该系列不会默认用于新增读书内容，但历史内容和员工端已创建任务不受影响。是否继续？",
          okText: "继续暂停",
          cancelText: "取消",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    try {
      await updateAdminReadingSeries(row.id, {
        title: row.title,
        description: row.description || "",
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        status: nextStatus,
        targets: row.targets || [],
      });
      message.success(nextStatus === "active" ? "读书系列已启用。" : "读书系列已暂停。");
      await reloadReadingSeries();
      await reloadReadingSeriesSelectOptions();
      await onSeriesChanged?.();
    } catch (error) {
      message.error(error?.message || "更新读书系列状态失败。");
    }
  };

  useEffect(() => {
    if (!enabled) return;
    reloadReadingSeries().catch((error) => {
      if (typeof showLoadError === "function") {
        showLoadError("magic-reading-series", error, "读书系列列表加载失败。");
        return;
      }
      message.error(error?.message || "读书系列列表加载失败。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, readingSeriesRefreshKey, readingSeriesKeyword, readingSeriesStatus, readingSeriesPage]);

  useEffect(() => {
    if (!optionsEnabled) return;
    reloadReadingSeriesSelectOptions().catch((error) => {
      if (typeof showLoadError === "function") {
        showLoadError("magic-reading-series-options", error, "读书系列选项加载失败。");
        return;
      }
      message.error(error?.message || "读书系列选项加载失败。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsEnabled]);

  return {
    readingSeriesRows,
    readingSeriesSelectRows,
    setReadingSeriesSelectRows,
    readingSeriesModal,
    setReadingSeriesModal,
    readingSeriesKeyword,
    setReadingSeriesKeyword,
    readingSeriesPage,
    setReadingSeriesPage,
    readingSeriesTotal,
    readingSeriesStatus,
    setReadingSeriesStatus,
    readingSeriesSubmitting,
    setReadingSeriesSubmitting,
    readingSeriesRefreshKey,
    setReadingSeriesRefreshKey,
    readingSeriesDetailOpen,
    setReadingSeriesDetailOpen,
    readingSeriesDetailLoading,
    setReadingSeriesDetailLoading,
    readingSeriesDetail,
    setReadingSeriesDetail,
    reloadReadingSeries,
    reloadReadingSeriesSelectOptions,
    openReadingSeriesModal,
    closeReadingSeriesModal,
    handleSubmitReadingSeries,
    openReadingSeriesDetail,
    handleArchiveReadingSeries,
    handleToggleReadingSeriesStatus,
  };
}
