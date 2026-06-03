import { useMemo } from "react";

export default function useAdminCoursesTabSupport({
  courseAdminSupport,
  courseSeriesSupport,
  courseQuizSupport,
  quizVideoId,
  quizPoints,
  videoSeries,
  selectedSeriesId,
  handleSaveWatchConfirmSetting,
  handleCreateWhitelist,
  watchConfirmForm,
  whitelistForm,
  pointForm,
  answerColumns,
  normalizeQuestionType,
  QUESTION_TYPE_LABELS,
  formatTime,
  formatFileSize,
  ResponsiveVideoPlayer,
  buildMagicVideoStreamUrl,
  setSelectedSeriesId,
}) {
  const courseAdminState = useMemo(() => ({
    ...courseAdminSupport.adminVideoState,
    quizVideoId,
    quizPoints,
    videoSeries,
    selectedSeries: courseSeriesSupport.selectedSeries,
    selectedSeriesId,
    seriesItemVideoId: courseSeriesSupport.seriesItemVideoId,
    availableSeriesVideos: courseSeriesSupport.availableSeriesVideos,
    answerColumns,
  }), [
    answerColumns,
    courseAdminSupport.adminVideoState,
    courseSeriesSupport.availableSeriesVideos,
    courseSeriesSupport.selectedSeries,
    courseSeriesSupport.seriesItemVideoId,
    quizPoints,
    quizVideoId,
    selectedSeriesId,
    videoSeries,
  ]);

  const courseAdminActions = useMemo(() => ({
    ...courseAdminSupport.adminVideoActions,
    setPointModal: courseQuizSupport.setPointModal,
    setQuestionModal: courseQuizSupport.setQuestionModal,
    setQuizImportState: courseQuizSupport.setQuizImportState,
    setSeriesItemVideoId: courseSeriesSupport.setSeriesItemVideoId,
    setSelectedSeriesId,
    handleSaveWatchConfirmSetting,
    handleAddSeriesItem: courseSeriesSupport.handleAddSeriesItem,
    handleMoveSeriesItem: courseSeriesSupport.handleMoveSeriesItem,
    handleDeleteQuizQuestion: courseQuizSupport.handleDeleteQuizQuestion,
    handleDeleteQuizPoint: courseQuizSupport.handleDeleteQuizPoint,
    openCreateSeriesModal: courseSeriesSupport.openCreateSeriesModal,
    openEditSeriesModal: courseSeriesSupport.openEditSeriesModal,
    handleDeleteSeries: courseSeriesSupport.handleDeleteSeries,
    handleRemoveSeriesItem: courseSeriesSupport.handleRemoveSeriesItem,
    handleCreateWhitelist,
  }), [
    courseAdminSupport.adminVideoActions,
    courseQuizSupport.handleDeleteQuizPoint,
    courseQuizSupport.handleDeleteQuizQuestion,
    courseQuizSupport.setPointModal,
    courseQuizSupport.setQuestionModal,
    courseQuizSupport.setQuizImportState,
    courseSeriesSupport.handleAddSeriesItem,
    courseSeriesSupport.handleDeleteSeries,
    courseSeriesSupport.handleMoveSeriesItem,
    courseSeriesSupport.handleRemoveSeriesItem,
    courseSeriesSupport.openCreateSeriesModal,
    courseSeriesSupport.openEditSeriesModal,
    courseSeriesSupport.setSeriesItemVideoId,
    handleCreateWhitelist,
    handleSaveWatchConfirmSetting,
    setSelectedSeriesId,
  ]);

  const courseAdminForms = useMemo(() => ({
    watchConfirmForm,
    whitelistForm,
    pointForm,
  }), [pointForm, watchConfirmForm, whitelistForm]);

  const courseAdminDeps = useMemo(() => ({
    ...courseAdminSupport.adminVideoDeps,
    normalizeQuestionType,
    QUESTION_TYPE_LABELS,
    formatTime,
    formatFileSize,
    ResponsiveVideoPlayer,
    buildMagicVideoStreamUrl,
  }), [
    QUESTION_TYPE_LABELS,
    ResponsiveVideoPlayer,
    buildMagicVideoStreamUrl,
    courseAdminSupport.adminVideoDeps,
    formatFileSize,
    formatTime,
    normalizeQuestionType,
  ]);

  return {
    courseAdminState,
    courseAdminActions,
    courseAdminForms,
    courseAdminDeps,
  };
}
