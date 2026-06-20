import { List, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteMyAudio,
  fetchMyAudioCalendar,
  fetchMyAudioMakeupOptions,
  fetchMyReadingContents,
  submitMyAudioMakeup,
  uploadMyAudio,
} from "../../../lib/api.magic";
import {
  buildAudioCalendarMap,
  getAudioDayStatus,
  getAudioSourceMeta,
  getCurrentMonthText,
  getTodayText,
  renderAudioStatusTag,
} from "../magicAcademyShared";

const { Text } = Typography;

function normalizeDateText(value, dayjs) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = dayjs(text);
  return parsed.isValid() && parsed.format("YYYY-MM-DD") === text ? text : "";
}

export default function useUserReadingCheckinSupport({
  audioStatsSupport,
  dayjs,
  initialSelectedDate = "",
  message,
  reloadMyData,
  superAdminMode,
}) {
  const normalizedInitialSelectedDate = normalizeDateText(initialSelectedDate, dayjs);
  const initialDate = normalizedInitialSelectedDate || getTodayText();
  const lastAppliedInitialDateRef = useRef(normalizedInitialSelectedDate);
  const [audioRemark, setAudioRemark] = useState("");
  const [myReadingContents, setMyReadingContents] = useState([]);
  const [myAudioMakeupDays, setMyAudioMakeupDays] = useState([]);
  const [myAudioMonth, setMyAudioMonth] = useState(initialDate.slice(0, 7) || getCurrentMonthText());
  const [myAudioCalendarDays, setMyAudioCalendarDays] = useState([]);
  const [myAudioSelectedDate, setMyAudioSelectedDate] = useState(initialDate);
  const [myAudios, setMyAudios] = useState([]);

  useEffect(() => {
    const normalized = normalizeDateText(initialSelectedDate, dayjs);
    if (!normalized || normalized === lastAppliedInitialDateRef.current) return;
    lastAppliedInitialDateRef.current = normalized;
    setMyAudioSelectedDate(normalized);
    setMyAudioMonth(normalized.slice(0, 7));
  }, [dayjs, initialSelectedDate]);

  const myAudioCalendarMap = useMemo(() => buildAudioCalendarMap(myAudioCalendarDays), [myAudioCalendarDays]);
  const myAudioMakeupMap = useMemo(
    () => Object.fromEntries((Array.isArray(myAudioMakeupDays) ? myAudioMakeupDays : []).map((item) => [item.reading_content_id, item])),
    [myAudioMakeupDays],
  );
  const selectedMyAudioDay = myAudioCalendarMap[myAudioSelectedDate] || null;
  const selectedReadingContents = useMemo(
    () => Array.isArray(myReadingContents) ? myReadingContents : [],
    [myReadingContents],
  );
  const todayUploadedAudio = useMemo(
    () => selectedReadingContents.some((item) => item.completed),
    [selectedReadingContents],
  );
  const latestAudioRecord = useMemo(
    () => (Array.isArray(myAudios) && myAudios.length > 0 ? myAudios[0] : null),
    [myAudios],
  );

  const reloadMyAudioCalendar = useCallback(async (monthText = myAudioMonth) => {
    const [result, makeup] = await Promise.all([
      fetchMyAudioCalendar(monthText),
      fetchMyAudioMakeupOptions(monthText),
    ]);
    const days = Array.isArray(result?.days) ? result.days : [];
    setMyAudioCalendarDays(days);
    setMyAudioMakeupDays(Array.isArray(makeup?.days) ? makeup.days : []);
    audioStatsSupport.setAudioMakeupSetting(makeup?.setting || { enabled: false, make_up_days: 0, description: "" });
    if (!days.some((item) => item.date === myAudioSelectedDate)) {
      const fallback = days.find((item) => item.is_today)?.date || days[0]?.date || dayjs(`${monthText}-01`).format("YYYY-MM-DD");
      setMyAudioSelectedDate(fallback);
    }
  }, [audioStatsSupport, dayjs, myAudioMonth, myAudioSelectedDate]);

  const reloadMyReadingContents = useCallback(async (dateText = myAudioSelectedDate) => {
    const result = await fetchMyReadingContents(dateText);
    setMyReadingContents(Array.isArray(result) ? result : []);
  }, [myAudioSelectedDate]);

  const handleSubmitAudioMakeup = useCallback(async (readingItem, { audioFile = null, imageFile = null } = {}) => {
    try {
      const makeupOption = myAudioMakeupMap[readingItem?.id];
      if (!makeupOption?.can_makeup) {
        message.warning(makeupOption?.reason || "当前内容不可补卡。");
        return;
      }
      if (!audioFile && !imageFile) {
        message.warning("请上传录音或图片，至少提交一项。");
        return;
      }
      await submitMyAudioMakeup({
        reading_content_id: readingItem.id,
        makeup_date: readingItem.reading_date,
        file_name: audioFile?.name || "",
        file_size: Number(audioFile?.size || 0),
        mime_type: audioFile?.type || "",
        audio: audioFile || null,
        image: imageFile || null,
        remark: audioRemark,
      });
      setAudioRemark("");
      message.success("补卡成功。");
      await reloadMyData();
      await reloadMyAudioCalendar();
      await reloadMyReadingContents();
    } catch (error) {
      message.error(error?.message || "补卡失败。");
    }
  }, [audioRemark, message, myAudioMakeupMap, reloadMyAudioCalendar, reloadMyData, reloadMyReadingContents]);

  const handleUploadAudioRecord = useCallback(async ({ readingItem, audioFile = null, imageFile = null }) => {
    if (!audioFile && !imageFile) {
      message.warning("请上传录音或图片，至少提交一项。");
      return;
    }
    try {
      await uploadMyAudio({
        reading_content_id: readingItem.id,
        file_name: audioFile?.name || "",
        file_size: Number(audioFile?.size || 0),
        mime_type: audioFile?.type || "",
        audio: audioFile || null,
        image: imageFile || null,
        remark: audioRemark,
      });
      setAudioRemark("");
      message.success("打卡记录已提交。");
      await reloadMyData();
      await reloadMyAudioCalendar();
      await reloadMyReadingContents();
    } catch (error) {
      message.error(error?.message || "提交失败。");
    }
  }, [audioRemark, message, reloadMyAudioCalendar, reloadMyData, reloadMyReadingContents]);

  const handleDeleteAudioRecord = useCallback(async (audioId) => {
    await deleteMyAudio(audioId);
    await reloadMyData();
    await reloadMyAudioCalendar();
  }, [reloadMyAudioCalendar, reloadMyData]);

  const renderEmployeeAudioCell = useCallback((value) => {
    const dateText = value.format("YYYY-MM-DD");
    const dayData = myAudioCalendarMap[dateText];
    const makeupData = myAudioMakeupMap[dateText];
    let status = getAudioDayStatus(dateText, dayData);
    if (!dayData?.uploaded && makeupData?.can_makeup) status = "makeup_available";
    else if (!dayData?.uploaded && makeupData?.is_expired) status = "makeup_expired";
    return (
      <div className={`magic-audio-calendar-cell ${status === "future" ? "is-future" : ""}`}>
        {renderAudioStatusTag(status, dayData?.count || 0, 0)}
      </div>
    );
  }, [myAudioCalendarMap, myAudioMakeupMap]);

  const renderAudioRecordList = useCallback((records, showUser = false) => (
    <List
      className="reading-checkin-record-list"
      dataSource={records}
      locale={{ emptyText: "当天暂无录音上传" }}
      renderItem={(item) => {
        const sourceMeta = getAudioSourceMeta(item.source, superAdminMode);
        const isWhitelistAutoRecord = item.source === "whitelist_auto";
        const displayFileName = !superAdminMode && isWhitelistAutoRecord
          ? "录音打卡.m4a"
          : (item.file_name || "未命名录音");
        return (
          <List.Item className="reading-checkin-record-list__item">
            <List.Item.Meta
              title={(
                <Space wrap className="reading-checkin-record-list__title">
                  <Text strong className="reading-checkin-record-list__name">{displayFileName}</Text>
                  <Tag color={sourceMeta.color}>
                    {superAdminMode ? (item.source_label || sourceMeta.label) : sourceMeta.label}
                  </Tag>
                  {showUser && item.user_name ? <Tag>{item.user_name}</Tag> : null}
                  {showUser && item.department ? <Tag color="blue">{item.department}</Tag> : null}
                </Space>
              )}
              description={(
                <Text type="secondary">上传时间：{item.uploaded_time?.replace("T", " ").slice(0, 19) || "—"}</Text>
              )}
            />
          </List.Item>
        );
      }}
    />
  ), [superAdminMode]);

  return {
    audioRemark,
    setAudioRemark,
    myReadingContents,
    myAudioMakeupDays,
    myAudioMonth,
    setMyAudioMonth,
    myAudioCalendarDays,
    myAudioSelectedDate,
    setMyAudioSelectedDate,
    myAudios,
    setMyAudios,
    myAudioCalendarMap,
    myAudioMakeupMap,
    selectedMyAudioDay,
    selectedReadingContents,
    todayUploadedAudio,
    latestAudioRecord,
    reloadMyAudioCalendar,
    reloadMyReadingContents,
    handleSubmitAudioMakeup,
    handleUploadAudioRecord,
    handleDeleteAudioRecord,
    renderEmployeeAudioCell,
    renderAudioRecordList,
  };
}
