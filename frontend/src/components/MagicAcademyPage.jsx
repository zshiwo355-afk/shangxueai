import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  BookOutlined,
  DownOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  LockOutlined,
  PlayCircleFilled,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Form,
  DatePicker,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  buildMagicQuizImportTemplateUrl,
  buildMagicVideoStreamUrl,
  createMagicWatchConfirmLog,
  createMagicWhitelist,
  batchDeleteAdminReadingContents,
  batchUpdateAdminReadingContentsStatus,
  deleteAdminReadingContent,
  deleteMagicVideoSeries,
  downloadMagicFile,
  fetchAdminAudioCalendar,
  fetchMagicAudioMakeupSetting,
  fetchMagicWatchConfirmSetting,
  fetchMyAudios,
  fetchMagicVideoAnswers,
  fetchMagicVideoStats,
  fetchMyMagicVideoDetail,
  fetchMyMagicVideos,
  listMagicQuizPoints,
  saveMyMagicVideoProgress,
  submitMyMagicQuiz,
  updateAdminReadingContentStatus,
  updateMagicWatchConfirmSetting,
  addMagicVideoSeriesItem,
} from "../lib/api.magic";
import { adminListUsers } from "../lib/api.admin";
import { fetchOptions } from "../lib/api.options";
import { getCurrentUser, isAdmin, isSuperAdmin } from "../lib/auth";
import MaterialAssetPickerModal from "./common/MaterialAssetPickerModal"; // CODEX_MODIFIED
import QuizImportModal from "./magicAcademy/QuizImportModal";
import ResponsiveVideoPlayer from "./magicAcademy/ResponsiveVideoPlayer";
import VideoDispatchFormModal from "./magicAcademy/VideoDispatchFormModal";
import MagicAcademyPageModals from "./magicAcademy/MagicAcademyPageModals";
import { buildReadingAdminTabItems } from "./magicAcademy/MagicAcademyReadingAdminTabs";
import PushDetailModal from "./magicAcademy/shared/PushDetailModal";
import MagicAcademyEmptyState from "./magicAcademy/shared/MagicAcademyEmptyState";
import { buildAdminCoursesTabItems } from "./magicAcademy/admin/courses/AdminCoursesModule";
import useAdminCoursesTabSupport from "./magicAcademy/admin/courses/useAdminCoursesTabSupport";
import useCourseAdminSupport from "./magicAcademy/admin/courses/useCourseAdminSupport";
import useCourseQuizAdmin from "./magicAcademy/admin/courses/useCourseQuizAdmin";
import useCourseSeriesAdmin from "./magicAcademy/admin/courses/useCourseSeriesAdmin";
import useCourseVideoUploadAdmin from "./magicAcademy/admin/courses/useCourseVideoUploadAdmin";
import { useAdminReadingTabItems } from "./magicAcademy/admin/reading/AdminReadingModule";
import useAudioStatsAdminSupport from "./magicAcademy/admin/reading/useAudioStatsAdminSupport";
import useReadingContentActions from "./magicAcademy/admin/reading/useReadingContentActions";
import useReadingContentImportAdmin from "./magicAcademy/admin/reading/useReadingContentImportAdmin";
import useReadingContentPushAdmin from "./magicAcademy/admin/reading/useReadingContentPushAdmin";
import useReadingContentsAdmin from "./magicAcademy/admin/reading/useReadingContentsAdmin";
import MagicAcademyHome from "./magicAcademy/user/MagicAcademyHome";
import MentorDirectoryPage from "./magicAcademy/user/mentor/MentorDirectoryPage";
import CourseCard from "./magicAcademy/user/CourseCard";
import CourseListSection from "./magicAcademy/user/CourseListSection";
import CourseCenterShell from "./magicAcademy/user/CourseCenterShell";
import ReadingCheckinShell from "./magicAcademy/user/ReadingCheckinShell";
import useUserCourseLearningSupport from "./magicAcademy/user/useUserCourseLearningSupport";
import UserReadingCheckinPanel from "./magicAcademy/user/UserReadingCheckinPanel";
import useUserReadingCheckinSupport from "./magicAcademy/user/useUserReadingCheckinSupport";
import {
  answerColumns,
} from "./magicAcademy/adminColumns";
import {
  ADMIN_SECTION_TABS,
  READING_SERIES_STATUS_FILTER_OPTIONS,
  READING_SERIES_STATUS_META,
} from "./magicAcademy/magicAcademyPageConfig";
import {
  getDefaultAdminTab,
  getSeriesTargetSummary,
  isSamePrimitiveArray,
} from "./magicAcademy/magicAcademyPageHelpers";
import {
  buildAudioCalendarMap,
  buildVideoDispatchFormValues,
  buildVideoTargetsFromDispatch,
  formatFileSize,
  formatTime,
  getAudioDayStatus,
  getCurrentMonthText,
  getTodayText,
  getReadingTargetSummary,
  getVideoSourceLabel,
  getVideoStatusMeta,
  logMagicUploadStageError,
  normalizeQuestionType,
  QUESTION_TYPE_LABELS,
  renderAudioStatusTag,
  renderQuestionAnswer,
  targetsToOptions,
  UNASSIGNED_DEPARTMENT_FILTER,
} from "./magicAcademy/magicAcademyShared";

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

export default function MagicAcademyPage({ embedded = false, adminSection = "courses" }) {
  const adminMode = isAdmin();
  const superAdminMode = isSuperAdmin();
  const currentUser = getCurrentUser();
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(adminMode ? getDefaultAdminTab(adminSection) : "video_manage");
  const [academyView, setAcademyView] = useState(
    adminMode
      ? "home"
      : (searchParams.get("tab") === "audio"
        ? "reading"
        : searchParams.get("tab") === "courses"
          ? "courses"
          : searchParams.get("tab") === "mentors"
            ? "mentors"
            : "home"),
  );
  const [users, setUsers] = useState([]);
  const [employmentStatusOptions, setEmploymentStatusOptions] = useState([]);
  const [videos, setVideos] = useState([]);
  const [adminVideoItems, setAdminVideoItems] = useState([]);
  const [adminVideoTotal, setAdminVideoTotal] = useState(0);
  const [adminVideoPage, setAdminVideoPage] = useState(1);
  const [adminVideoPageSize, setAdminVideoPageSize] = useState(8);
  const [videoSeries, setVideoSeries] = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  const [statsRows, setStatsRows] = useState([]);
  const [answerRows, setAnswerRows] = useState([]);
  const [selectedAdminVideoId, setSelectedAdminVideoId] = useState(null);
  const [selectedAdminVideoRowKeys, setSelectedAdminVideoRowKeys] = useState([]);
  const [videoModal, setVideoModal] = useState(null);
  const [quizVideoId, setQuizVideoId] = useState(null);
  const [quizPoints, setQuizPoints] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);
  const [watchConfirmForm] = Form.useForm();
  const [seriesForm] = Form.useForm();
  const [statsVideoId, setStatsVideoId] = useState(null);
  const [statsDepartment, setStatsDepartment] = useState([]);
  const [statsUserId, setStatsUserId] = useState([]);
  const [appliedStatsDepartment, setAppliedStatsDepartment] = useState([]);
  const [appliedStatsUserId, setAppliedStatsUserId] = useState([]);
  const [whitelistForm] = Form.useForm();
  const [pointForm] = Form.useForm();
  const [quizAnswerState, setQuizAnswerState] = useState({ open: false, point: null, values: {} });
  const [watchConfirmState, setWatchConfirmState] = useState({ open: false, round: 0 });
  const [readingContentMonth, setReadingContentMonth] = useState(getCurrentMonthText());
  const [selectedReadingContentRowKeys, setSelectedReadingContentRowKeys] = useState([]);
  const [readingSeriesForm] = Form.useForm();
  const [adminAudioCalendarDays, setAdminAudioCalendarDays] = useState([]);
  const [adminAudioSelectedDate, setAdminAudioSelectedDate] = useState(getTodayText());
  const videoRef = useRef(null);
  const progressTimerRef = useRef(null);
  const watchedRef = useRef(0);
  const lastSafeTimeRef = useRef(0);
  const blockingSeekRef = useRef(false);
  const lastSeekWarnAtRef = useRef(0);
  const lockedQuizPointIdRef = useRef(null);
  const watchConfirmAccumulatedRef = useRef(0);
  const watchConfirmLastTimeRef = useRef(null);
  const watchConfirmRoundRef = useRef(0);
  const adminAudioCalendarMap = useMemo(() => buildAudioCalendarMap(adminAudioCalendarDays), [adminAudioCalendarDays]);
  const selectedAdminAudioDay = adminAudioCalendarMap[adminAudioSelectedDate] || null;
  const employeeUsers = useMemo(
    () => users.filter((item) => item.role === "user"),
    [users],
  );
  const employeeDepartmentOptions = useMemo(
    () => Array.from(new Set(employeeUsers.map((item) => item.department).filter(Boolean))).map((item) => ({
      value: item,
      label: item,
    })),
    [employeeUsers],
  );
  const employeePositionOptions = useMemo(
    () => Array.from(new Set(employeeUsers.map((item) => item.position).filter(Boolean))).map((item) => ({
      value: item,
      label: item,
    })),
    [employeeUsers],
  );
  const statsDepartmentOptions = useMemo(
    () => Array.from(new Set(employeeUsers.map((item) => item.department || UNASSIGNED_DEPARTMENT_FILTER))).map((item) => ({
      value: item,
      label: item === UNASSIGNED_DEPARTMENT_FILTER ? "未分配部门" : item,
      title: null,
      tooltip: item === UNASSIGNED_DEPARTMENT_FILTER ? "未分配部门" : item,
    })),
    [employeeUsers],
  );
  const filteredStatsEmployees = useMemo(
    () => employeeUsers.filter((item) => (
      statsDepartment.length
        ? statsDepartment.includes(item.department || UNASSIGNED_DEPARTMENT_FILTER)
        : true
    )),
    [employeeUsers, statsDepartment],
  );
  useEffect(() => {
    if (!adminMode) return;
    const sectionTabs = ADMIN_SECTION_TABS[adminSection] || ADMIN_SECTION_TABS.courses;
    if (!sectionTabs.includes(activeTab)) {
      setActiveTab(getDefaultAdminTab(adminSection));
    }
  }, [activeTab, adminMode, adminSection]);

  useEffect(() => {
    if (adminMode) return;
    const nextView = searchParams.get("tab") === "audio"
      ? "reading"
      : searchParams.get("tab") === "courses"
        ? "courses"
        : "home";
    if (nextView !== academyView) {
      setAcademyView(nextView);
    }
  }, [academyView, adminMode, searchParams]);

  const openAcademyHome = () => {
    userCourseLearningSupport.setSelectedVideoId(null);
    userCourseLearningSupport.setVideoDetail(null);
    userCourseLearningSupport.setEmployeeSelectedSeriesId(null);
    setAcademyView("home");
    if (!adminMode) setSearchParams({});
  };

  const openCourseCenter = (videoId = null) => {
    setAcademyView("courses");
    userCourseLearningSupport.setVideoDetailError(null);
    userCourseLearningSupport.setEmployeeSelectedSeriesId(null);
    if (videoId) {
      userCourseLearningSupport.setSelectedVideoId(videoId);
    } else {
      userCourseLearningSupport.setSelectedVideoId(null);
      userCourseLearningSupport.setVideoDetail(null);
    }
    if (!adminMode) {
      setSearchParams(videoId ? { tab: "courses", video: String(videoId) } : { tab: "courses" });
    }
  };

  const openReadingCenter = () => {
    setAcademyView("reading");
    if (!adminMode) setSearchParams({ tab: "audio" });
  };

  const openMentorZone = () => {
    setAcademyView("mentors");
    if (!adminMode) setSearchParams({ tab: "mentors" });
  };

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
  };
  const showLoadError = (key, error, fallbackMessage) => {
    message.open({
      key,
      type: "error",
      content: error?.message || fallbackMessage,
    });
  };
  const shouldLoadAdminVideoData = adminMode && ["video_manage", "quiz", "stats", "series", "whitelist", "audio_stats"].includes(activeTab);
  const shouldLoadReadingContents = adminMode && activeTab === "reading_contents";
  const shouldLoadReadingSeries = adminMode && ["reading_contents", "reading_series"].includes(activeTab);
  const shouldLoadAudioStats = adminMode && activeTab === "audio_stats";
  const audioStatsSupport = useAudioStatsAdminSupport({
    enabled: shouldLoadAudioStats,
    users,
    message,
    showLoadError,
  });
  const statsEmployeeOptions = useMemo(
    () => filteredStatsEmployees.map((item) => ({
      value: item.id,
      label: `${item.real_name || item.display_name || item.username} (${item.username})`,
      title: null,
      tooltip: `${item.real_name || item.display_name || item.username} (${item.username})`,
    })),
    [filteredStatsEmployees],
  );

  const readingContentPushSupport = useReadingContentPushAdmin({
    message,
  });

  const {
    readingContentKeyword,
    setReadingContentKeyword,
    readingContentPage,
    setReadingContentPage,
    readingContentPageSize,
    setReadingContentPageSize,
    readingContentSeriesId,
    setReadingContentSeriesId,
    readingContents,
    readingContentsTotal,
    readingContentSeriesFilterRows,
    readingContentModalOpen,
    setReadingContentModalOpen,
    readingContentModalMode,
    readingContentEditing,
    setReadingContentEditing,
    readingContentPreferredSeriesId,
    setReadingContentPreferredSeriesId,
    readingContentSubmitting,
    reloadReadingContents,
    reloadReadingContentSeriesFilterOptions,
    openCreateReadingContentModal,
    openEditReadingContentModal,
    handleSubmitReadingContent,
  } = useReadingContentsAdmin({
    enabled: shouldLoadReadingContents,
    filterOptionsEnabled: adminMode && adminSection === "reading",
    month: readingContentMonth,
    setMonth: setReadingContentMonth,
    message,
    showLoadError,
    onRowsLoaded: async (items) => {
      setSelectedReadingContentRowKeys([]);
      await readingContentPushSupport.loadReadingPushSummaries(items);
    },
  });
  const {
    handleDeleteReadingContent,
    handleBatchDeleteReadingContents,
    handleBatchEnableReadingContents,
    handleBatchDisableReadingContents,
    handleToggleReadingContentStatus,
  } = useReadingContentActions({
    deleteAdminReadingContent,
    batchDeleteAdminReadingContents,
    batchUpdateAdminReadingContentsStatus,
    updateAdminReadingContentStatus,
    reloadReadingContents,
    selectedReadingContentRowKeys,
    message,
  });
  const readingContentImportSupport = useReadingContentImportAdmin({
    message,
    reloadReadingContents,
    setReadingContentPage,
  });
  const courseAdminSupport = useCourseAdminSupport({
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
  });
  const courseVideoUploadSupport = useCourseVideoUploadAdmin({
    videoModal,
    setVideoModal,
    reloadAdminData: async () => courseAdminSupport.reloadAdminData(),
    message,
  });
  const courseSeriesSupport = useCourseSeriesAdmin({
    seriesForm,
    selectedSeriesId,
    videoSeries,
    videos: courseAdminSupport.adminVideoState.videos,
    reloadAdminData: async () => courseAdminSupport.reloadAdminData(),
    message,
  });
  const courseQuizSupport = useCourseQuizAdmin({
    pointForm,
    quizVideoId,
    setQuizPoints,
    message,
  });
  const userReadingCheckinSupport = useUserReadingCheckinSupport({
    audioStatsSupport,
    dayjs,
    message,
    reloadMyData: async () => reloadMyData(),
    superAdminMode,
  });
  const syncLoadedMaxWatchedPosition = useCallback((value) => {
    watchedRef.current = value;
  }, []);
  const userCourseLearningSupport = useUserCourseLearningSupport({
    academyView,
    adminMode,
    message,
    setAcademyView,
    setSearchParams,
    setWatchConfirmState,
    setWatchedRef: (value) => {
      watchedRef.current = value;
    },
    setLastSafeTimeRef: (value) => {
      lastSafeTimeRef.current = value;
    },
    resetBlockingSeekRef: () => {
      blockingSeekRef.current = false;
    },
    resetLockedQuizPointIdRef: () => {
      lockedQuizPointIdRef.current = null;
    },
    resetWatchConfirmAccumulatedRef: () => {
      watchConfirmAccumulatedRef.current = 0;
    },
    resetWatchConfirmLastTimeRef: () => {
      watchConfirmLastTimeRef.current = null;
    },
    resetWatchConfirmRoundRef: () => {
      watchConfirmRoundRef.current = 0;
    },
    syncLoadedMaxWatchedPosition,
  });
  const {
    myVideos,
    myVideosLoadError,
    selectedVideoId,
    employeeSelectedSeriesId,
    videoDetail,
    videoDetailError,
    loadingDetail,
    answeredPointIds,
    myRequiredVideos,
    myLearningVideos,
    myCompletedVideos,
    continueStudyVideo,
    myVideoSections,
    selectedEmployeeSeries,
    studyCompletionRate,
  } = userCourseLearningSupport;

  useEffect(() => {
    if (adminMode) return;
    const nextVideoId = searchParams.get("video");
    const nextSeriesId = searchParams.get("series");
    if ((nextSeriesId || null) !== (employeeSelectedSeriesId || null)) {
      userCourseLearningSupport.setEmployeeSelectedSeriesId(nextSeriesId || null);
    }
    if (searchParams.get("tab") !== "courses") {
      if (selectedVideoId !== null) userCourseLearningSupport.setSelectedVideoId(null);
      return;
    }
    if ((nextVideoId || null) !== (selectedVideoId || null)) {
      userCourseLearningSupport.setSelectedVideoId(nextVideoId || null);
    }
  }, [adminMode, employeeSelectedSeriesId, searchParams, selectedVideoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadMyData = async () => {
    const [videoResult, audioResult] = await Promise.allSettled([
      fetchMyMagicVideos(),
      fetchMyAudios(),
    ]);
    if (videoResult.status === "fulfilled") {
      userCourseLearningSupport.setMyVideos(Array.isArray(videoResult.value) ? videoResult.value : []);
      userCourseLearningSupport.setMyVideosLoadError("");
    } else {
      userCourseLearningSupport.setMyVideos([]);
      userCourseLearningSupport.setMyVideosLoadError(videoResult.reason?.message || "课程列表加载失败。");
    }
    if (audioResult.status === "fulfilled") {
      userReadingCheckinSupport.setMyAudios(Array.isArray(audioResult.value) ? audioResult.value : []);
    } else {
      userReadingCheckinSupport.setMyAudios([]);
    }
  };

  const reloadAdminAudioCalendar = async (params = {}) => {
    const result = await fetchAdminAudioCalendar({
      month: params.month ?? audioStatsSupport.audioMonth,
      department: params.department ?? audioStatsSupport.audioDepartment,
      user_id: params.user_id ?? audioStatsSupport.audioUserId,
    });
    const days = Array.isArray(result?.days) ? result.days : [];
    setAdminAudioCalendarDays(days);
    if (!days.some((item) => item.date === adminAudioSelectedDate)) {
      const fallback = days.find((item) => item.is_today)?.date || days[0]?.date || dayjs(`${(params.month ?? audioStatsSupport.audioMonth)}-01`).format("YYYY-MM-DD");
      setAdminAudioSelectedDate(fallback);
    }
  };


  useEffect(() => {
    (async () => {
      try {
        if (!adminMode) {
          await reloadMyData();
        }
      } catch (error) {
        message.error(error?.message || "课程管理数据加载失败。");
      }
    })();
  }, [adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    courseAdminSupport.loadAdminVideoDataIfNeeded();
  }, [adminVideoPage, adminVideoPageSize, shouldLoadAdminVideoData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adminMode || adminSection !== "reading") return;
    adminListUsers().then(setUsers).catch((error) => {
      showLoadError("magic-reading-users", error, "用户列表加载失败。");
    });
    fetchOptions().then((optionData) => {
      setEmploymentStatusOptions(Array.isArray(optionData?.employment_status) ? optionData.employment_status : []);
    }).catch((error) => {
      showLoadError("magic-reading-user-options", error, "用户选项加载失败。");
    });
  }, [adminMode, adminSection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizVideoId || !adminMode || activeTab !== "quiz") return;
    listMagicQuizPoints(quizVideoId).then(setQuizPoints).catch((error) => {
      showLoadError("magic-quiz-points", error, "答题节点加载失败。");
    });
  }, [quizVideoId, adminMode, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizVideoId || !adminMode || activeTab !== "quiz") return;
    fetchMagicWatchConfirmSetting(quizVideoId).then((data) => {
      watchConfirmForm.setFieldsValue({
        enabled: !!data?.enabled,
        interval_seconds: Number(data?.interval_seconds || 300),
        message: data?.message || "请确认你正在观看视频",
        button_text: data?.button_text || "继续学习",
      });
    }).catch((error) => {
      showLoadError("magic-watch-confirm", error, "观看确认配置加载失败。");
    });
  }, [quizVideoId, adminMode, activeTab, watchConfirmForm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!statsVideoId || !adminMode || activeTab !== "stats") return;
    courseAdminSupport.loadAdminStatsIfNeeded();
  }, [statsVideoId, adminMode, activeTab, appliedStatsDepartment, appliedStatsUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!statsUserId.length) return;
    const validUserIds = new Set(filteredStatsEmployees.map((item) => item.id));
    setStatsUserId((prev) => {
      const next = prev.filter((item) => validUserIds.has(item));
      return isSamePrimitiveArray(prev, next) ? prev : next;
    });
  }, [filteredStatsEmployees, statsUserId]);

  useEffect(() => {
    if (!appliedStatsUserId.length) return;
    const validUserIds = new Set(filteredStatsEmployees.map((item) => item.id));
    setAppliedStatsUserId((prev) => {
      const next = prev.filter((item) => validUserIds.has(item));
      return isSamePrimitiveArray(prev, next) ? prev : next;
    });
  }, [filteredStatsEmployees, appliedStatsUserId]);

  useEffect(() => {
    if (!appliedStatsDepartment.length) return;
    setAppliedStatsDepartment((prev) => {
      const next = prev.filter((item) => statsDepartmentOptions.some((option) => option.value === item));
      return isSamePrimitiveArray(prev, next) ? prev : next;
    });
  }, [appliedStatsDepartment, statsDepartmentOptions]);

  useEffect(() => {
    if (!statsDepartment.length) return;
    setStatsDepartment((prev) => {
      const next = prev.filter((item) => statsDepartmentOptions.some((option) => option.value === item));
      return isSamePrimitiveArray(prev, next) ? prev : next;
    });
  }, [statsDepartment, statsDepartmentOptions]);

  useEffect(() => {
    if (!selectedSeriesId) return;
    if (!videoSeries.some((item) => item.id === selectedSeriesId)) {
      setSelectedSeriesId(videoSeries[0]?.id || null);
    }
  }, [selectedSeriesId, videoSeries]);

  useEffect(() => {
    if (!shouldLoadAudioStats) return;
    fetchMagicAudioMakeupSetting().then((data) => {
      audioStatsSupport.setAudioMakeupSetting(data || {
        enabled: false,
        make_up_days: 0,
        audio_random_window_minutes: 0,
        video_random_window_minutes: 0,
        description: "",
      });
    }).catch((error) => {
      showLoadError("magic-audio-makeup-setting", error, "补卡设置加载失败。");
    });
  }, [shouldLoadAudioStats]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (adminMode) return;
    userReadingCheckinSupport.reloadMyAudioCalendar(userReadingCheckinSupport.myAudioMonth).catch((error) => {
      message.error(error?.message || "录音日历加载失败。");
    });
  }, [userReadingCheckinSupport.myAudioMonth, adminMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (adminMode) return;
    userReadingCheckinSupport.reloadMyReadingContents().catch((error) => {
      message.error(error?.message || "读书内容加载失败。");
    });
  }, [adminMode, userReadingCheckinSupport.myAudioSelectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shouldLoadAudioStats) return;
    reloadAdminAudioCalendar().catch((error) => {
      showLoadError("magic-admin-audio-calendar", error, "录音日历加载失败。");
    });
  }, [audioStatsSupport.audioMonth, audioStatsSupport.audioDepartment, audioStatsSupport.audioUserId, shouldLoadAudioStats]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProgress = async (extra = {}) => {
    if (academyView !== "courses") return;
    if (!videoDetail?.id || !videoRef.current) return;
    const element = videoRef.current;
    const safeCurrentTime = Math.min(
      Number(element.currentTime || 0),
      Math.max(lastSafeTimeRef.current || 0, watchedRef.current || 0),
    );
    try {
      const data = await saveMyMagicVideoProgress(videoDetail.id, {
        current_position: safeCurrentTime,
        max_watched_position: watchedRef.current || 0,
        duration_seconds: element.duration || videoDetail.duration_seconds || 0,
        page_visible: !document.hidden,
        ...extra,
      });
      userCourseLearningSupport.setVideoDetail((prev) => ({ ...prev, progress: data.progress }));
      if (data?.progress?.is_completed && !videoDetail?.progress?.is_completed) {
        await reloadMyData();
      }
    } catch (error) {
      logMagicUploadStageError("progress report", error);
    }
  };

  const showSeekWarning = (text) => {
    const now = Date.now();
    if (now - lastSeekWarnAtRef.current < 2000) return;
    lastSeekWarnAtRef.current = now;
    message.warning(text);
  };

  const setVideoCurrentTimeSilently = (nextTime) => {
    if (!videoRef.current) return;
    blockingSeekRef.current = true;
    videoRef.current.currentTime = Number(nextTime || 0);
    window.setTimeout(() => {
      blockingSeekRef.current = false;
    }, 0);
  };

  const maybeOpenQuiz = (currentTime) => {
    if (!videoDetail || videoDetail.can_seek_freely || videoDetail.progress?.is_completed) return false;
    const nextPoint = (videoDetail.quiz_points || []).find((point) => (
      point.enabled && !answeredPointIds.has(point.id) && currentTime >= point.trigger_second
    ));
    if (nextPoint) {
      if (lockedQuizPointIdRef.current === nextPoint.id && quizAnswerState.open) return true;
      lockedQuizPointIdRef.current = nextPoint.id;
      videoRef.current?.pause();
      if (videoRef.current) {
        const lockedTime = Number(nextPoint.trigger_second || 0);
        setVideoCurrentTimeSilently(lockedTime);
        lastSafeTimeRef.current = lockedTime;
        watchedRef.current = Math.max(watchedRef.current, lockedTime);
      }
      setQuizAnswerState({ open: true, point: nextPoint, values: {} });
      return true;
    }
    return false;
  };

  const clampToSafePosition = (reason = "暂不能快进到未观看的位置，请按顺序学习。") => {
    if (!videoRef.current) return;
    const activeLockedPoint = (videoDetail?.quiz_points || []).find((point) => point.id === lockedQuizPointIdRef.current);
    const fallback = activeLockedPoint
      ? Number(activeLockedPoint.trigger_second || 0)
      : Math.max(lastSafeTimeRef.current || 0, watchedRef.current || 0);
    setVideoCurrentTimeSilently(fallback);
    lastSafeTimeRef.current = fallback;
    videoRef.current.pause();
    showSeekWarning(reason);
  };

  const handleVideoLoaded = () => {
    if (!videoRef.current || !videoDetail) return;
    const saved = Number(videoDetail.progress?.current_position || 0);
    setVideoCurrentTimeSilently(saved);
    watchedRef.current = Math.max(Number(videoDetail.progress?.max_watched_position || 0), saved);
    lastSafeTimeRef.current = saved;
    lockedQuizPointIdRef.current = null;
    watchConfirmAccumulatedRef.current = 0;
    watchConfirmLastTimeRef.current = saved;
    watchConfirmRoundRef.current = 0;
    setWatchConfirmState({ open: false, round: 0 });
  };

  const maybeOpenWatchConfirm = (currentTime) => {
    const setting = videoDetail?.watch_confirm_setting;
    if (!setting?.enabled) return false;
    if (watchConfirmState.open || quizAnswerState.open) return false;
    if (videoDetail?.progress?.is_completed && currentTime >= Number(videoDetail.duration_seconds || 0)) return false;
    const threshold = Number(setting.interval_seconds || 0);
    if (threshold <= 0) return false;
    if (watchConfirmAccumulatedRef.current < threshold) return false;
    videoRef.current?.pause();
    watchConfirmRoundRef.current += 1;
    setWatchConfirmState({ open: true, round: watchConfirmRoundRef.current });
    return true;
  };

  const handleVideoPlay = () => {
    if (!videoRef.current) return;
    watchConfirmLastTimeRef.current = Number(videoRef.current.currentTime || 0);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || !videoDetail) return;
    if (document.hidden) {
      videoRef.current.pause();
      return;
    }
    if (blockingSeekRef.current) return;
    const currentTime = videoRef.current.currentTime || 0;
    if (quizAnswerState.open && quizAnswerState.point) {
      const lockedTime = Number(quizAnswerState.point.trigger_second || 0);
      if (currentTime > lockedTime + 0.5) {
        clampToSafePosition("请先完成当前节点答题，再继续学习。");
        return;
      }
    }
    watchedRef.current = Math.max(watchedRef.current, currentTime);
    lastSafeTimeRef.current = Math.min(currentTime, watchedRef.current);
    if (maybeOpenQuiz(currentTime)) return;
    const lastTime = watchConfirmLastTimeRef.current;
    const delta = lastTime == null ? 0 : currentTime - lastTime;
    if (delta > 0 && delta < 2.5) {
      watchConfirmAccumulatedRef.current += delta;
    }
    watchConfirmLastTimeRef.current = currentTime;
    maybeOpenWatchConfirm(currentTime);
  };

  const handleSeeking = () => {
    if (!videoRef.current || !videoDetail || videoDetail.can_seek_freely) return;
    if (blockingSeekRef.current) return;
    const targetTime = Number(videoRef.current.currentTime || 0);
    const lockedPoint = quizAnswerState.point || (videoDetail.quiz_points || []).find((point) => point.id === lockedQuizPointIdRef.current);
    if (lockedPoint && !answeredPointIds.has(lockedPoint.id) && targetTime > Number(lockedPoint.trigger_second || 0) + 0.5) {
      clampToSafePosition("请先完成当前节点答题，再继续学习。");
      return;
    }
    const fallback = lockedPoint && !answeredPointIds.has(lockedPoint.id)
      ? Number(lockedPoint.trigger_second || 0)
      : Math.max(lastSafeTimeRef.current || 0, watchedRef.current || 0);
    if (targetTime > fallback + 0.35) {
      clampToSafePosition("暂不能快进到未观看的位置，请按顺序学习。");
    }
  };

  useEffect(() => {
    if (academyView !== "courses") return undefined;
    const listener = () => {
      if (document.hidden) {
        videoRef.current?.pause();
        saveProgress({ page_visible: false });
      }
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, [videoDetail, academyView]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (academyView !== "courses") {
      clearInterval(progressTimerRef.current);
      return undefined;
    }
    if (!videoDetail?.id) return;
    clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => saveProgress(), 5000);
    return () => clearInterval(progressTimerRef.current);
  }, [videoDetail?.id, academyView]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveWatchConfirmSetting = async () => {
    if (!quizVideoId) {
      message.warning("请先选择视频。");
      return;
    }
    try {
      const values = await watchConfirmForm.validateFields();
      await updateMagicWatchConfirmSetting(quizVideoId, values);
      await courseAdminSupport.reloadAdminData();
      message.success("观看确认配置已保存。");
    } catch (error) {
      message.error(error?.message || "保存失败。");
    }
  };

  const handleQuizSubmit = async () => {
    try {
      const point = quizAnswerState.point;
      const answers = (point?.questions || []).map((question) => ({
        question_id: question.id,
        answer: quizAnswerState.values[question.id],
      }));
      const result = await submitMyMagicQuiz(videoDetail.id, {
        quiz_point_id: point.id,
        answers,
        skip_by_whitelist: false,
      });
      if (!result.passed) {
        message.warning("答错或漏答，需要全部答对才能继续，请重新作答。");
        lockedQuizPointIdRef.current = point?.id || null;
        return;
      }
      message.success("答题通过，可以继续播放。");
      const resumeTime = Number(point?.trigger_second || videoRef.current?.currentTime || 0);
      watchedRef.current = Math.max(watchedRef.current, resumeTime);
      lastSafeTimeRef.current = Math.max(lastSafeTimeRef.current, resumeTime);
      lockedQuizPointIdRef.current = null;
      setQuizAnswerState({ open: false, point: null, values: {} });
      const detail = await fetchMyMagicVideoDetail(videoDetail.id);
      userCourseLearningSupport.setVideoDetail(detail);
      watchedRef.current = Math.max(detail?.progress?.max_watched_position || 0, watchedRef.current);
      lastSafeTimeRef.current = Math.max(lastSafeTimeRef.current, resumeTime);
      if (videoRef.current) {
        setVideoCurrentTimeSilently(resumeTime);
      }
      videoRef.current?.play?.().catch(() => {});
      await reloadMyData();
    } catch (error) {
      message.error(error?.message || "提交答题失败。");
    }
  };

  const handleWatchConfirmContinue = async () => {
    try {
      const currentTime = Number(videoRef.current?.currentTime || 0);
      await createMagicWatchConfirmLog(videoDetail.id, {
        progress_seconds: currentTime,
        confirm_round: watchConfirmState.round || 1,
      });
    } catch (error) {
      message.warning(error?.message || "确认记录提交失败，已继续播放。");
    } finally {
      watchConfirmAccumulatedRef.current = 0;
      watchConfirmLastTimeRef.current = Number(videoRef.current?.currentTime || 0);
      setWatchConfirmState((prev) => ({ ...prev, open: false }));
      videoRef.current?.play?.().catch(() => {});
    }
  };

  const renderAdminAudioCell = (value) => {
    const dateText = value.format("YYYY-MM-DD");
    const dayData = adminAudioCalendarMap[dateText];
    const status = getAudioDayStatus(dateText, dayData);
    return (
      <div className={`magic-audio-calendar-cell ${status === "future" ? "is-future" : ""}`}>
        {renderAudioStatusTag(status, dayData?.count || 0, dayData?.uploaded_user_count || 0)}
      </div>
    );
  };

  const studyTabContent = selectedVideoId ? (
    <div className="magic-academy-detail">
      {videoDetailError ? (
        <MagicAcademyEmptyState
          description={videoDetailError.message}
          actionText="返回课程列表"
          onAction={userCourseLearningSupport.backToStudyList}
        />
      ) : !videoDetail ? (
        <div className="workspace-panel">
          <MagicAcademyEmptyState description={loadingDetail ? "视频详情加载中" : "暂未选择课程"} />
        </div>
      ) : (
        <div className="workspace-dual workspace-dual--lined">
          <div className="workspace-panel">
            <div className="workspace-panel__head">
              <Space size={8} wrap>
                <strong>{videoDetail.title}</strong>
                {videoDetail.is_required ? <Tag bordered={false} color="gold">必修</Tag> : null}
                <Tag bordered={false} color={videoDetail.progress?.is_completed ? "success" : "processing"}>
                  {videoDetail.progress?.is_completed ? "已完成" : "学习中"}
                </Tag>
              </Space>
            </div>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              {videoDetail.description ? (
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>{videoDetail.description}</Paragraph>
              ) : null}
              <ResponsiveVideoPlayer
                videoRef={videoRef}
                src={buildMagicVideoStreamUrl(videoDetail.id)}
                poster={videoDetail.cover_url || ""}
                onLoadedMetadata={handleVideoLoaded}
                onTimeUpdate={handleTimeUpdate}
                onSeeking={handleSeeking}
                onPlay={handleVideoPlay}
                onPause={() => saveProgress()}
                onEnded={() => saveProgress()}
              />
              <Progress
                percent={Math.round(videoDetail.progress?.progress_percent || 0)}
                size="small"
                showInfo={false}
              />
              <Space wrap size={[12, 8]}>
                <Text type="secondary">分类：{videoDetail.category || "未分类"}</Text>
                <Text type="secondary">已观看：{formatTime(videoDetail.progress?.max_watched_position || 0)} / {formatTime(videoDetail.duration_seconds || 0)}</Text>
                <Text type="secondary">当前进度：{Math.round(videoDetail.progress?.progress_percent || 0)}%</Text>
              </Space>
              {!videoDetail.progress?.is_completed ? (
                <Text type="secondary">请按顺序观看，节点答题需全部答对方可继续；完成后支持自由回看。</Text>
              ) : null}
              {(videoDetail.quiz_points || []).length > 0 ? (
                <Space wrap size={[8, 8]}>
                  <Text type="secondary" style={{ marginRight: 4 }}>节点答题</Text>
                  {(videoDetail.quiz_points || []).map((point) => (
                    <Tag bordered={false} key={point.id} color={answeredPointIds.has(point.id) ? "success" : "default"}>
                      {formatTime(point.trigger_second)} · {answeredPointIds.has(point.id) ? "已通过" : "待答题"}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Space>
          </div>

          <aside className="workspace-panel workspace-panel--aside">
            <div className="workspace-panel">
              <div className="workspace-panel__head">
                <Space>
                  <BookOutlined />
                  <strong>学习总览</strong>
                </Space>
              </div>
              <div className="workspace-mini-grid">
                <div>
                  <span>总课程</span>
                  <strong>{myVideos.length}</strong>
                </div>
                <div>
                  <span>已完成</span>
                  <strong>{myCompletedVideos.length}</strong>
                </div>
                <div>
                  <span>完成率</span>
                  <strong>{studyCompletionRate}%</strong>
                </div>
                <div>
                  <span>待学必修</span>
                  <strong>{myRequiredVideos.length}</strong>
                </div>
              </div>
            </div>

            {continueStudyVideo && continueStudyVideo.id !== videoDetail.id ? (
              <div className="workspace-panel">
                <div className="workspace-panel__head">
                  <Space>
                    <PlayCircleFilled />
                    <strong>下一步建议</strong>
                  </Space>
                </div>
                <div className="workspace-note-block">
                  <strong>{continueStudyVideo.title}</strong>
                  <p>建议优先处理待学必修和未完成课程，把节奏连起来。</p>
                  <div className="workspace-note-block__actions">
                    <Button type="primary" block onClick={() => userCourseLearningSupport.openStudyVideo(continueStudyVideo.id)}>
                      切到推荐课程
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  ) : selectedEmployeeSeries ? (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
            <Space direction="vertical" size={2}>
              <Title level={4} style={{ margin: 0 }}>{selectedEmployeeSeries.title}</Title>
              {selectedEmployeeSeries.description ? (
                <Text type="secondary">{selectedEmployeeSeries.description}</Text>
              ) : null}
            </Space>
            <Space wrap>
              <Tag bordered={false}>{`共 ${selectedEmployeeSeries.items.length} 节`}</Tag>
              <Tag bordered={false} color="blue">
                {`已完成 ${selectedEmployeeSeries.items.filter((item) => item.progress?.is_completed).length} / ${selectedEmployeeSeries.items.length}`}
              </Tag>
              {selectedEmployeeSeries.sequentialUnlockEnabled ? <Tag bordered={false} color="purple">顺序解锁</Tag> : null}
            </Space>
          </Space>
          <Progress
            percent={selectedEmployeeSeries.items.length ? Math.round((selectedEmployeeSeries.items.filter((item) => item.progress?.is_completed).length / selectedEmployeeSeries.items.length) * 100) : 0}
            size="small"
            showInfo={false}
          />
        </Space>
      </Card>

      <div className="workspace-line-list">
        {selectedEmployeeSeries.items.map((item, idx) => {
          const progressPercent = Math.round(item.progress?.progress_percent || 0);
          const isCompleted = !!item.progress?.is_completed;
          const isLocked = !!item.is_locked;
          const statusLabel = isCompleted ? "已完成" : isLocked ? "待解锁" : progressPercent > 0 ? "学习中" : "可学习";
          const actionLabel = isCompleted ? "重新学习" : isLocked ? "待解锁" : progressPercent > 0 ? "继续学习" : "开始学习";
          return (
            <CourseCard
              key={item.id}
              cover={userCourseLearningSupport.renderVideoCoverThumb(item)}
              title={`第 ${item.series_order} 节 · ${item.title}`}
              badges={(
                <>
                  {isCompleted ? (
                    <Tag bordered={false} color="success">已完成</Tag>
                  ) : isLocked ? (
                    <Tag bordered={false} color="default" icon={<LockOutlined />}>待解锁</Tag>
                  ) : (
                    <Tag bordered={false} color="processing">{statusLabel}</Tag>
                  )}
                  {getVideoSourceLabel(item, superAdminMode) ? <Tag bordered={false} color="purple">{getVideoSourceLabel(item, superAdminMode)}</Tag> : null}
                </>
              )}
              metaText={`${item.category || "未分类课程"}${isLocked ? ` · ${item.locked_reason || "请先完成上一节"}` : item.description ? ` · ${item.description.slice(0, 40)}` : ""}`}
              progressPercent={progressPercent}
              actionLabel={actionLabel}
              onAction={() => userCourseLearningSupport.openStudyVideo(item)}
              disabled={isLocked}
              delayMs={idx * 60}
            />
          );
        })}
      </div>
    </Space>
  ) : (
    myVideosLoadError ? (
      <div className="workspace-panel">
        <Alert
          type="error"
          showIcon
          message="课程列表加载失败"
          description={myVideosLoadError}
        />
      </div>
    ) : myVideos.length === 0 ? (
      <div className="workspace-panel">
        <MagicAcademyEmptyState description="暂无学习视频" />
      </div>
    ) : (
      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        {myVideoSections.seriesSections.length > 0 ? (
          <CourseListSection title="系列课程">
            {myVideoSections.seriesSections.map((section) => (
              <Card
                key={section.key}
                title={section.title}
                extra={section.sequentialUnlockEnabled ? <Tag bordered={false} color="purple">顺序解锁</Tag> : null}
              >
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {section.description ? <Text type="secondary">{section.description}</Text> : null}
                  <Space wrap>
                    <Tag bordered={false}>{`共 ${section.items.length} 节`}</Tag>
                    <Tag bordered={false} color="blue">
                      {`已完成 ${section.items.filter((item) => item.progress?.is_completed).length} / ${section.items.length}`}
                    </Tag>
                  </Space>
                  <Progress
                    percent={section.items.length ? Math.round((section.items.filter((item) => item.progress?.is_completed).length / section.items.length) * 100) : 0}
                    size="small"
                    showInfo={false}
                  />
                  <Button type="primary" onClick={() => userCourseLearningSupport.openEmployeeSeriesDetail(section.seriesId)}>
                    {section.items.some((item) => !item.progress?.is_completed && !item.is_locked) ? "进入学习" : "查看系列"}
                  </Button>
                </Space>
              </Card>
            ))}
          </CourseListSection>
        ) : null}
        {myVideoSections.standalone.length > 0 ? (
          <CourseListSection title="普通课程">
            <div className="workspace-line-list">
              {myVideoSections.standalone.map((item, idx) => {
                const progressPercent = Math.round(item.progress?.progress_percent || 0);
                const actionLabel = item.progress?.is_completed ? "重新学习" : progressPercent > 0 ? "继续学习" : "开始学习";
                return (
                  <CourseCard
                    key={item.id}
                    cover={userCourseLearningSupport.renderVideoCoverThumb(item)}
                    title={item.title}
                    badges={(
                      <>
                        {item.is_required ? <Tag bordered={false} color="gold">必修</Tag> : null}
                        {superAdminMode && item.is_whitelisted ? <Tag bordered={false} color="purple">白名单</Tag> : null}
                        {currentUser?.is_newcomer && item.is_newcomer_required ? <Tag bordered={false} color="gold">新人必看</Tag> : null}
                        <Tag bordered={false} color={item.progress?.is_completed ? "success" : "processing"}>
                          {item.progress?.is_completed ? "已完成" : progressPercent > 0 ? "学习中" : "未开始"}
                        </Tag>
                      </>
                    )}
                    metaText={`${item.category || "未分类课程"}${item.description ? ` · ${item.description.slice(0, 40)}` : ""}`}
                    progressPercent={progressPercent}
                    actionLabel={actionLabel}
                    onAction={() => userCourseLearningSupport.openStudyVideo(item)}
                    delayMs={idx * 60}
                  />
                );
              })}
            </div>
          </CourseListSection>
        ) : null}
      </Space>
    )
  );

  const handleCreateWhitelist = async (values) => {
    try {
      await createMagicWhitelist(values);
      whitelistForm.resetFields();
      await courseAdminSupport.reloadAdminData();
      message.success("已加入白名单。");
    } catch (error) {
      message.error(error?.message || "添加失败。");
    }
  };

  const handleReadingSeriesChanged = async () => {
    await reloadReadingContentSeriesFilterOptions();
  };

  const adminCoursesTabSupport = useAdminCoursesTabSupport({
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
  });

  const { tabItems: readingAdminTabItems, readingSeriesSupport } = useAdminReadingTabItems({
    readingAdminState: {
      readingContentMonth,
      readingContentKeyword,
      readingContentPage,
      readingContentPageSize,
      readingContentSeriesId,
      readingContentSeriesFilterRows,
      readingContents,
      readingContentsTotal,
      selectedReadingContentRowKeys,
      readingPushSummaryMap: readingContentPushSupport.readingPushSummaryMap,
      retryingReadingContentId: readingContentPushSupport.retryingReadingContentId,
      readingImportSubmitting: readingContentImportSupport.readingImportSubmitting,
      ...audioStatsSupport.adminReadingState,
    },
    readingAdminActions: {
      setReadingContentMonth,
      setReadingContentKeyword,
      setReadingContentPage,
      setReadingContentPageSize,
      setReadingContentSeriesId,
      setSelectedReadingContentRowKeys,
      handlePreviewReadingImport: readingContentImportSupport.handlePreviewReadingImport,
      openReadingImportMaterialPicker: readingContentImportSupport.openReadingImportMaterialPicker,
      openCreateReadingContentModal,
      openEditReadingContentModal,
      handleToggleReadingContentStatus,
      handleDeleteReadingContent,
      handleBatchDeleteReadingContents,
      handleBatchEnableReadingContents,
      handleBatchDisableReadingContents,
      handleOpenReadingPushDetail: readingContentPushSupport.openReadingContentPushDetail,
      handleRetryReadingPush: readingContentPushSupport.handleRetryReadingPush,
      onReadingSeriesChanged: handleReadingSeriesChanged,
      ...audioStatsSupport.adminReadingActions,
    },
    readingAdminDeps: {
      downloadMagicFile,
      buildReadingAdminTabItems,
      message,
      RangePicker,
      shouldLoadReadingSeries,
      readingSeriesOptionsEnabled: adminMode && adminSection === "reading",
      readingSeriesForm,
      reloadReadingContentSeriesFilterOptions,
      setReadingContentPreferredSeriesId,
      showLoadError,
    },
  });

  const activeReadingSeriesOptions = useMemo(
    () => readingSeriesSupport.readingSeriesSelectRows
      .filter((item) => ["active", "draft"].includes(item.status))
      .map((item) => ({
        value: item.id,
        label: item.status === "draft" ? `${item.title}（草稿）` : item.title,
        series: item,
      })),
    [readingSeriesSupport.readingSeriesSelectRows],
  );

  const adminTabs = (adminMode ? [
    ...buildAdminCoursesTabItems({
      courseAdminState: adminCoursesTabSupport.courseAdminState,
      courseAdminActions: adminCoursesTabSupport.courseAdminActions,
      courseAdminForms: adminCoursesTabSupport.courseAdminForms,
      courseAdminDeps: adminCoursesTabSupport.courseAdminDeps,
    }),
    ...readingAdminTabItems,
  ].filter(Boolean) : []);
  const visibleAdminTabs = adminMode
    ? adminTabs.filter((item) => (ADMIN_SECTION_TABS[adminSection] || ADMIN_SECTION_TABS.courses).includes(item.key))
    : [];

  const renderCourseCenter = () => (
    <CourseCenterShell
      title={selectedVideoId
        ? (videoDetail?.title || "课程详情")
        : selectedEmployeeSeries
          ? selectedEmployeeSeries.title
          : "课程学习"}
      subtitle={selectedVideoId
        ? "按节点答题完成视频学习"
        : selectedEmployeeSeries
          ? "系列课程按顺序解锁，完成上一节后自动进入下一节。"
          : "按推荐顺序学习视频，节点答题需全部答对方可继续。"}
      onBack={selectedVideoId
        ? userCourseLearningSupport.backToStudyList
        : selectedEmployeeSeries
          ? userCourseLearningSupport.closeEmployeeSeriesDetail
          : () => navigate("/workspace/magic")}
      backText={selectedVideoId
        ? (selectedEmployeeSeries ? "返回系列详情" : "返回课程列表")
        : selectedEmployeeSeries
          ? "返回课程学习"
          : "返回学习工作台"}
    >
      {studyTabContent}
    </CourseCenterShell>
  );

  const renderReadingCheckin = () => (
    <ReadingCheckinShell
      title="读书打卡"
      subtitle="录音上传、上传日历与历史记录，集中在这里。"
      onBack={openAcademyHome}
      backText="返回课程管理"
    >
      <UserReadingCheckinPanel
        support={userReadingCheckinSupport}
        makeupSetting={audioStatsSupport.audioMakeupSetting}
      />
    </ReadingCheckinShell>
  );

  const userViewContent = !adminMode
    ? (academyView === "courses"
        ? renderCourseCenter()
        : academyView === "reading"
          ? renderReadingCheckin()
          : academyView === "mentors"
            ? <MentorDirectoryPage onBack={openAcademyHome} />
            : (
            <MagicAcademyHome
              continueStudyVideo={continueStudyVideo}
              todayUploadedAudio={userReadingCheckinSupport.todayUploadedAudio}
              myRequiredVideosCount={myRequiredVideos.length}
              myLearningVideosCount={myLearningVideos.length}
              myCompletedVideosCount={myCompletedVideos.length}
              latestAudioRecord={userReadingCheckinSupport.latestAudioRecord}
              onOpenCourseCenter={openCourseCenter}
              onOpenReadingCenter={openReadingCenter}
              onOpenMentorZone={openMentorZone}
            />
          ))
    : null;
  const activePushDetailOpen = readingContentPushSupport.pushDetailOpen || courseAdminSupport.pushDetailSupport.coursePushDetailOpen;
  const activePushDetailLoading = readingContentPushSupport.pushDetailOpen
    ? readingContentPushSupport.pushDetailLoading
    : courseAdminSupport.pushDetailSupport.coursePushDetailLoading;
  const activePushDetailTitle = readingContentPushSupport.pushDetailOpen
    ? readingContentPushSupport.pushDetailTitle
    : courseAdminSupport.pushDetailSupport.coursePushDetailTitle;
  const activePushDetailRows = readingContentPushSupport.pushDetailOpen
    ? readingContentPushSupport.pushDetailRows
    : courseAdminSupport.pushDetailSupport.coursePushDetailRows;

  return (
    <div className={adminMode ? undefined : "workspace-shell workspace-shell--editorial workspace-shell--minimal"}>
      {adminMode ? (
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={visibleAdminTabs}
          />
      ) : (
        userViewContent
      )}

      <PushDetailModal
        open={activePushDetailOpen}
        title={activePushDetailTitle}
        loading={activePushDetailLoading}
        rows={activePushDetailRows}
        onCancel={() => {
          if (readingContentPushSupport.pushDetailOpen) {
            readingContentPushSupport.closeReadingContentPushDetail();
            return;
          }
          courseAdminSupport.pushDetailSupport.closeCoursePushDetail();
        }}
      />

      <MagicAcademyPageModals
        videoDetail={videoDetail}
        videoModal={videoModal}
        users={users}
        videoSubmitting={courseVideoUploadSupport.videoSubmitting}
        videoUploadProgress={courseVideoUploadSupport.videoUploadProgress}
        setVideoModal={setVideoModal}
        submitVideo={courseVideoUploadSupport.submitVideo}
        VideoDispatchFormModal={VideoDispatchFormModal}
        readingContentModalOpen={readingContentModalOpen}
        readingContentModalMode={readingContentModalMode}
        readingContentSubmitting={readingContentSubmitting}
        readingContentEditing={readingContentEditing}
        readingContentPreferredSeriesId={readingContentPreferredSeriesId}
        activeReadingSeriesOptions={activeReadingSeriesOptions}
        employeeUsers={employeeUsers}
        employeeDepartmentOptions={employeeDepartmentOptions}
        employeePositionOptions={employeePositionOptions}
        employmentStatusOptions={employmentStatusOptions}
        openReadingSeriesModal={readingSeriesSupport.openReadingSeriesModal}
        setReadingContentModalOpen={setReadingContentModalOpen}
        setReadingContentEditing={setReadingContentEditing}
        handleSubmitReadingContent={handleSubmitReadingContent}
        readingSeriesSupport={readingSeriesSupport}
        readingSeriesForm={readingSeriesForm}
        readingSeriesDetailOpen={readingSeriesSupport.readingSeriesDetailOpen}
        readingSeriesDetail={readingSeriesSupport.readingSeriesDetail}
        readingSeriesDetailLoading={readingSeriesSupport.readingSeriesDetailLoading}
        setReadingSeriesDetailOpen={readingSeriesSupport.setReadingSeriesDetailOpen}
        readingImportPreviewOpen={readingContentImportSupport.readingImportPreviewOpen}
        readingImportSubmitting={readingContentImportSupport.readingImportSubmitting}
        setReadingImportPreviewOpen={readingContentImportSupport.setReadingImportPreviewOpen}
        handleConfirmReadingImport={readingContentImportSupport.handleConfirmReadingImport}
        readingImportRows={readingContentImportSupport.readingImportRows}
        readingImportSummary={readingContentImportSupport.readingImportSummary}
        {...audioStatsSupport.modalProps}
        watchConfirmState={watchConfirmState}
        handleWatchConfirmContinue={handleWatchConfirmContinue}
        seriesModal={courseSeriesSupport.seriesModal}
        seriesForm={seriesForm}
        setSeriesModal={courseSeriesSupport.setSeriesModal}
        submitSeries={courseSeriesSupport.submitSeries}
        pointModal={courseQuizSupport.pointModal}
        pointForm={pointForm}
        setPointModal={courseQuizSupport.setPointModal}
        submitPoint={courseQuizSupport.submitPoint}
        questionModal={courseQuizSupport.questionModal}
        setQuestionModal={courseQuizSupport.setQuestionModal}
        submitQuestion={courseQuizSupport.submitQuestion}
        quizAnswerState={quizAnswerState}
        setQuizAnswerState={setQuizAnswerState}
        handleQuizSubmit={handleQuizSubmit}
      />
      <QuizImportModal
        open={courseQuizSupport.quizImportState.open}
        pointId={courseQuizSupport.quizImportState.pointId}
        source={courseQuizSupport.quizImportState.source}
        onClose={() => courseQuizSupport.setQuizImportState({ open: false, pointId: null, source: "upload" })}
        onCommitted={courseQuizSupport.handleQuizImportCommitted}
      />
      <MaterialAssetPickerModal
        open={readingContentImportSupport.readingImportMaterialPickerOpen}
        onCancel={readingContentImportSupport.closeReadingImportMaterialPicker}
        onPick={readingContentImportSupport.handlePickReadingImportMaterial}
        title="从素材库选择读书导入文件"
        assetType="document"
        acceptExtensions={["xlsx"]}
        hint="仅展示素材库中的 .xlsx 文件，选择后会直接进入读书内容导入预览。"
        pickButtonText="导入此文件"
      />
    </div>
  );
}
