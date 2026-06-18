import {
  CommentOutlined,
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Divider,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  QRCode,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import MaterialAssetPickerModal from "../../common/MaterialAssetPickerModal";
import { buildMaterialAssetPreviewUrl } from "../../../lib/api.materials";
import {
  batchUpdateLiveComments,
  createLiveRoom,
  deleteLiveRoom,
  deleteLiveComment,
  disableLiveRoom,
  getLiveCommentSettings,
  getLiveRoom,
  getPublicLiveShareConfig,
  hideLiveComment,
  listLiveCommentToggleLogs,
  listLiveComments,
  listLiveRooms,
  publishLiveRoom,
  restoreLiveComment,
  toggleLiveRoomComments,
  updateLiveRoom,
  updateLiveCommentSettings,
  uploadLiveImage,
  uploadLiveVideo,
} from "../../../lib/api.live";

const { Paragraph, Text, Title } = Typography;

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "scheduled", label: "未开始" },
  { value: "live", label: "进行中" },
  { value: "replay", label: "回放中" },
  { value: "ended", label: "已结束" },
  { value: "disabled", label: "已下架" },
];

const STATUS_META = {
  draft: { color: "default", label: "草稿" },
  scheduled: { color: "processing", label: "未开始" },
  live: { color: "success", label: "进行中" },
  replay: { color: "blue", label: "回放中" },
  ended: { color: "default", label: "已结束" },
  disabled: { color: "error", label: "已下架" },
};

const COMMENT_STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "visible", label: "可见" },
  { value: "hidden", label: "已隐藏" },
  { value: "deleted", label: "已删除" },
];

const COMMENT_STATUS_META = {
  visible: { color: "success", label: "可见" },
  hidden: { color: "warning", label: "已隐藏" },
  deleted: { color: "default", label: "已删除" },
};

function formatTime(value) {
  if (!value) return "—";
  return String(value).replace("T", " ").slice(0, 16);
}

function statusTag(row) {
  const status = row.effective_status || row.status || "draft";
  const meta = STATUS_META[status] || { color: "default", label: row.status_label || status };
  return <Tag bordered={false} color={meta.color}>{row.status_label || meta.label}</Tag>;
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "—";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function defaultValues() {
  return {
    title: "",
    lecturer: "",
    intro: "",
    detail_html: "",
    content_type: "recorded",
    video_source: "upload",
    video_material_asset_id: null,
    video_object_key: "",
    video_url: "",
    video_mime_type: "video/mp4",
    video_file_name: "",
    video_file_size: 0,
    duration_seconds: 0,
    stream_url: "",
    cover_url: "",
    cover_object_key: "",
    cover_material_asset_id: null,
    share_title: "",
    share_desc: "",
    share_image_url: "",
    share_image_object_key: "",
    share_image_material_asset_id: null,
    start_time: null,
    duration_minutes: null,
    status: "draft",
    allow_like: true,
    allow_comment: true,
    show_counters: true,
  };
}

function normalizeRoomToForm(room) {
  return {
    ...defaultValues(),
    ...room,
    start_time: room?.start_time ? dayjs(room.start_time) : null,
  };
}

function buildPayload(values) {
  return {
    ...values,
    start_time: values.start_time ? values.start_time.format("YYYY-MM-DDTHH:mm:ss") : null,
    duration_minutes: values.duration_minutes || null,
    video_material_asset_id: values.video_material_asset_id || null,
    cover_material_asset_id: values.cover_material_asset_id || null,
    share_image_material_asset_id: values.share_image_material_asset_id || null,
    video_file_size: Number(values.video_file_size || 0),
    duration_seconds: Number(values.duration_seconds || 0),
  };
}

function getShareInfo(row) {
  const share = row?.share || {};
  const shareUrl = share.url || row?.share_url || row?.public_url || "";
  const liveUrl = share.live_url || row?.public_url || shareUrl;
  return {
    title: share.title || row?.share_title || row?.title || "怀仁商学院",
    description: share.description || row?.share_desc || row?.intro || "",
    image: share.image || row?.share_image_url || row?.cover_url || "",
    shareUrl,
    liveUrl,
  };
}

function getPreviewUrl(row) {
  const slug = (row?.slug || "").trim();
  return slug ? `/live/${encodeURIComponent(slug)}?preview=1` : (row?.public_url || "");
}

function canOpenPreview(row) {
  return Boolean((row?.slug || "").trim() || row?.public_url);
}

function openPreview(row) {
  const url = getPreviewUrl(row);
  if (!url) return;
  window.open(url, "_blank", "noopener");
}

function sdkStatusTag(item) {
  if (item?.enabled) return <Tag color="success" bordered={false}>已启用</Tag>;
  if (item?.configured) return <Tag color="warning" bordered={false}>签名失败</Tag>;
  return <Tag bordered={false}>未配置</Tag>;
}

function LiveShareModal({ room, open, onCancel, onCopy }) {
  const share = getShareInfo(room);
  const qrValue = share.liveUrl || share.shareUrl || " ";
  const previewEnabled = canOpenPreview(room);
  const [loading, setLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);

  useEffect(() => {
    if (!open || !room?.slug) {
      setDiagnostics(null);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    getPublicLiveShareConfig(room.slug, share.shareUrl || share.liveUrl)
      .then((data) => {
        if (alive) setDiagnostics(data?.diagnostics || null);
      })
      .catch((error) => {
        if (alive) setDiagnostics({ error: error?.message || "分享诊断加载失败。" });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, room?.slug, share.liveUrl, share.shareUrl]);

  return (
    <Modal
      open={open}
      title="分享观看"
      width={720}
      footer={null}
      onCancel={onCancel}
      destroyOnHidden
    >
      <div className="live-share-modal">
        <div className="live-share-modal__qr">
          <QRCode value={qrValue} size={184} bordered={false} />
          <Text type="secondary">扫码直达观看页</Text>
          <Button type="primary" onClick={() => onCopy(share.shareUrl)}>复制卡片入口</Button>
          <Button type="link" onClick={() => onCopy(share.liveUrl)}>复制观看链接</Button>
        </div>
        <div className="live-share-modal__content">
          <div className="live-share-modal__tabs">
            <Text strong>店铺 H5</Text>
            <Text type="secondary">微信扫码打开后，点右上角分享</Text>
          </div>
          <div className="live-share-modal__preview">
            {share.image ? <img src={share.image} alt="" /> : <div className="live-share-modal__empty-cover" />}
            <div>
              <Text strong ellipsis={{ tooltip: share.title }}>{share.title}</Text>
              <Paragraph type="secondary" ellipsis={{ rows: 2 }}>{share.description || "暂无分享描述"}</Paragraph>
            </div>
          </div>
          <div className="live-share-modal__tip">
            复制链接发到微信/企微时，客户端可能只显示普通链接；扫码进入微信内置浏览器后再右上角分享，才是更稳定的卡片路径。
          </div>
          <Input.TextArea value={share.shareUrl} readOnly autoSize={{ minRows: 2, maxRows: 3 }} />
          <Space wrap>
            <Button onClick={() => window.open(share.shareUrl, "_blank", "noopener")}>打开卡片入口</Button>
            <Button disabled={!previewEnabled} onClick={() => window.open(getPreviewUrl(room), "_blank", "noopener")}>预览观看页</Button>
          </Space>
          <Divider style={{ margin: "6px 0" }} />
          <div className="live-share-diagnostics">
            <Text strong>分享诊断</Text>
            {diagnostics?.error ? <Alert type="warning" showIcon message={diagnostics.error} /> : null}
            <div className="live-share-diagnostics__grid">
              <span>卡片标题</span><Text copyable>{share.title}</Text>
              <span>卡片描述</span><Text>{share.description || "暂无"}</Text>
              <span>卡片图片</span><Text copyable ellipsis={{ tooltip: share.image }}>{share.image || "暂无"}</Text>
              <span>签名地址</span><Text copyable ellipsis={{ tooltip: diagnostics?.sign_url }}>{diagnostics?.sign_url || (loading ? "检测中..." : "暂无")}</Text>
              <span>企微 JS-SDK</span><Space size={6}>{sdkStatusTag(diagnostics?.wecom)}<Text type="secondary">{diagnostics?.wecom?.reason || ""}</Text></Space>
              <span>企微 Agent</span><Space size={6}>{sdkStatusTag(diagnostics?.wecom_agent)}<Text type="secondary">{diagnostics?.wecom_agent?.reason || ""}</Text></Space>
              <span>微信公众号</span><Space size={6}>{sdkStatusTag(diagnostics?.wechat)}<Text type="secondary">{diagnostics?.wechat?.reason || ""}</Text></Space>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LiveCommentsDrawer({ room, open, onClose, onRoomUpdated }) {
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [filters, setFilters] = useState({ status: "", keyword: "" });
  const [allowComment, setAllowComment] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [settingsText, setSettingsText] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [toggleLogs, setToggleLogs] = useState([]);

  const load = useCallback(async (page = pagination.current, pageSize = pagination.pageSize) => {
    if (!room?.id) return;
    setLoading(true);
    try {
      const data = await listLiveComments({
        room_id: room.id,
        page,
        page_size: pageSize,
        status: filters.status,
        keyword: filters.keyword,
      });
      setRows(data?.items || []);
      setPagination({ current: data?.page || page, pageSize: data?.page_size || pageSize, total: data?.total || 0 });
    } catch (error) {
      message.error(error?.message || "评论列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [filters.keyword, filters.status, message, pagination.current, pagination.pageSize, room?.id]);

  const loadCommentSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const data = await getLiveCommentSettings();
      setSettingsText(data?.block_words || "");
    } catch (error) {
      message.error(error?.message || "评论设置加载失败。");
    } finally {
      setSettingsLoading(false);
    }
  }, [message]);

  const loadToggleLogs = useCallback(async () => {
    if (!room?.id) return;
    try {
      const data = await listLiveCommentToggleLogs(room.id, { limit: 6 });
      setToggleLogs(data?.items || []);
    } catch {
      setToggleLogs([]);
    }
  }, [room?.id]);

  useEffect(() => {
    if (!open || !room?.id) return;
    setAllowComment(Boolean(room.allow_comment));
    setSelectedRowKeys([]);
    load(1, pagination.pageSize);
    loadCommentSettings();
    loadToggleLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room?.id]);

  useEffect(() => {
    if (!open || !room?.id) return;
    load(1, pagination.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);

  const updateAllowComment = async (checked) => {
    if (!room?.id) return;
    setSwitching(true);
    try {
      const updated = await toggleLiveRoomComments(room.id, checked);
      setAllowComment(Boolean(updated?.allow_comment));
      message.success(checked ? "已开启评论。" : "已关闭评论。");
      loadToggleLogs();
      onRoomUpdated?.();
    } catch (error) {
      message.error(error?.message || "更新评论开关失败。");
    } finally {
      setSwitching(false);
    }
  };

  const changeCommentStatus = async (row, action) => {
    try {
      if (action === "hide") {
        await hideLiveComment(row.id);
        message.success("已隐藏评论。");
      } else if (action === "restore") {
        await restoreLiveComment(row.id);
        message.success("已恢复评论。");
      } else {
        await deleteLiveComment(row.id);
        message.success("已删除评论。");
      }
      load();
    } catch (error) {
      message.error(error?.message || "评论操作失败。");
    }
  };

  const saveCommentSettings = async () => {
    setSettingsSaving(true);
    try {
      await updateLiveCommentSettings({ block_words: settingsText });
      message.success("敏感词配置已保存。");
      loadCommentSettings();
    } catch (error) {
      message.error(error?.message || "评论设置保存失败。");
    } finally {
      setSettingsSaving(false);
    }
  };

  const batchAction = async (action) => {
    if (!selectedRowKeys.length) return;
    try {
      const result = await batchUpdateLiveComments({ ids: selectedRowKeys, action });
      message.success(`已处理 ${result?.affected || 0} 条评论。`);
      setSelectedRowKeys([]);
      load();
    } catch (error) {
      message.error(error?.message || "批量操作失败。");
    }
  };

  const columns = [
    {
      title: "昵称",
      dataIndex: "nickname",
      width: 120,
      render: (text, row) => text || (row.visitor_id ? "匿名访客" : "访客"),
    },
    {
      title: "评论内容",
      dataIndex: "content",
      render: (text) => <Paragraph className="live-comment-content" ellipsis={{ rows: 2 }}>{text || "空评论"}</Paragraph>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 92,
      render: (status = "visible") => {
        const meta = COMMENT_STATUS_META[status] || COMMENT_STATUS_META.visible;
        return <Tag color={meta.color} bordered={false}>{meta.label}</Tag>;
      },
    },
    {
      title: "时间",
      dataIndex: "created_at",
      width: 150,
      render: (value) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-",
    },
    {
      title: "操作",
      width: 160,
      render: (_, row) => (
        <Space size={6}>
          {row.status === "hidden" ? (
            <Button size="small" onClick={() => changeCommentStatus(row, "restore")}>恢复</Button>
          ) : (
            <Button size="small" onClick={() => changeCommentStatus(row, "hide")}>隐藏</Button>
          )}
          <Popconfirm title="确认删除这条评论？" onConfirm={() => changeCommentStatus(row, "delete")}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Drawer
      open={open}
      width={760}
      title={room?.title ? `评论管理：${room.title}` : "评论管理"}
      onClose={onClose}
      destroyOnHidden
    >
      <div className="live-comment-drawer">
        <div className="live-comment-drawer__toolbar">
          <Space wrap>
            <Switch
              checked={allowComment}
              loading={switching}
              checkedChildren="评论开"
              unCheckedChildren="评论关"
              onChange={updateAllowComment}
            />
            <Select
              value={filters.status}
              options={COMMENT_STATUS_OPTIONS}
              style={{ width: 120 }}
              onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            />
            <Input.Search
              allowClear
              placeholder="搜索评论"
              value={filters.keyword}
              onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
              onSearch={() => load(1, pagination.pageSize)}
              style={{ width: 240 }}
            />
            <Button disabled={!selectedRowKeys.length} onClick={() => batchAction("hide")}>批量隐藏</Button>
            <Button disabled={!selectedRowKeys.length} onClick={() => batchAction("restore")}>批量恢复</Button>
            <Popconfirm title="确认批量删除选中的评论？" onConfirm={() => batchAction("delete")}>
              <Button danger disabled={!selectedRowKeys.length}>批量删除</Button>
            </Popconfirm>
          </Space>
          <Button onClick={() => load(1, pagination.pageSize)}>刷新</Button>
        </div>
        <div className="live-comment-settings">
          <div className="live-comment-settings__main">
            <Text strong>敏感词配置</Text>
            <Input.TextArea
              value={settingsText}
              onChange={(event) => setSettingsText(event.target.value)}
              placeholder="多个词用逗号、顿号或换行分隔"
              autoSize={{ minRows: 2, maxRows: 4 }}
              disabled={settingsLoading}
            />
            <Text type="secondary">用户评论命中敏感词时会被拦截，不会进入评论区。</Text>
          </div>
          <Button loading={settingsSaving} onClick={saveCommentSettings}>保存敏感词</Button>
        </div>
        <div className="live-comment-logs">
          <Text strong>评论开关记录</Text>
          <Space size={6} wrap>
            {toggleLogs.length ? toggleLogs.map((item) => (
              <Tag key={item.id} bordered={false} color={item.allow_comment ? "success" : "default"}>
                {item.allow_comment ? "开启" : "关闭"} · {item.created_at ? dayjs(item.created_at).format("MM-DD HH:mm") : ""}
              </Tag>
            )) : <Text type="secondary">暂无记录</Text>}
          </Space>
        </div>
        <Table
          rowKey="id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={columns}
          dataSource={rows}
          loading={loading}
          tableLayout="fixed"
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
          }}
          onChange={(next) => load(next.current, next.pageSize)}
          locale={{ emptyText: <Empty description="暂无评论" /> }}
        />
      </div>
    </Drawer>
  );
}

function LiveRoomList() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 12, total: 0 });
  const [filters, setFilters] = useState({ status: "", keyword: "" });
  const [shareRoom, setShareRoom] = useState(null);
  const [commentRoom, setCommentRoom] = useState(null);

  const load = useCallback(async (page = pagination.current, pageSize = pagination.pageSize) => {
    setLoading(true);
    try {
      const data = await listLiveRooms({
        page,
        page_size: pageSize,
        status: filters.status,
        keyword: filters.keyword,
      });
      setRows(data?.items || []);
      setPagination({ current: data?.page || page, pageSize: data?.page_size || pageSize, total: data?.total || 0 });
    } catch (error) {
      message.error(error?.message || "直播列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [filters.keyword, filters.status, message, pagination.current, pagination.pageSize]);

  useEffect(() => {
    load(1, pagination.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);

  const copyText = async (text) => {
    const value = (text || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      message.success("链接已复制。");
    } catch {
      message.info(value);
    }
  };

  const publish = async (row) => {
    try {
      await publishLiveRoom(row.id);
      message.success("已发布。");
      load();
    } catch (error) {
      message.error(error?.message || "发布失败。");
    }
  };

  const disable = async (row) => {
    try {
      await disableLiveRoom(row.id);
      message.success("已下架。");
      load();
    } catch (error) {
      message.error(error?.message || "下架失败。");
    }
  };

  const remove = async (row) => {
    try {
      await deleteLiveRoom(row.id);
      message.success("已删除。");
      load();
    } catch (error) {
      message.error(error?.message || "删除失败。");
    }
  };

  const columns = [
    {
      title: "封面",
      dataIndex: "cover_url",
      width: 112,
      render: (url) => url ? <Image src={url} width={88} height={50} className="live-cover-thumb" /> : <div className="live-cover-empty" />,
    },
    {
      title: "活动",
      dataIndex: "title",
      width: 320,
      render: (_, row) => (
        <Space className="live-admin-activity" direction="vertical" size={2}>
          <Text strong ellipsis={{ tooltip: row.title }}>{row.title}</Text>
          <Text type="secondary" ellipsis>
            {row.lecturer || "未填写主讲人"} · {row.content_type === "live_stream" ? "直播流" : "录播"}
          </Text>
        </Space>
      ),
    },
    { title: "开始时间", dataIndex: "start_time", width: 150, render: formatTime },
    { title: "状态", width: 100, render: (_, row) => statusTag(row) },
    {
      title: "数据",
      width: 230,
      render: (_, row) => (
        <Space size={8} wrap>
          <Tag bordered={false}>PV {row.pv_count ?? row.view_pv_count ?? row.view_count ?? 0}</Tag>
          <Tag bordered={false}>UV {row.uv_count ?? row.view_uv_count ?? 0}</Tag>
          <Tag bordered={false}>赞 {row.like_count || 0}</Tag>
          <Tag bordered={false}>分享 {row.share_count || 0}</Tag>
        </Space>
      ),
    },
    {
      title: "操作",
      width: 430,
      fixed: "right",
      render: (_, row) => {
        const previewEnabled = canOpenPreview(row);
        return (
          <Space className="live-admin-actions" size={6}>
            <Button size="small" icon={<EyeOutlined />} disabled={!previewEnabled} onClick={() => openPreview(row)}>预览</Button>
            <Button size="small" icon={<CopyOutlined />} onClick={() => setShareRoom(row)}>分享卡片</Button>
            <Button size="small" icon={<CommentOutlined />} onClick={() => setCommentRoom(row)}>评论</Button>
            <Button size="small" icon={<SaveOutlined />} onClick={() => navigate(`${row.id}/edit`)}>编辑</Button>
            {row.status === "disabled" || row.status === "draft" ? (
              <Button size="small" type="primary" onClick={() => publish(row)}>发布</Button>
            ) : (
              <Button size="small" onClick={() => disable(row)}>下架</Button>
            )}
            <Popconfirm title="确认删除该直播活动？" onConfirm={() => remove(row)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="live-admin-page">
      <div className="live-admin-hero">
        <div>
          <Text className="live-admin-eyebrow">Public Live</Text>
          <Title level={3}>直播管理</Title>
          <Paragraph type="secondary">创建公开免登录的录播/直播活动，分享卡片可直接发给外部访客。</Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("create")}>新建直播</Button>
      </div>

      <div className="live-admin-toolbar">
        <Input.Search
          allowClear
          placeholder="搜索活动标题"
          enterButton="搜索"
          style={{ maxWidth: 360 }}
          value={filters.keyword}
          onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
          onSearch={() => load(1, pagination.pageSize)}
        />
        <Select
          value={filters.status}
          options={STATUS_OPTIONS}
          style={{ width: 150 }}
          onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
        />
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        tableLayout="fixed"
        scroll={{ x: 1380 }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
        }}
        onChange={(next) => load(next.current, next.pageSize)}
        locale={{ emptyText: <Empty description="还没有公开直播活动" /> }}
      />
      <LiveShareModal
        room={shareRoom}
        open={!!shareRoom}
        onCancel={() => setShareRoom(null)}
        onCopy={copyText}
      />
      <LiveCommentsDrawer
        room={commentRoom}
        open={!!commentRoom}
        onClose={() => setCommentRoom(null)}
        onRoomUpdated={() => load()}
      />
    </div>
  );
}

function LiveCardPreview({ values, coverPreview, sharePreview }) {
  const title = values?.share_title || values?.title || "直播活动标题";
  const desc = values?.share_desc || values?.intro || "这里展示分享描述，外部用户在企微/微信里先看到它。";
  const image = sharePreview || values?.share_image_url || coverPreview || values?.cover_url || "";
  return (
    <div className="live-share-preview">
      <div className="live-share-preview__image">
        {image ? <img src={image} alt="" /> : <VideoCameraOutlined />}
      </div>
      <div className="live-share-preview__body">
        <Text strong ellipsis>{title}</Text>
        <Paragraph className="live-share-preview__desc" ellipsis={{ rows: 2 }} type="secondary">{desc}</Paragraph>
        <Space size={8}>
          <Tag bordered={false}>怀仁商学院</Tag>
          <Tag bordered={false}>公开免登录</Tag>
        </Space>
      </div>
    </div>
  );
}

function LiveRoomEditor() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const values = Form.useWatch([], form) || form.getFieldsValue(true);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [coverPreview, setCoverPreview] = useState("");
  const [sharePreview, setSharePreview] = useState("");
  const [picker, setPicker] = useState(null);

  const contentType = Form.useWatch("content_type", form) || "recorded";
  const videoSource = Form.useWatch("video_source", form) || "upload";

  useEffect(() => {
    form.setFieldsValue(defaultValues());
  }, [form]);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    setLoading(true);
    getLiveRoom(id)
      .then((room) => {
        if (!alive) return;
        form.setFieldsValue(normalizeRoomToForm(room));
        setCoverPreview(room.cover_url || "");
        setSharePreview(room.share_image_url || "");
      })
      .catch((error) => {
        if (!alive) return;
        message.error(error?.message || "直播详情加载失败。");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [form, id, isEdit, message]);

  const uploadImage = (kind) => async (file) => {
    try {
      const result = await uploadLiveImage(file);
      if (kind === "cover") {
        form.setFieldsValue({
          cover_url: result.url,
          cover_object_key: result.object_key,
          cover_material_asset_id: null,
        });
        setCoverPreview(result.url || "");
      } else {
        form.setFieldsValue({
          share_image_url: result.url,
          share_image_object_key: result.object_key,
          share_image_material_asset_id: null,
        });
        setSharePreview(result.url || "");
      }
      message.success("图片已上传。");
    } catch (error) {
      message.error(error?.message || "图片上传失败。");
    }
    return Upload.LIST_IGNORE;
  };

  const pickAsset = async (asset) => {
    if (!picker) return;
    if (picker === "video") {
      setVideoFile(null);
      form.setFieldsValue({
        content_type: "recorded",
        video_source: "material",
        video_material_asset_id: asset.id,
        video_file_name: asset.file_name || asset.name || "",
        video_file_size: asset.file_size || 0,
        duration_seconds: asset.duration_seconds || 0,
      });
      if (asset.cover_url && !coverPreview) {
        form.setFieldsValue({ cover_url: asset.cover_url });
        setCoverPreview(asset.cover_url);
      }
    } else {
      const previewUrl = buildMaterialAssetPreviewUrl(asset.id);
      if (picker === "cover") {
        form.setFieldsValue({
          cover_material_asset_id: asset.id,
          cover_url: asset.cover_url || "",
          cover_object_key: "",
        });
        setCoverPreview(asset.cover_url || previewUrl);
      } else {
        form.setFieldsValue({
          share_image_material_asset_id: asset.id,
          share_image_url: asset.cover_url || "",
          share_image_object_key: "",
        });
        setSharePreview(asset.cover_url || previewUrl);
      }
    }
    setPicker(null);
  };

  const selectVideoFile = (file) => {
    setVideoFile(file);
    form.setFieldsValue({
      content_type: "recorded",
      video_source: "upload",
      video_material_asset_id: null,
      video_file_name: file.name,
      video_file_size: file.size || 0,
      video_mime_type: file.type || "video/mp4",
    });
    return Upload.LIST_IGNORE;
  };

  const submit = async (action) => {
    setSaving(true);
    setUploadProgress(0);
    try {
      const raw = await form.validateFields();
      let payload = buildPayload(raw);
      if (action === "draft" && !isEdit) payload.status = "draft";
      if (videoFile) {
        const result = await uploadLiveVideo(videoFile, { onProgress: setUploadProgress });
        payload = {
          ...payload,
          video_source: "upload",
          video_material_asset_id: null,
          video_object_key: result.object_key,
          video_url: result.url,
          video_mime_type: result.mime_type,
          video_file_name: result.file_name,
          video_file_size: result.file_size,
          duration_seconds: result.duration_seconds || payload.duration_seconds || 0,
        };
      }
      const saved = isEdit ? await updateLiveRoom(id, payload) : await createLiveRoom(payload);
      if (action === "publish") {
        await publishLiveRoom(saved.id);
        message.success("直播已发布，分享卡片可直接发给外部访客。");
      } else {
        message.success("已保存。");
      }
      navigate("/admin/live");
    } catch (error) {
      message.error(error?.message || "保存失败。");
    } finally {
      setSaving(false);
      setUploadProgress(0);
    }
  };

  const currentVideoName = videoFile?.name || values?.video_file_name || "";
  const pickerAssetType = picker === "video" ? "video" : "image";

  return (
    <div className="live-admin-page">
      <div className="live-editor-head">
        <Button onClick={() => navigate("/admin/live")}>返回列表</Button>
        <div>
          <Title level={3}>{isEdit ? "编辑直播" : "新建直播"}</Title>
          <Text type="secondary">公开免登录观看，发布后即可分享卡片。</Text>
        </div>
        <Space>
          <Button icon={<SaveOutlined />} loading={saving} onClick={() => submit("draft")}>保存</Button>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={saving} onClick={() => submit("publish")}>发布</Button>
        </Space>
      </div>

      <SpinLike loading={loading}>
        <div className="live-editor-grid">
          <Form
            form={form}
            layout="vertical"
            className="live-editor-form"
            initialValues={defaultValues()}
          >
            <section className="live-editor-section">
              <Title level={5}>基本信息</Title>
              <Form.Item label="直播名称" name="title" rules={[{ required: true, message: "请输入直播名称" }]}>
                <Input maxLength={100} placeholder="例如：酱香酒客户沟通公开课" />
              </Form.Item>
              <div className="live-editor-two">
                <Form.Item label="主讲人" name="lecturer">
                  <Input maxLength={50} placeholder="讲师姓名" />
                </Form.Item>
                <Form.Item label="开始时间" name="start_time">
                  <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
                </Form.Item>
              </div>
              <div className="live-editor-two">
                <Form.Item label="预计时长（分钟）" name="duration_minutes">
                  <InputNumber min={1} max={1440} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="状态" name="status">
                  <Select options={STATUS_OPTIONS.filter((item) => item.value)} />
                </Form.Item>
              </div>
              <Form.Item label="直播简介" name="intro">
                <Input.TextArea rows={3} maxLength={200} showCount placeholder="用于公开页和分享卡片摘要" />
              </Form.Item>
            </section>

            <section className="live-editor-section">
              <Title level={5}>视频内容</Title>
              <Form.Item label="内容类型" name="content_type" extra="当前阶段先按录播活动发布，直播流能力暂不开放。">
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="recorded">录播视频</Radio.Button>
                  <Radio.Button value="live_stream" disabled>直播流</Radio.Button>
                </Radio.Group>
              </Form.Item>

              {contentType === "live_stream" ? (
                <Form.Item label="直播流地址" name="stream_url" rules={[{ required: true, message: "请输入直播流地址" }]}>
                  <Input placeholder="https:// 或 rtmp/http-flv/hls 播放地址" />
                </Form.Item>
              ) : (
                <>
                  <Form.Item label="视频来源" name="video_source">
                    <Radio.Group optionType="button">
                      <Radio.Button value="upload">现上传</Radio.Button>
                      <Radio.Button value="material">素材库</Radio.Button>
                      <Radio.Button value="external_url">外部链接</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                  {videoSource === "external_url" ? (
                    <Form.Item label="外部视频地址" name="video_url" rules={[{ required: true, message: "请输入视频地址" }]}>
                      <Input placeholder="https://example.com/video.mp4" />
                    </Form.Item>
                  ) : (
                    <Space wrap>
                      <Upload accept="video/*" beforeUpload={selectVideoFile} showUploadList={false}>
                        <Button icon={<UploadOutlined />}>选择本地视频</Button>
                      </Upload>
                      <Button icon={<VideoCameraOutlined />} onClick={() => setPicker("video")}>从素材库选择</Button>
                      {currentVideoName ? <Tag color="blue">{currentVideoName} · {formatSize(values?.video_file_size)}</Tag> : <Text type="secondary">还未选择视频</Text>}
                    </Space>
                  )}
                  <Form.Item name="video_material_asset_id" hidden><Input /></Form.Item>
                  <Form.Item name="video_object_key" hidden><Input /></Form.Item>
                  <Form.Item name="video_file_name" hidden><Input /></Form.Item>
                  <Form.Item name="video_file_size" hidden><InputNumber /></Form.Item>
                  <Form.Item name="video_mime_type" hidden><Input /></Form.Item>
                  <Form.Item name="duration_seconds" hidden><InputNumber /></Form.Item>
                </>
              )}
              {uploadProgress > 0 ? <Progress percent={uploadProgress} size="small" /> : null}
            </section>

            <section className="live-editor-section">
              <Title level={5}>封面与详情</Title>
              <div className="live-image-row">
                <div className="live-image-preview">
                  {coverPreview || values?.cover_url ? <img src={coverPreview || values.cover_url} alt="" /> : <UploadOutlined />}
                </div>
                <Space direction="vertical">
                  <Space wrap>
                    <Upload accept="image/*" beforeUpload={uploadImage("cover")} showUploadList={false}>
                      <Button icon={<UploadOutlined />}>上传封面</Button>
                    </Upload>
                    <Button onClick={() => setPicker("cover")}>从素材库选择</Button>
                  </Space>
                  <Text type="secondary">建议 16:9 图片，用作公开页首屏封面。</Text>
                </Space>
              </div>
              <Form.Item name="cover_url" hidden><Input /></Form.Item>
              <Form.Item name="cover_object_key" hidden><Input /></Form.Item>
              <Form.Item name="cover_material_asset_id" hidden><Input /></Form.Item>
              <Form.Item label="直播详情" name="detail_html">
                <Input.TextArea rows={6} placeholder="可填写课程介绍、适合人群、观看提示等内容。" />
              </Form.Item>
            </section>

            <section className="live-editor-section">
              <Title level={5}>分享卡片</Title>
              <Form.Item label="分享标题" name="share_title">
                <Input maxLength={100} placeholder="默认使用直播名称" />
              </Form.Item>
              <Form.Item label="分享描述" name="share_desc">
                <Input.TextArea rows={2} maxLength={200} showCount placeholder="默认使用直播简介" />
              </Form.Item>
              <div className="live-image-row">
                <div className="live-image-preview live-image-preview--small">
                  {sharePreview || values?.share_image_url || coverPreview ? <img src={sharePreview || values.share_image_url || coverPreview} alt="" /> : <LinkOutlined />}
                </div>
                <Space wrap>
                  <Upload accept="image/*" beforeUpload={uploadImage("share")} showUploadList={false}>
                    <Button icon={<UploadOutlined />}>上传分享图</Button>
                  </Upload>
                  <Button onClick={() => setPicker("share")}>从素材库选择</Button>
                </Space>
              </div>
              <Form.Item name="share_image_url" hidden><Input /></Form.Item>
              <Form.Item name="share_image_object_key" hidden><Input /></Form.Item>
              <Form.Item name="share_image_material_asset_id" hidden><Input /></Form.Item>
            </section>

            <section className="live-editor-section">
              <Title level={5}>互动设置</Title>
              <div className="live-switch-row">
                <Form.Item label="允许点赞" name="allow_like" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item label="允许评论" name="allow_comment" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item label="显示数据" name="show_counters" valuePropName="checked"><Switch /></Form.Item>
              </div>
            </section>
          </Form>

          <aside className="live-editor-preview">
            <Title level={5}>分享预览</Title>
            <LiveCardPreview values={values} coverPreview={coverPreview} sharePreview={sharePreview} />
            <div className="live-phone-preview">
              <div className="live-phone-preview__media">
                {coverPreview || values?.cover_url ? <img src={coverPreview || values.cover_url} alt="" /> : <PlayCircleOutlined />}
              </div>
              <div className="live-phone-preview__body">
                <Text strong>{values?.title || "直播活动标题"}</Text>
                <Text type="secondary">{values?.lecturer || "怀仁商学院"}</Text>
                <Paragraph className="live-phone-preview__intro" ellipsis={{ rows: 2 }}>{values?.intro || "活动简介会展示在公开视频页首屏。"}</Paragraph>
              </div>
            </div>
          </aside>
        </div>
      </SpinLike>

      <MaterialAssetPickerModal
        open={!!picker}
        onCancel={() => setPicker(null)}
        onPick={pickAsset}
        title={picker === "video" ? "选择录播视频" : "选择图片素材"}
        assetType={pickerAssetType}
        pickButtonText="使用"
      />
    </div>
  );
}

function SpinLike({ loading, children }) {
  if (!loading) return children;
  return <div className="live-admin-loading">加载中...</div>;
}

export default function LiveAdminPage() {
  return (
    <Routes>
      <Route index element={<LiveRoomList />} />
      <Route path="create" element={<LiveRoomEditor />} />
      <Route path=":id/edit" element={<LiveRoomEditor />} />
      <Route path="*" element={<Navigate to="/admin/live" replace />} />
    </Routes>
  );
}
