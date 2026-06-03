import { useState } from "react";

import { fetchAdminReadingAudioStatisticUsers } from "../../../../lib/api.magic";

export default function useAudioStatsDetailAdmin({
  audioDepartment,
  audioUserId,
  audioStatusFilter,
  message,
}) {
  const [audioDetailOpen, setAudioDetailOpen] = useState(false);
  const [audioDetailLoading, setAudioDetailLoading] = useState(false);
  const [audioDetailRow, setAudioDetailRow] = useState(null);
  const [audioDetailRows, setAudioDetailRows] = useState([]);
  const [audioDetailLegacyHint, setAudioDetailLegacyHint] = useState("");

  const closeAudioDetail = () => {
    setAudioDetailOpen(false);
  };

  const openAudioDetail = async (row) => {
    try {
      setAudioDetailLoading(true);
      setAudioDetailRow(row);
      const result = await fetchAdminReadingAudioStatisticUsers(row.reading_content_id, {
        department: audioDepartment || undefined,
        user_id: audioUserId || undefined,
        status: audioStatusFilter || undefined,
      });
      setAudioDetailRows(Array.isArray(result?.items) ? result.items : []);
      setAudioDetailLegacyHint(result?.legacy_unbound_hint || "");
      setAudioDetailOpen(true);
    } catch (error) {
      message.error(error?.message || "读书内容完成明细加载失败。");
    } finally {
      setAudioDetailLoading(false);
    }
  };

  return {
    audioDetailOpen,
    audioDetailLoading,
    audioDetailRow,
    audioDetailRows,
    audioDetailLegacyHint,
    setAudioDetailOpen,
    closeAudioDetail,
    openAudioDetail,
  };
}
