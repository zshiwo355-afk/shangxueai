import {
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  SearchOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Input, List, Modal, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { buildMaterialAssetPreviewUrl, listAllMaterialAssets } from "../../lib/api.materials";

const { Text } = Typography;

const TYPE_META = {
  video: { label: "视频", color: "blue", icon: <VideoCameraOutlined /> },
  image: { label: "图片", color: "green", icon: <FileImageOutlined /> },
  document: { label: "文档", color: "gold", icon: <FileTextOutlined /> },
  other: { label: "其他", color: "default", icon: <FileOutlined /> },
};

function metaFor(type) {
  return TYPE_META[type] || TYPE_META.other;
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function getExtension(name) {
  const text = String(name || "");
  const dot = text.lastIndexOf(".");
  if (dot < 0) return "";
  return text.slice(dot + 1).toLowerCase();
}

/**
 * Fetch a material library asset and return it as a real File object that
 * can be appended to FormData / passed to existing upload code paths. This
 * lets us reuse the material library across different upload UIs without
 * touching the backend upload endpoints.
 *
 * Note: we deliberately do NOT pass `credentials: "include"`. The backend
 * preview endpoint authenticates via the `access_token` query param baked
 * into the URL, and it 307-redirects to a presigned OSS URL whose
 * signature is also in the querystring. Including credentials on the
 * cross-origin OSS hop would force the browser to reject OSS's wildcard
 * `Access-Control-Allow-Origin: *` per CORS spec.
 */
export async function fetchMaterialAssetAsFile(asset) {
  if (!asset?.id) throw new Error("素材数据无效。");
  const url = buildMaterialAssetPreviewUrl(asset.id, { download: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载素材失败 (HTTP ${response.status})`);
  }
  const blob = await response.blob();
  const name = asset.file_name || asset.name || `asset-${asset.id}`;
  const type = blob.type || asset.mime_type || "application/octet-stream";
  return new File([blob], name, { type });
}

/**
 * Generic picker that lets the user search the material library and pick a
 * single asset. The caller decides what to do with it via `onPick`.
 */
export default function MaterialAssetPickerModal({
  open,
  onCancel,
  onPick,
  title = "从素材库选择",
  assetType,
  acceptExtensions,
  hint,
  pickButtonText = "选择",
}) {
  const { message } = AntdApp.useApp();
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState([]);
  const [picking, setPicking] = useState(null);

  // 输入 debounce：用户停止输入 250ms 后再发请求，避免每个按键都打到后端
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const acceptSet = useMemo(() => {
    if (!acceptExtensions || !acceptExtensions.length) return null;
    return new Set(acceptExtensions.map((item) => String(item).replace(/^\./, "").toLowerCase()));
  }, [acceptExtensions]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    listAllMaterialAssets({ keyword: debouncedKeyword, asset_type: assetType || undefined, page: 1, page_size: 24 }) // CODEX_MODIFIED
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
            ? data.items
            : [];
        const filtered = acceptSet
          ? list.filter((item) => acceptSet.has(getExtension(item.file_name) || getExtension(item.name)))
          : list;
        setAssets(filtered);
      })
      .catch((error) => {
        if (!alive) return;
        message.error(error?.message || "素材加载失败。");
        setAssets([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, debouncedKeyword, assetType, acceptSet, message]);

  useEffect(() => {
    if (!open) {
      setKeyword("");
      setDebouncedKeyword("");
      setPicking(null);
    }
  }, [open]);

  const handlePick = async (asset) => {
    if (!asset?.id) return;
    setPicking(asset.id);
    try {
      await onPick(asset);
    } catch (error) {
      message.error(error?.message || "选择素材失败。");
    } finally {
      setPicking(null);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      footer={null}
      width={720}
      destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {hint ? <Text type="secondary">{hint}</Text> : null}
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索素材名称 / 原文件名 / 标签"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div style={{ maxHeight: 460, overflowY: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
              <Spin />
            </div>
          ) : assets.length ? (
            <List
              dataSource={assets}
              size="small"
              renderItem={(asset) => {
                const meta = metaFor(asset.asset_type);
                const ext = getExtension(asset.file_name) || getExtension(asset.name);
                return (
                  <List.Item
                    actions={[
                      <Button
                        key="pick"
                        type="primary"
                        size="small"
                        loading={picking === asset.id}
                        onClick={() => handlePick(asset)}
                      >
                        {pickButtonText}
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={meta.icon}
                      title={(
                        <Space size={6} wrap>
                          <Text strong>{asset.name || asset.file_name}</Text>
                          <Tag color={meta.color}>{meta.label}</Tag>
                          {ext ? <Tag>{ext.toUpperCase()}</Tag> : null}
                        </Space>
                      )}
                      description={(
                        <Space size={10} wrap style={{ color: "#64748b" }}>
                          <span>{asset.file_name}</span>
                          <span>{formatSize(asset.file_size)}</span>
                          <span>{asset.project_name || "—"}</span>
                        </Space>
                      )}
                    />
                  </List.Item>
                );
              }}
            />
          ) : (
            <Empty description={keyword ? "没有匹配的素材" : "素材库暂无可选文件"} />
          )}
        </div>
      </Space>
    </Modal>
  );
}
