import { useMemo, useState } from "react";

import { exportAdminReadingAudioStatistics } from "../../../../lib/api.magic";
import { AUDIO_EXPORT_DEFAULT_COLUMNS } from "../../magicAcademyPageConfig";
import { saveBlob } from "../../magicAcademyShared";

export default function useAudioStatsExportAdmin({
  audioMonth,
  audioDateRange,
  audioReadingContentId,
  audioDepartment,
  audioUserId,
  audioStatusFilter,
  audioReadingOptions = [],
  users = [],
  message,
}) {
  const [audioExportModalOpen, setAudioExportModalOpen] = useState(false);
  const [audioExportColumns, setAudioExportColumns] = useState(AUDIO_EXPORT_DEFAULT_COLUMNS);
  const [audioExportSubmitting, setAudioExportSubmitting] = useState(false);

  const audioExportPayload = useMemo(() => ({
    month: audioMonth || undefined,
    start_date: audioDateRange?.[0] ? audioDateRange[0].format("YYYY-MM-DD") : undefined,
    end_date: audioDateRange?.[1] ? audioDateRange[1].format("YYYY-MM-DD") : undefined,
    reading_content_id: audioReadingContentId || undefined,
    department: audioDepartment || undefined,
    user_id: audioUserId || undefined,
    status: audioStatusFilter || undefined,
  }), [audioDateRange, audioDepartment, audioMonth, audioReadingContentId, audioStatusFilter, audioUserId]);

  const audioReadingOptionMap = useMemo(
    () => new Map(audioReadingOptions.map((item) => [String(item.reading_content_id || item.id), item])),
    [audioReadingOptions],
  );
  const audioUserOptionMap = useMemo(
    () => new Map(
      users
        .filter((item) => item.role === "user" || item.role === "admin")
        .map((item) => [String(item.id), `${item.real_name || item.display_name || item.username} (${item.username})`]),
    ),
    [users],
  );

  const audioExportScopeLines = useMemo(() => {
    const lines = [];
    if (audioMonth) lines.push(`月份：${audioMonth}`);
    if (audioDateRange?.[0] && audioDateRange?.[1]) {
      lines.push(`日期范围：${audioDateRange[0].format("YYYY-MM-DD")} 至 ${audioDateRange[1].format("YYYY-MM-DD")}`);
    }
    const readingOption = audioReadingContentId ? audioReadingOptionMap.get(String(audioReadingContentId)) : null;
    lines.push(`读书内容：${readingOption ? `${readingOption.reading_date} ${readingOption.title}` : "全部"}`);
    lines.push(`部门：${audioDepartment || "全部"}`);
    lines.push(`员工：${audioUserId ? (audioUserOptionMap.get(String(audioUserId)) || `ID ${audioUserId}`) : "全部"}`);
    lines.push(`完成状态：${({
      all: "全部",
      completed: "已完成",
      pending: "未完成",
      expired: "已过补卡截止时间",
      future: "未到推送时间",
    })[audioStatusFilter] || "全部"}`);
    return lines.length ? lines : ["按当前列表条件导出"];
  }, [audioDateRange, audioDepartment, audioMonth, audioReadingContentId, audioReadingOptionMap, audioStatusFilter, audioUserId, audioUserOptionMap]);

  const handleToggleAudioExportColumn = (columnKey, checked) => {
    setAudioExportColumns((prev) => {
      if (checked) {
        if (prev.includes(columnKey)) return prev;
        return [...prev, columnKey];
      }
      return prev.filter((item) => item !== columnKey);
    });
  };

  const handleOpenAudioExportModal = () => {
    setAudioExportColumns((prev) => (prev.length ? prev : AUDIO_EXPORT_DEFAULT_COLUMNS));
    setAudioExportModalOpen(true);
  };

  const handleConfirmAudioExport = async () => {
    if (!audioExportColumns.length) {
      message.warning("请至少选择一个导出字段");
      return;
    }
    try {
      setAudioExportSubmitting(true);
      await saveBlob(await exportAdminReadingAudioStatistics({
        ...audioExportPayload,
        columns: audioExportColumns,
      }));
      setAudioExportModalOpen(false);
    } catch (error) {
      message.error(error?.message || "读书打卡统计导出失败。");
    } finally {
      setAudioExportSubmitting(false);
    }
  };

  return {
    audioExportModalOpen,
    audioExportColumns,
    audioExportSubmitting,
    audioExportScopeLines,
    setAudioExportModalOpen,
    setAudioExportColumns,
    handleToggleAudioExportColumn,
    handleOpenAudioExportModal,
    handleConfirmAudioExport,
  };
}
