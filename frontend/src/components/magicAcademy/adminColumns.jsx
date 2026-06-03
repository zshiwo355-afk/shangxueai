import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Image, Popconfirm, Space, Tag } from "antd";
import { formatTime, getVideoStatusMeta } from "./magicAcademyShared";
import PushStatusCell from "./shared/PushStatusCell";

export function buildStatsColumns(showWhitelist = false) {
  const columns = [
    { title: "姓名", dataIndex: "name" },
    { title: "部门", dataIndex: "department", render: (v) => v || "未分配部门" },
    { title: "已观看", dataIndex: "watched_seconds", render: (v) => formatTime(v) },
    { title: "进度", dataIndex: "progress_percent", render: (v) => `${Math.round(v || 0)}%` },
    { title: "完成", dataIndex: "is_completed", render: (v) => v ? <Tag color="success">已完成</Tag> : <Tag>未完成</Tag> },
    { title: "答题通过", dataIndex: "quiz_passed", render: (v) => v ? "是" : "否" },
    { title: "答题次数", dataIndex: "answer_attempt_count" },
  ];
  if (showWhitelist) {
    columns.push({ title: "白名单", dataIndex: "is_whitelist_user", render: (v) => v ? <Tag color="purple">白名单</Tag> : "—" });
  }
  return columns;
}

export const answerColumns = [
  { title: "姓名", dataIndex: "name" },
  { title: "节点", dataIndex: "quiz_point", render: (v) => `${formatTime(v)}` },
  { title: "题目", dataIndex: "question", ellipsis: true },
  { title: "用户答案", dataIndex: "user_answer", render: (v) => Array.isArray(v) ? v.join(" / ") : "" },
  { title: "是否正确", dataIndex: "is_correct", render: (v) => v ? "是" : "否" },
  { title: "提交次数", dataIndex: "attempt_no" },
];

export const audioColumns = [
  { title: "姓名", dataIndex: "name" },
  { title: "部门", dataIndex: "department", render: (v) => v || "—" },
  { title: "月份", dataIndex: "month" },
  { title: "应上传天数", dataIndex: "expected_upload_days" },
  { title: "实际上传天数", dataIndex: "actual_upload_days" },
  { title: "实际上传次数", dataIndex: "actual_upload_count" },
  { title: "补卡次数", dataIndex: "makeup_count" },
  { title: "缺少次数", dataIndex: "missing_count" },
  { title: "上传率", dataIndex: "upload_rate", render: (v) => `${v}%` },
];

export function buildAdminVideoColumns({
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
}) {
  return [
    {
      title: "封面",
      dataIndex: "cover_url",
      width: 92,
      render: (value) => value ? (
        <Image
          src={value}
          width={56}
          height={56}
          style={{ objectFit: "cover", borderRadius: 8 }}
          preview={false}
        />
      ) : "—",
    },
    { title: "标题", dataIndex: "title" },
    { title: "分类", dataIndex: "category", render: (v) => v || "—" },
    {
      title: "系列",
      key: "series",
      render: (_, row) => row.series_id ? `${row.series_title} / 第 ${row.series_order} 节` : "—",
    },
    { title: "时长", dataIndex: "duration_seconds", render: (v) => formatTime(v) },
    {
      title: "状态",
      dataIndex: "status",
      render: (_, row) => {
        const meta = getVideoStatusMeta(row);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: "上传", dataIndex: "upload_status", render: (v) => <Tag color={v === "completed" ? "success" : v === "failed" ? "error" : "processing"}>{v || "completed"}</Tag> },
    { title: "必修", dataIndex: "is_required", render: (v) => v ? <Tag color="gold">必修</Tag> : "—" },
    {
      title: "推送",
      key: "push",
      width: 240,
      render: (_, row) => {
        const summary = videoPushSummaryMap?.[row.id] || null;
        return (
          <PushStatusCell
            summary={summary}
            retryLoading={retryingVideoId === row.id}
            onOpenDetail={() => handleOpenVideoPushDetail(row)}
            onRetry={() => handleRetryVideoPush(row)}
          />
        );
      },
    },
    {
      title: "操作",
      key: "action",
      width: 280,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" type="link" onClick={() => openAdminVideoDetail(row.id)}>查看 / 配置</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => setVideoModal(row)}>编辑</Button>
          {row.status === "published" ? (
            <Tag color="success">已发布</Tag>
          ) : (
            <Button
              size="small"
              type="primary"
              loading={publishingVideoId === row.id}
              disabled={!row.can_publish || disablingVideoId === row.id}
              onClick={() => handlePublishVideo(row.id)}
            >
              发布
            </Button>
          )}
          {row.status === "published" ? (
            <Button
              size="small"
              loading={disablingVideoId === row.id}
              disabled={publishingVideoId === row.id}
              onClick={() => handleDisableVideo(row.id)}
            >
              下架
            </Button>
          ) : null}
          <Popconfirm title="确认删除该视频？" onConfirm={async () => { await deleteMagicVideo(row.id); await reloadAdminData(); }}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
}

export function buildWhitelistColumns({ deleteMagicWhitelist, reloadAdminData }) {
  return [
    { title: "视频", dataIndex: "video_title" },
    { title: "用户", dataIndex: "user_name" },
    { title: "部门", dataIndex: "department", render: (v) => v || "—" },
    { title: "备注", dataIndex: "note", render: (v) => v || "—" },
    {
      title: "操作",
      render: (_, row) => (
        <Popconfirm title="移出白名单？" onConfirm={async () => { await deleteMagicWhitelist(row.id); await reloadAdminData(); }}>
          <Button size="small" danger>删除</Button>
        </Popconfirm>
      ),
    },
  ];
}
