import { useEffect, useState } from "react";

import {
  fetchAdminReadingAudioStatistics,
  fetchAdminReadingContents,
} from "../../../../lib/api.magic";
import { getCurrentMonthText } from "../../magicAcademyShared";

export default function useAudioStatsAdmin({
  enabled = false,
  message,
  showLoadError,
}) {
  const [audioMonth, setAudioMonth] = useState(getCurrentMonthText());
  const [audioDateRange, setAudioDateRange] = useState(null);
  const [audioReadingContentId, setAudioReadingContentId] = useState(null);
  const [audioDepartment, setAudioDepartment] = useState("");
  const [audioUserId, setAudioUserId] = useState(null);
  const [audioStatusFilter, setAudioStatusFilter] = useState("all");
  const [audioReadingOptions, setAudioReadingOptions] = useState([]);
  const [audioLegacyHint, setAudioLegacyHint] = useState("");
  const [audioReadingStatsRows, setAudioReadingStatsRows] = useState([]);

  const reloadAudioReadingOptions = async (monthText = audioMonth) => {
    const result = await fetchAdminReadingContents({
      month: monthText,
      page: 1,
      page_size: 200,
    });
    setAudioReadingOptions(Array.isArray(result?.items) ? result.items : []);
  };

  const reloadAdminReadingAudioStats = async () => {
    const result = await fetchAdminReadingAudioStatistics({
      month: audioMonth,
      start_date: audioDateRange?.[0] ? audioDateRange[0].format("YYYY-MM-DD") : undefined,
      end_date: audioDateRange?.[1] ? audioDateRange[1].format("YYYY-MM-DD") : undefined,
      reading_content_id: audioReadingContentId || undefined,
      department: audioDepartment || undefined,
      user_id: audioUserId || undefined,
      status: audioStatusFilter || undefined,
    });
    setAudioReadingStatsRows(Array.isArray(result?.items) ? result.items : []);
    setAudioLegacyHint(result?.legacy_unbound_hint || "");
  };

  useEffect(() => {
    if (!enabled) return;
    reloadAudioReadingOptions(audioMonth).catch((error) => {
      if (typeof showLoadError === "function") {
        showLoadError("magic-audio-reading-options", error, "读书内容选项加载失败。");
        return;
      }
      message.error(error?.message || "读书内容选项加载失败。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioMonth, enabled]);

  useEffect(() => {
    if (!enabled) return;
    reloadAdminReadingAudioStats().catch((error) => {
      if (typeof showLoadError === "function") {
        showLoadError("magic-audio-reading-stats", error, "读书内容统计加载失败。");
        return;
      }
      message.error(error?.message || "读书内容统计加载失败。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioMonth, audioDateRange, audioReadingContentId, audioDepartment, audioUserId, audioStatusFilter, enabled]);

  return {
    audioMonth,
    setAudioMonth,
    audioDateRange,
    setAudioDateRange,
    audioReadingContentId,
    setAudioReadingContentId,
    audioDepartment,
    setAudioDepartment,
    audioUserId,
    setAudioUserId,
    audioStatusFilter,
    setAudioStatusFilter,
    audioReadingOptions,
    audioLegacyHint,
    audioReadingStatsRows,
    reloadAudioReadingOptions,
    reloadAdminReadingAudioStats,
  };
}
