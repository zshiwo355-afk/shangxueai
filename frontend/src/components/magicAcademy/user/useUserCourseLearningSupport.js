import { createElement, useEffect, useMemo, useState } from "react";

import { fetchMyMagicVideoDetail } from "../../../lib/api.magic";
import { buildSeriesSections } from "../magicAcademyShared";

export default function useUserCourseLearningSupport({
  academyView,
  adminMode,
  message,
  setAcademyView,
  setSearchParams,
  setWatchConfirmState,
  setWatchedRef,
  setLastSafeTimeRef,
  resetBlockingSeekRef,
  resetLockedQuizPointIdRef,
  resetWatchConfirmAccumulatedRef,
  resetWatchConfirmLastTimeRef,
  resetWatchConfirmRoundRef,
  syncLoadedMaxWatchedPosition,
}) {
  const [myVideos, setMyVideos] = useState([]);
  const [myVideosLoadError, setMyVideosLoadError] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [videoDetail, setVideoDetail] = useState(null);
  const [videoDetailError, setVideoDetailError] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [employeeSelectedSeriesId, setEmployeeSelectedSeriesId] = useState(null);

  const answeredPointIds = useMemo(() => new Set(videoDetail?.progress?.answered_point_ids || []), [videoDetail]);
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
  const studyCompletionRate = useMemo(() => {
    if (!myVideos.length) return 0;
    return Math.round((myCompletedVideos.length / myVideos.length) * 100);
  }, [myCompletedVideos.length, myVideos.length]);

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
        syncLoadedMaxWatchedPosition(Math.max(data?.progress?.max_watched_position || 0, 0));
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
  }, [academyView, message, selectedVideoId, syncLoadedMaxWatchedPosition]);

  useEffect(() => {
    if (!employeeSelectedSeriesId) return;
    if (!myVideoSections.seriesSections.some((item) => String(item.seriesId) === String(employeeSelectedSeriesId))) {
      setEmployeeSelectedSeriesId(null);
    }
  }, [employeeSelectedSeriesId, myVideoSections]);

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
    setWatchedRef(0);
    setLastSafeTimeRef(0);
    resetBlockingSeekRef();
    resetLockedQuizPointIdRef();
    resetWatchConfirmAccumulatedRef();
    resetWatchConfirmLastTimeRef();
    resetWatchConfirmRoundRef();
    setWatchConfirmState({ open: false, round: 0 });
    if (!adminMode) {
      setSearchParams(employeeSelectedSeriesId ? { tab: "courses", series: String(employeeSelectedSeriesId) } : { tab: "courses" });
    }
  };

  const renderVideoCoverThumb = (item) => (
    item.cover_url
      ? createElement(
          "div",
          { className: "workspace-line-item__cover-shell" },
          createElement("img", {
            src: item.cover_url,
            alt: item.title,
            className: "workspace-line-item__cover",
          }),
        )
      : null
  );

  return {
    myVideos,
    setMyVideos,
    myVideosLoadError,
    setMyVideosLoadError,
    selectedVideoId,
    setSelectedVideoId,
    employeeSelectedSeriesId,
    setEmployeeSelectedSeriesId,
    videoDetail,
    setVideoDetail,
    videoDetailError,
    setVideoDetailError,
    loadingDetail,
    answeredPointIds,
    myRequiredVideos,
    myLearningVideos,
    myCompletedVideos,
    continueStudyVideo,
    myVideoSections,
    selectedEmployeeSeries,
    studyCompletionRate,
    openEmployeeSeriesDetail,
    closeEmployeeSeriesDetail,
    openStudyVideo,
    backToStudyList,
    renderVideoCoverThumb,
  };
}
