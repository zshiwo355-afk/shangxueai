import { Modal } from "antd";
import { useCallback, useMemo, useState } from "react";

import { adminListUsers } from "../../../../lib/api.admin";
import {
  batchDeleteMagicVideos,
  batchDisableMagicVideos,
  batchPublishMagicVideos,
  deleteMagicVideo,
  deleteMagicWhitelist,
  disableMagicVideo,
  getCoursePushEntries,
  getCoursePushSummary,
  listMagicVideoSeries,
  listMagicVideos,
  listMagicWhitelist,
  publishMagicVideo,
  retryCoursePush,
} from "../../../../lib/api.magic";
import {
  buildAdminVideoColumns,
  buildStatsColumns,
  buildWhitelistColumns,
} from "../../adminColumns";
import { saveBlob } from "../../magicAcademyShared";

export default function useCourseAdminSupport({
  adminMode,
  superAdminMode,
  adminVideoPage,
  setAdminVideoPage,
  adminVideoPageSize,
  setAdminVideoPageSize,
  selectedAdminVideoRowKeys,
  setSelectedAdminVideoRowKeys,
  selectedAdminVideoId,
  setSelectedAdminVideoId,
  statsVideoId,
  setStatsVideoId,
  statsDepartment,
  setStatsDepartment,
  statsUserId,
  setStatsUserId,
  appliedStatsDepartment,
  setAppliedStatsDepartment,
  appliedStatsUserId,
  setAppliedStatsUserId,
  quizVideoId,
  setQuizVideoId,
  setQuizPoints,
  selectedSeriesId,
  setSelectedSeriesId,
  videos,
  setVideos,
  users,
  setUsers,
  videoSeries,
  setVideoSeries,
  whitelist,
  setWhitelist,
  statsRows,
  setStatsRows,
  answerRows,
  setAnswerRows,
  statsDepartmentOptions,
  statsEmployeeOptions,
  setVideoModal,
  downloadMagicFile,
  fetchMagicVideoAnswers,
  fetchMagicVideoStats,
  getVideoStatusMeta,
  message,
  showLoadError,
  shouldLoadAdminVideoData,
}) {
  const [adminVideoItems, setAdminVideoItems] = useState([]);
  const [adminVideoTotal, setAdminVideoTotal] = useState(0);
  const [publishingVideoId, setPublishingVideoId] = useState(null);
  const [disablingVideoId, setDisablingVideoId] = useState(null);
  const [videoPushSummaryMap, setVideoPushSummaryMap] = useState({});
  const [coursePushDetailOpen, setCoursePushDetailOpen] = useState(false);
  const [coursePushDetailLoading, setCoursePushDetailLoading] = useState(false);
  const [coursePushDetailTitle, setCoursePushDetailTitle] = useState("");
  const [coursePushDetailRows, setCoursePushDetailRows] = useState([]);
  const [retryingVideoId, setRetryingVideoId] = useState(null);
  const [coursePushDetailTarget, setCoursePushDetailTarget] = useState(null);

  const selectedAdminVideo = useMemo(
    () => videos.find((item) => item.id === selectedAdminVideoId) || null,
    [selectedAdminVideoId, videos],
  );

  const loadVideoPushSummaries = useCallback(async (items) => {
    const rows = Array.isArray(items) ? items : [];
    const summaries = await Promise.all(
      rows.map(async (item) => {
        try {
          const result = await getCoursePushSummary(item.id);
          return [item.id, result?.item || null];
        } catch {
          return [item.id, null];
        }
      }),
    );
    setVideoPushSummaryMap(Object.fromEntries(summaries));
  }, []);

  const reloadAdminData = useCallback(async () => {
    if (!adminMode) return;
    const [userData, videoData, pagedVideoData, whitelistData, seriesData] = await Promise.all([
      adminListUsers(),
      listMagicVideos(),
      listMagicVideos({ page: adminVideoPage, page_size: adminVideoPageSize }),
      superAdminMode ? listMagicWhitelist() : Promise.resolve([]),
      listMagicVideoSeries(),
    ]);
    setUsers(Array.isArray(userData) ? userData : []);
    setVideos(Array.isArray(videoData) ? videoData : []);
    const adminVideoList = Array.isArray(pagedVideoData?.items) ? pagedVideoData.items : (Array.isArray(pagedVideoData) ? pagedVideoData : []);
    setAdminVideoItems(adminVideoList);
    setAdminVideoTotal(Number(pagedVideoData?.total ?? (Array.isArray(pagedVideoData) ? pagedVideoData.length : 0)));
    setSelectedAdminVideoRowKeys([]);
    setWhitelist(Array.isArray(whitelistData) ? whitelistData : []);
    setVideoSeries(Array.isArray(seriesData) ? seriesData : []);
    await loadVideoPushSummaries(adminVideoList);
    if (!statsVideoId && videoData?.[0]?.id) setStatsVideoId(videoData[0].id);
    if (!quizVideoId && videoData?.[0]?.id) setQuizVideoId(videoData[0].id);
    if (!selectedSeriesId && seriesData?.[0]?.id) setSelectedSeriesId(seriesData[0].id);
  }, [
    adminMode,
    adminVideoPage,
    adminVideoPageSize,
    loadVideoPushSummaries,
    quizVideoId,
    selectedSeriesId,
    setQuizVideoId,
    setSelectedAdminVideoRowKeys,
    setSelectedSeriesId,
    setStatsVideoId,
    setUsers,
    setVideoSeries,
    setVideos,
    setWhitelist,
    statsVideoId,
    superAdminMode,
  ]);

  const refreshVideoPushSummary = useCallback(async (videoId) => {
    try {
      const result = await getCoursePushSummary(videoId);
      setVideoPushSummaryMap((prev) => ({ ...prev, [videoId]: result?.item || null }));
      return result?.item || null;
    } catch {
      return null;
    }
  }, []);

  const loadCoursePushDetail = useCallback(async (target) => {
    try {
      setCoursePushDetailLoading(true);
      setCoursePushDetailOpen(true);
      setCoursePushDetailTarget(target);
      setCoursePushDetailTitle(target.title);
      const summary = videoPushSummaryMap[target.id] || await refreshVideoPushSummary(target.id);
      const batchId = summary?.id;
      const result = await getCoursePushEntries(target.id, batchId);
      setCoursePushDetailRows(Array.isArray(result?.items) ? result.items : []);
    } catch (error) {
      message.error(error?.message || "推送明细加载失败。");
      setCoursePushDetailOpen(false);
    } finally {
      setCoursePushDetailLoading(false);
    }
  }, [message, refreshVideoPushSummary, videoPushSummaryMap]);

  const handleOpenVideoPushDetail = useCallback((row) => {
    loadCoursePushDetail({ type: "course", id: row.id, title: `${row.title} · 推送明细` });
  }, [loadCoursePushDetail]);

  const refreshOpenCoursePushDetailIfNeeded = useCallback(async (id) => {
    if (!coursePushDetailOpen || !coursePushDetailTarget || coursePushDetailTarget.id !== id) return;
    await loadCoursePushDetail(coursePushDetailTarget);
  }, [coursePushDetailOpen, coursePushDetailTarget, loadCoursePushDetail]);

  const showRetryConfirm = ({ onOk }) => {
    Modal.confirm({
      title: "确认立即补推",
      content: "本次只会补推历史未成功接收的人和当前新增命中的人，已成功接收的人不会重复推送。确认立即补推吗？",
      okText: "确认补推",
      cancelText: "取消",
      onOk,
    });
  };

  const handleRetryVideoPush = useCallback((row) => {
    showRetryConfirm({
      onOk: async () => {
        try {
          setRetryingVideoId(row.id);
          const result = await retryCoursePush(row.id);
          if (result?.status === "noop") {
            message.info("没有可补推对象。");
          } else {
            message.success(`补推完成：成功 ${result?.success_count || 0}，失败 ${result?.failed_count || 0}，跳过 ${result?.skipped_count || 0}`);
          }
          await refreshVideoPushSummary(row.id);
          await refreshOpenCoursePushDetailIfNeeded(row.id);
        } catch (error) {
          if (error?.status === 409) {
            message.warning("当前存在推送中任务，请稍后再试。");
          } else {
            message.error(error?.message || "课程补推失败。");
          }
        } finally {
          setRetryingVideoId(null);
        }
      },
    });
  }, [message, refreshOpenCoursePushDetailIfNeeded, refreshVideoPushSummary]);

  const openAdminVideoDetail = useCallback((videoId) => {
    setSelectedAdminVideoId(videoId);
    setQuizVideoId(videoId);
  }, [setQuizVideoId, setSelectedAdminVideoId]);

  const backToAdminVideoList = useCallback(() => {
    setSelectedAdminVideoId(null);
    setQuizVideoId(null);
    setQuizPoints([]);
  }, [setQuizPoints, setQuizVideoId, setSelectedAdminVideoId]);

  const handlePublishVideo = useCallback(async (videoId) => {
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
  }, [message, reloadAdminData]);

  const handleDisableVideo = useCallback(async (videoId) => {
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
  }, [message, reloadAdminData]);

  const handleBatchPublishVideos = useCallback(async () => {
    if (!selectedAdminVideoRowKeys.length) {
      message.warning("请先选择要发布的视频。");
      return;
    }
    try {
      const result = await batchPublishMagicVideos(selectedAdminVideoRowKeys);
      const updatedCount = Array.isArray(result?.updated_ids) ? result.updated_ids.length : 0;
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (updatedCount) {
        message.success(skippedCount ? `已发布 ${updatedCount} 个，跳过 ${skippedCount} 个。` : `已发布 ${updatedCount} 个视频。`);
      } else {
        message.warning(skippedCount ? `没有可发布视频，已跳过 ${skippedCount} 个。` : "没有可发布视频。");
      }
      setSelectedAdminVideoRowKeys([]);
      await reloadAdminData();
    } catch (error) {
      message.error(error?.message || "批量发布视频失败。");
    }
  }, [message, reloadAdminData, selectedAdminVideoRowKeys, setSelectedAdminVideoRowKeys]);

  const handleBatchDisableVideos = useCallback(async () => {
    if (!selectedAdminVideoRowKeys.length) {
      message.warning("请先选择要下架的视频。");
      return;
    }
    try {
      const result = await batchDisableMagicVideos(selectedAdminVideoRowKeys);
      const updatedCount = Array.isArray(result?.updated_ids) ? result.updated_ids.length : 0;
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (updatedCount) {
        message.success(skippedCount ? `已下架 ${updatedCount} 个，跳过 ${skippedCount} 个。` : `已下架 ${updatedCount} 个视频。`);
      } else {
        message.warning(skippedCount ? `没有可下架视频，已跳过 ${skippedCount} 个。` : "没有可下架视频。");
      }
      setSelectedAdminVideoRowKeys([]);
      await reloadAdminData();
    } catch (error) {
      message.error(error?.message || "批量下架视频失败。");
    }
  }, [message, reloadAdminData, selectedAdminVideoRowKeys, setSelectedAdminVideoRowKeys]);

  const handleBatchDeleteVideos = useCallback(async () => {
    if (!selectedAdminVideoRowKeys.length) {
      message.warning("请先选择要删除的视频。");
      return;
    }
    try {
      const result = await batchDeleteMagicVideos(selectedAdminVideoRowKeys);
      const deletedCount = Array.isArray(result?.deleted_ids) ? result.deleted_ids.length : 0;
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (deletedCount) {
        message.success(skippedCount ? `已删除 ${deletedCount} 个，跳过 ${skippedCount} 个。` : `已删除 ${deletedCount} 个视频。`);
      } else {
        message.warning(skippedCount ? `没有可删除视频，已跳过 ${skippedCount} 个。` : "没有可删除视频。");
      }
      setSelectedAdminVideoRowKeys([]);
      await reloadAdminData();
    } catch (error) {
      message.error(error?.message || "批量删除视频失败。");
    }
  }, [message, reloadAdminData, selectedAdminVideoRowKeys, setSelectedAdminVideoRowKeys]);

  const adminVideoColumns = useMemo(
    () => buildAdminVideoColumns({
      openAdminVideoDetail,
      setVideoModal,
      handlePublishVideo,
      handleDisableVideo,
      deleteMagicVideo,
      reloadAdminData,
      publishingVideoId,
      disablingVideoId,
      videoPushSummaryMap,
      handleOpenVideoPushDetail,
      handleRetryVideoPush,
      retryingVideoId,
    }),
    [
      disablingVideoId,
      handleDisableVideo,
      handleOpenVideoPushDetail,
      handlePublishVideo,
      handleRetryVideoPush,
      openAdminVideoDetail,
      publishingVideoId,
      reloadAdminData,
      retryingVideoId,
      setVideoModal,
      videoPushSummaryMap,
    ],
  );

  const whitelistColumns = useMemo(
    () => buildWhitelistColumns({ deleteMagicWhitelist, reloadAdminData }),
    [reloadAdminData],
  );

  const statsColumns = useMemo(
    () => buildStatsColumns(superAdminMode),
    [superAdminMode],
  );

  const statsExportPath = useMemo(() => {
    if (!statsVideoId) return "";
    const params = new URLSearchParams();
    for (const item of appliedStatsDepartment) {
      if (item) params.append("department", item);
    }
    for (const item of appliedStatsUserId) {
      if (item) params.append("user_id", String(item));
    }
    const query = params.toString();
    return `/api/magic-academy/videos/${statsVideoId}/export-progress${query ? `?${query}` : ""}`;
  }, [statsVideoId, appliedStatsDepartment, appliedStatsUserId]);

  const answerExportPath = useMemo(() => {
    if (!statsVideoId) return "";
    const params = new URLSearchParams();
    for (const item of appliedStatsDepartment) {
      if (item) params.append("department", item);
    }
    for (const item of appliedStatsUserId) {
      if (item) params.append("user_id", String(item));
    }
    const query = params.toString();
    return `/api/magic-academy/videos/${statsVideoId}/export-answers${query ? `?${query}` : ""}`;
  }, [statsVideoId, appliedStatsDepartment, appliedStatsUserId]);

  const handleStatsSearch = useCallback(() => {
    setAppliedStatsDepartment(statsDepartment);
    setAppliedStatsUserId(statsUserId);
  }, [setAppliedStatsDepartment, setAppliedStatsUserId, statsDepartment, statsUserId]);

  const handleStatsReset = useCallback(() => {
    setStatsDepartment([]);
    setStatsUserId([]);
    setAppliedStatsDepartment([]);
    setAppliedStatsUserId([]);
  }, [setAppliedStatsDepartment, setAppliedStatsUserId, setStatsDepartment, setStatsUserId]);

  const handleExportStats = useCallback(async (type) => {
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
  }, [answerExportPath, answerRows.length, downloadMagicFile, message, statsExportPath, statsRows.length, statsVideoId]);

  const loadAdminStats = useCallback(async () => {
    if (!statsVideoId || !adminMode) return;
    const [stats, answers] = await Promise.all([
      fetchMagicVideoStats(statsVideoId, {
        departments: appliedStatsDepartment,
        user_ids: appliedStatsUserId,
      }),
      fetchMagicVideoAnswers(statsVideoId, {
        departments: appliedStatsDepartment,
        user_ids: appliedStatsUserId,
      }),
    ]);
    setStatsRows(Array.isArray(stats) ? stats : []);
    setAnswerRows(Array.isArray(answers) ? answers : []);
  }, [
    adminMode,
    appliedStatsDepartment,
    appliedStatsUserId,
    fetchMagicVideoAnswers,
    fetchMagicVideoStats,
    setAnswerRows,
    setStatsRows,
    statsVideoId,
  ]);

  const loadAdminVideoDataIfNeeded = useCallback(async () => {
    if (!shouldLoadAdminVideoData) return;
    try {
      await reloadAdminData();
    } catch (error) {
      showLoadError("magic-admin-video-data", error, "视频列表加载失败。");
    }
  }, [reloadAdminData, shouldLoadAdminVideoData, showLoadError]);

  const loadAdminStatsIfNeeded = useCallback(async () => {
    if (!statsVideoId || !adminMode) return;
    try {
      await loadAdminStats();
    } catch (error) {
      showLoadError("magic-video-stats", error, "统计加载失败。");
    }
  }, [adminMode, loadAdminStats, showLoadError, statsVideoId]);

  const closeCoursePushDetail = useCallback(() => {
    setCoursePushDetailOpen(false);
    setCoursePushDetailRows([]);
  }, []);

  return {
    adminVideoState: {
      videos,
      adminVideoItems,
      adminVideoColumns,
      adminVideoTotal,
      adminVideoPage,
      adminVideoPageSize,
      selectedAdminVideo,
      selectedAdminVideoRowKeys,
      quizVideoId,
      videoSeries,
      statsVideoId,
      statsDepartment,
      statsUserId,
      statsDepartmentOptions,
      statsEmployeeOptions,
      statsRows,
      answerRows,
      statsColumns,
      whitelist,
      whitelistColumns,
      users,
      publishingVideoId,
      disablingVideoId,
    },
    adminVideoActions: {
      setVideoModal,
      setSelectedAdminVideoRowKeys,
      setAdminVideoPage,
      setAdminVideoPageSize,
      setQuizVideoId,
      setStatsVideoId,
      setStatsDepartment,
      setStatsUserId,
      handlePublishVideo,
      handleDisableVideo,
      handleBatchPublishVideos,
      handleBatchDisableVideos,
      handleBatchDeleteVideos,
      handleStatsSearch,
      handleStatsReset,
      handleExportStats,
      openAdminVideoDetail,
      backToAdminVideoList,
    },
    adminVideoDeps: {
      getVideoStatusMeta,
    },
    pushDetailSupport: {
      coursePushDetailOpen,
      coursePushDetailLoading,
      coursePushDetailTitle,
      coursePushDetailRows,
      closeCoursePushDetail,
    },
    reloadAdminData,
    loadAdminVideoDataIfNeeded,
    loadAdminStatsIfNeeded,
    openAdminVideoDetail,
    backToAdminVideoList,
    handlePublishVideo,
    handleDisableVideo,
    handleBatchPublishVideos,
    handleBatchDisableVideos,
    handleBatchDeleteVideos,
    handleOpenVideoPushDetail,
    handleRetryVideoPush,
    adminVideoColumns,
    whitelistColumns,
    statsColumns,
    statsExportPath,
    answerExportPath,
    handleStatsSearch,
    handleStatsReset,
    handleExportStats,
  };
}
