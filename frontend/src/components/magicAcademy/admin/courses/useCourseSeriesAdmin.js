import { useCallback, useMemo, useState } from "react";

import {
  addMagicVideoSeriesItem,
  createMagicVideoSeries,
  deleteMagicVideoSeries,
  removeMagicVideoSeriesItem,
  reorderMagicVideoSeriesItems,
  updateMagicVideoSeries,
} from "../../../../lib/api.magic";

export default function useCourseSeriesAdmin({
  seriesForm,
  selectedSeriesId,
  videoSeries,
  videos,
  reloadAdminData,
  message,
}) {
  const [seriesModal, setSeriesModal] = useState(null);
  const [seriesItemVideoId, setSeriesItemVideoId] = useState(null);

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

  const submitSeries = useCallback(async () => {
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
  }, [message, reloadAdminData, seriesForm, seriesModal]);

  const handleAddSeriesItem = useCallback(async () => {
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
  }, [message, reloadAdminData, selectedSeriesId, seriesItemVideoId]);

  const handleMoveSeriesItem = useCallback(async (videoId, direction) => {
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
  }, [message, reloadAdminData, selectedSeries]);

  const openCreateSeriesModal = useCallback(() => {
    seriesForm.resetFields();
    seriesForm.setFieldsValue({ enabled: true, sequential_unlock_enabled: true, description: "" });
    setSeriesModal({});
  }, [seriesForm]);

  const openEditSeriesModal = useCallback((row) => {
    seriesForm.setFieldsValue(row);
    setSeriesModal(row);
  }, [seriesForm]);

  const handleDeleteSeries = useCallback(async (seriesId) => {
    await deleteMagicVideoSeries(seriesId);
    await reloadAdminData();
    message.success("系列已删除。");
  }, [message, reloadAdminData]);

  const handleRemoveSeriesItem = useCallback(async (seriesId, videoId) => {
    await removeMagicVideoSeriesItem(seriesId, videoId);
    await reloadAdminData();
  }, [reloadAdminData]);

  return {
    seriesModal,
    setSeriesModal,
    seriesItemVideoId,
    setSeriesItemVideoId,
    selectedSeries,
    availableSeriesVideos,
    submitSeries,
    handleAddSeriesItem,
    handleMoveSeriesItem,
    openCreateSeriesModal,
    openEditSeriesModal,
    handleDeleteSeries,
    handleRemoveSeriesItem,
  };
}
