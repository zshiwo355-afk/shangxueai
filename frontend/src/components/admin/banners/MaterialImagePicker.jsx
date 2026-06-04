import { Empty, Image, Input, Modal, Pagination, Segmented, Spin, App as AntdApp } from "antd";
import { useEffect, useMemo, useState } from "react";

import {
  buildMaterialAssetPreviewUrl,
  listAllMaterialAssets,
  listMaterialAssets,
  listMaterialProjects,
} from "../../../lib/api.materials";

const PAGE_SIZE = 12;

/**
 * 从素材库挑一张图片素材。仅展示 asset_type === "image" 的素材。
 * 选中后调用 onConfirm({ id, name, file_name, preview_url })，
 * 调用方再决定是入库还是仅作预览。
 */
export default function MaterialImagePicker({ open, onCancel, onConfirm }) {
  const { message } = AntdApp.useApp();
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState("__all__");
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [folderLoading, setFolderLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setKeyword("");
    setPage(1);
    setFolderId("__all__");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFolderLoading(true);
    listMaterialProjects("")
      .then((data) => {
        if (cancelled) return;
        setFolders(Array.isArray(data) ? data : []);
      })
      .catch((err) => message.error(err?.message || "素材文件夹加载失败。"))
      .finally(() => {
        if (!cancelled) setFolderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, message]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const params = {
      keyword: keyword || undefined,
      asset_type: "image",
      page,
      page_size: PAGE_SIZE,
    };
    const promise = folderId === "__all__"
      ? listAllMaterialAssets(params)
      : listMaterialAssets(folderId, params);
    promise
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
        setAssets(items);
        setTotal(Number(data?.total ?? items.length ?? 0));
      })
      .catch((err) => message.error(err?.message || "素材加载失败。"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, folderId, keyword, page, message]);

  const folderOptions = useMemo(() => {
    const list = [{ label: "全部素材", value: "__all__" }];
    folders.forEach((item) => {
      list.push({
        label: (item.path_names || [item.name]).join(" / ") || item.name,
        value: item.id,
      });
    });
    return list;
  }, [folders]);

  const selected = useMemo(
    () => assets.find((item) => Number(item.id) === Number(selectedId)) || null,
    [assets, selectedId],
  );

  const handleConfirm = () => {
    if (!selected) {
      message.warning("请先选择一张图片。");
      return;
    }
    onConfirm?.({
      id: Number(selected.id),
      name: selected.name || selected.file_name || "",
      file_name: selected.file_name || "",
      preview_url: buildMaterialAssetPreviewUrl(selected.id),
    });
  };

  return (
    <Modal
      open={open}
      title="从素材库选择图片"
      width={920}
      onCancel={onCancel}
      onOk={handleConfirm}
      okText="确定使用"
      cancelText="取消"
      okButtonProps={{ disabled: !selected }}
      destroyOnHidden
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Input.Search
            placeholder="搜索素材名 / 标签 / 备注"
            allowClear
            style={{ width: 280 }}
            onSearch={(value) => {
              setKeyword(value || "");
              setPage(1);
            }}
          />
          <Spin spinning={folderLoading} size="small">
            <Segmented
              options={folderOptions.slice(0, 8).map((item) => ({
                label: item.label,
                value: item.value,
              }))}
              value={folderId}
              onChange={(value) => {
                setFolderId(value);
                setPage(1);
              }}
            />
          </Spin>
        </div>

        <Spin spinning={loading}>
          {assets.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 12,
                maxHeight: 480,
                overflowY: "auto",
                padding: 4,
              }}
            >
              {assets.map((item) => {
                const active = Number(selectedId) === Number(item.id);
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(item.id);
                      }
                    }}
                    style={{
                      border: active ? "2px solid #1677ff" : "1px solid #f0f0f0",
                      borderRadius: 10,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "#fafafa",
                      boxShadow: active ? "0 4px 12px rgba(22,119,255,0.18)" : "none",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div style={{ aspectRatio: "16/10", overflow: "hidden", background: "#000" }}>
                      <img
                        src={buildMaterialAssetPreviewUrl(item.id)}
                        alt={item.name || item.file_name || "素材图"}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    </div>
                    <div
                      style={{
                        padding: "6px 10px",
                        fontSize: 12,
                        color: "#333",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={item.name || item.file_name}
                    >
                      {item.name || item.file_name || `素材#${item.id}`}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="还没有图片素材" />
          )}
        </Spin>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={total}
            showSizeChanger={false}
            onChange={(value) => setPage(value)}
          />
        </div>

        {selected ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", background: "#f6f8fb", borderRadius: 8 }}>
            <Image
              src={buildMaterialAssetPreviewUrl(selected.id)}
              alt={selected.name}
              width={80}
              height={48}
              style={{ objectFit: "cover", borderRadius: 6 }}
              preview={false}
            />
            <div style={{ fontSize: 13, color: "#333" }}>
              已选：<strong>{selected.name || selected.file_name}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
