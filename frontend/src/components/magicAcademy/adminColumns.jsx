import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Image, Popconfirm, Space, Tag } from "antd";
import { formatTime, getVideoStatusMeta } from "./magicAcademyShared";

function getPushStatusMeta(status) {
  if (status === "sent") return { label: "已推送", color: "success" };
  if (status === "partial") return { label: "部分成功", color: "warning" };
  if (status === "failed") return { label: "推送失败", color: "error" };
  if (status === "pending") return { label: "待推送", color: "default" };
  if (status === "running") return { label: "推送中", color: "processing" };
  return { label: "未推送", color: "default" };
}

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
        const meta = getPushStatusMeta(summary?.status);
        const latestTime = summary?.finished_at || summary?.started_at || summary?.created_at || "";
        const retryDisabled = summary?.status === "running" || summary?.status === "pending";
        return (
          <Space direction="vertical" size={4}>
            <Space wrap size={4}>
              <Tag color={meta.color}>{meta.label}</Tag>
              <span style={{ color: "#8c8c8c", fontSize: 12 }}>
                {summary ? `成功 ${summary.success_count || 0} / 失败 ${summary.failed_count || 0} / 跳过 ${summary.skipped_count || 0}` : "暂无记录"}
              </span>
            </Space>
            <span style={{ color: "#8c8c8c", fontSize: 12 }}>
              {latestTime ? latestTime.replace("T", " ").slice(0, 19) : "—"}
            </span>
            <Space size={4} wrap>
              <Button size="small" onClick={() => handleOpenVideoPushDetail(row)}>
                查看明细
              </Button>
              <Button
                size="small"
                disabled={retryDisabled}
                loading={retryingVideoId === row.id}
                onClick={() => handleRetryVideoPush(row)}
              >
                立即补推
              </Button>
            </Space>
          </Space>
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
