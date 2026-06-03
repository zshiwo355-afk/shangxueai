import { useMemo } from "react";

import useAudioMakeupAdmin from "./useAudioMakeupAdmin";
import useAudioStatsAdmin from "./useAudioStatsAdmin";
import useAudioStatsDetailAdmin from "./useAudioStatsDetailAdmin";
import useAudioStatsExportAdmin from "./useAudioStatsExportAdmin";

export default function useAudioStatsAdminSupport({
  enabled = false,
  users = [],
  message,
  showLoadError,
}) {
  const audioStatsAdmin = useAudioStatsAdmin({
    enabled,
    message,
    showLoadError,
  });

  const audioStatsExportSupport = useAudioStatsExportAdmin({
    audioMonth: audioStatsAdmin.audioMonth,
    audioDateRange: audioStatsAdmin.audioDateRange,
    audioReadingContentId: audioStatsAdmin.audioReadingContentId,
    audioDepartment: audioStatsAdmin.audioDepartment,
    audioUserId: audioStatsAdmin.audioUserId,
    audioStatusFilter: audioStatsAdmin.audioStatusFilter,
    audioReadingOptions: audioStatsAdmin.audioReadingOptions,
    users,
    message,
  });

  const audioStatsDetailSupport = useAudioStatsDetailAdmin({
    audioDepartment: audioStatsAdmin.audioDepartment,
    audioUserId: audioStatsAdmin.audioUserId,
    audioStatusFilter: audioStatsAdmin.audioStatusFilter,
    message,
  });

  const audioMakeupSupport = useAudioMakeupAdmin({
    message,
  });

  const adminReadingState = useMemo(() => ({
    audioMakeupSetting: audioMakeupSupport.audioMakeupSetting,
    audioMonth: audioStatsAdmin.audioMonth,
    audioDateRange: audioStatsAdmin.audioDateRange,
    audioReadingContentId: audioStatsAdmin.audioReadingContentId,
    audioDepartment: audioStatsAdmin.audioDepartment,
    audioUserId: audioStatsAdmin.audioUserId,
    audioStatusFilter: audioStatsAdmin.audioStatusFilter,
    audioReadingOptions: audioStatsAdmin.audioReadingOptions,
    audioLegacyHint: audioStatsAdmin.audioLegacyHint,
    audioReadingStatsRows: audioStatsAdmin.audioReadingStatsRows,
    users,
  }), [
    audioMakeupSupport.audioMakeupSetting,
    audioStatsAdmin.audioDateRange,
    audioStatsAdmin.audioDepartment,
    audioStatsAdmin.audioLegacyHint,
    audioStatsAdmin.audioMonth,
    audioStatsAdmin.audioReadingContentId,
    audioStatsAdmin.audioReadingOptions,
    audioStatsAdmin.audioReadingStatsRows,
    audioStatsAdmin.audioStatusFilter,
    audioStatsAdmin.audioUserId,
    users,
  ]);

  const adminReadingActions = useMemo(() => ({
    setAudioMakeupSetting: audioMakeupSupport.setAudioMakeupSetting,
    handleSaveAudioMakeupSetting: audioMakeupSupport.handleSaveAudioMakeupSetting,
    setAudioMonth: audioStatsAdmin.setAudioMonth,
    setAudioDateRange: audioStatsAdmin.setAudioDateRange,
    setAudioReadingContentId: audioStatsAdmin.setAudioReadingContentId,
    setAudioDepartment: audioStatsAdmin.setAudioDepartment,
    setAudioUserId: audioStatsAdmin.setAudioUserId,
    setAudioStatusFilter: audioStatsAdmin.setAudioStatusFilter,
    reloadAdminReadingAudioStats: audioStatsAdmin.reloadAdminReadingAudioStats,
    handleOpenAudioExportModal: audioStatsExportSupport.handleOpenAudioExportModal,
    openAudioDetail: audioStatsDetailSupport.openAudioDetail,
  }), [
    audioMakeupSupport.handleSaveAudioMakeupSetting,
    audioMakeupSupport.setAudioMakeupSetting,
    audioStatsAdmin.reloadAdminReadingAudioStats,
    audioStatsAdmin.setAudioDateRange,
    audioStatsAdmin.setAudioDepartment,
    audioStatsAdmin.setAudioMonth,
    audioStatsAdmin.setAudioReadingContentId,
    audioStatsAdmin.setAudioStatusFilter,
    audioStatsAdmin.setAudioUserId,
    audioStatsDetailSupport.openAudioDetail,
    audioStatsExportSupport.handleOpenAudioExportModal,
  ]);

  const modalProps = useMemo(() => ({
    audioDetailOpen: audioStatsDetailSupport.audioDetailOpen,
    audioDetailRow: audioStatsDetailSupport.audioDetailRow,
    setAudioDetailOpen: audioStatsDetailSupport.setAudioDetailOpen,
    audioDetailLegacyHint: audioStatsDetailSupport.audioDetailLegacyHint,
    audioDetailLoading: audioStatsDetailSupport.audioDetailLoading,
    audioDetailRows: audioStatsDetailSupport.audioDetailRows,
    audioExportModalOpen: audioStatsExportSupport.audioExportModalOpen,
    audioExportSubmitting: audioStatsExportSupport.audioExportSubmitting,
    setAudioExportModalOpen: audioStatsExportSupport.setAudioExportModalOpen,
    handleConfirmAudioExport: audioStatsExportSupport.handleConfirmAudioExport,
    audioExportColumns: audioStatsExportSupport.audioExportColumns,
    setAudioExportColumns: audioStatsExportSupport.setAudioExportColumns,
    audioExportScopeLines: audioStatsExportSupport.audioExportScopeLines,
    handleToggleAudioExportColumn: audioStatsExportSupport.handleToggleAudioExportColumn,
  }), [
    audioStatsDetailSupport.audioDetailLegacyHint,
    audioStatsDetailSupport.audioDetailLoading,
    audioStatsDetailSupport.audioDetailOpen,
    audioStatsDetailSupport.audioDetailRow,
    audioStatsDetailSupport.audioDetailRows,
    audioStatsDetailSupport.setAudioDetailOpen,
    audioStatsExportSupport.audioExportColumns,
    audioStatsExportSupport.audioExportModalOpen,
    audioStatsExportSupport.audioExportScopeLines,
    audioStatsExportSupport.audioExportSubmitting,
    audioStatsExportSupport.handleConfirmAudioExport,
    audioStatsExportSupport.handleToggleAudioExportColumn,
    audioStatsExportSupport.setAudioExportColumns,
    audioStatsExportSupport.setAudioExportModalOpen,
  ]);

  return {
    audioMonth: audioStatsAdmin.audioMonth,
    setAudioMonth: audioStatsAdmin.setAudioMonth,
    audioDateRange: audioStatsAdmin.audioDateRange,
    setAudioDateRange: audioStatsAdmin.setAudioDateRange,
    audioReadingContentId: audioStatsAdmin.audioReadingContentId,
    setAudioReadingContentId: audioStatsAdmin.setAudioReadingContentId,
    audioDepartment: audioStatsAdmin.audioDepartment,
    setAudioDepartment: audioStatsAdmin.setAudioDepartment,
    audioUserId: audioStatsAdmin.audioUserId,
    setAudioUserId: audioStatsAdmin.setAudioUserId,
    audioStatusFilter: audioStatsAdmin.audioStatusFilter,
    setAudioStatusFilter: audioStatsAdmin.setAudioStatusFilter,
    audioReadingOptions: audioStatsAdmin.audioReadingOptions,
    audioLegacyHint: audioStatsAdmin.audioLegacyHint,
    audioReadingStatsRows: audioStatsAdmin.audioReadingStatsRows,
    reloadAdminReadingAudioStats: audioStatsAdmin.reloadAdminReadingAudioStats,
    audioMakeupSetting: audioMakeupSupport.audioMakeupSetting,
    setAudioMakeupSetting: audioMakeupSupport.setAudioMakeupSetting,
    handleSaveAudioMakeupSetting: audioMakeupSupport.handleSaveAudioMakeupSetting,
    adminReadingState,
    adminReadingActions,
    modalProps,
  };
}
