import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  adminCreateBanner,
  adminDeleteBanner,
  adminImportBannerFromMaterial,
  adminListBanners,
  adminUpdateBanner,
  adminUploadBannerImage,
} from "../../../lib/api.banners";
import MaterialImagePicker from "./MaterialImagePicker";

/**
 * 一条轮播图记录的图片来源候选：
 *   - "uploaded"     管理员从本地上传，image_url + image_object_key 自带
 *   - "material"     从素材库导入，复用素材 OSS key（删除时不清理）
 *   - "keep"         编辑模式下保留原图（默认）
 */
const SOURCE_KEEP = "keep";
const SOURCE_UPLOAD = "uploaded";
const SOURCE_MATERIAL = "material";

function emptyDraft() {
  return {
    title: "",
    link_url: "",
    sort_order: 0,
    enabled: true,
    remark: "",
    image_url: "",
    image_object_key: "",
    material_asset_id: null,
  };
}

export default function BannersTab() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | { mode: "create" | "edit", banner?: object }

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListBanners();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (banner) => {
    try {
      await adminDeleteBanner(banner.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const toggleEnabled = async (banner, enabled) => {
    try {
      await adminUpdateBanner(banner.id, { enabled });
      setItems((list) => list.map((item) => (item.id === banner.id ? { ...item, enabled } : item)));
    } catch (err) {
      message.error(err?.message || "更新失败。");
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 80 },
    {
      title: "缩略图",
      dataIndex: "image_url",
      width: 140,
      render: (value, row) => value ? (
        <Image
          src={value}
          alt={row.title || "轮播图"}
          width={120}
          height={60}
          style={{ objectFit: "cover", borderRadius: 6, border: "1px solid #f0f0f0", cursor: "zoom-in" }}
          preview={{ src: value, mask: "点击放大" }}
        />
      ) : "—",
    },
    { title: "标题", dataIndex: "title", render: (value) => value || "—" },
    {
      title: "跳转链接",
      dataIndex: "link_url",
      ellipsis: true,
      render: (value) => value
        ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a>
        : <span style={{ color: "var(--text-mute)" }}>—</span>,
    },
    {
      title: "来源",
      dataIndex: "material_asset_id",
      width: 100,
      render: (value) => value
        ? <Tag color="purple">素材库</Tag>
        : <Tag color="blue">上传</Tag>,
    },
    { title: "排序", dataIndex: "sort_order", width: 80 },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 100,
      render: (v, row) => <Switch checked={!!v} onChange={(checked) => toggleEnabled(row, checked)} />,
    },
    {
      title: "操作",
      key: "action",
      width: 200,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ mode: "edit", banner: row })}>编辑</Button>
          <Popconfirm title="确认删除该轮播图？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--text-mute)" }}>共 {items.length} 张</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mode: "create" })}>新增轮播图</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={false} />

      {editing ? (
        <BannerEditModal
          key={editing.mode === "edit" ? `edit-${editing.banner.id}` : "create"}
          editing={editing}
          existingCount={items.length}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function BannerEditModal({ editing, existingCount, onCancel, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const isEdit = editing.mode === "edit";
  const banner = editing.banner;

  const initialValues = useMemo(() => {
    if (!isEdit) {
      return {
        ...emptyDraft(),
        sort_order: (existingCount + 1) * 10,
      };
    }
    return {
      title: banner.title || "",
      link_url: banner.link_url || "",
      sort_order: banner.sort_order || 0,
      enabled: !!banner.enabled,
      remark: banner.remark || "",
      image_url: banner.image_url || "",
      image_object_key: banner.image_object_key || "",
      material_asset_id: banner.material_asset_id || null,
    };
  }, [editing, existingCount, isEdit, banner]);

  const [imageSource, setImageSource] = useState(isEdit ? SOURCE_KEEP : SOURCE_UPLOAD);
  const [previewUrl, setPreviewUrl] = useState(isEdit ? (banner.image_url || "") : "");
  const [imageObjectKey, setImageObjectKey] = useState(isEdit ? (banner.image_object_key || "") : "");
  const [materialAssetId, setMaterialAssetId] = useState(isEdit ? (banner.material_asset_id || null) : null);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const initialImageRef = useRef({
    url: isEdit ? (banner.image_url || "") : "",
    object_key: isEdit ? (banner.image_object_key || "") : "",
    material_asset_id: isEdit ? (banner.material_asset_id || null) : null,
  });

  const handleUpload = async (file) => {
    if (file.size > 10 * 1024 * 1024) {
      message.warning("图片不能超过 10MB。");
      return false;
    }
    try {
      setUploading(true);
      const result = await adminUploadBannerImage(file);
      setPreviewUrl(result.url || "");
      setImageObjectKey(result.object_key || "");
      setMaterialAssetId(null);
      setImageSource(SOURCE_UPLOAD);
      message.success("图片上传成功。");
    } catch (err) {
      message.error(err?.message || "上传失败。");
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handlePickFromMaterial = async (picked) => {
    try {
      const result = await adminImportBannerFromMaterial(picked.id);
      setPreviewUrl(result.url || "");
      setImageObjectKey(result.object_key || "");
      setMaterialAssetId(Number(result.material_asset_id || picked.id));
      setImageSource(SOURCE_MATERIAL);
      setPickerOpen(false);
      message.success("已选用素材库图片。");
    } catch (err) {
      message.error(err?.message || "导入失败。");
    }
  };

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!previewUrl) {
      message.warning("请先上传或选择一张图片。");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        const payload = {
          title: values.title || "",
          link_url: values.link_url || "",
          sort_order: Number(values.sort_order || 0),
          enabled: !!values.enabled,
          remark: values.remark || "",
        };
        // 仅当用户实际换图时才提交图片字段，避免误清理 OSS。
        const imageChanged =
          previewUrl !== initialImageRef.current.url
          || imageObjectKey !== initialImageRef.current.object_key
          || materialAssetId !== initialImageRef.current.material_asset_id;
        if (imageChanged) {
          payload.image_url = previewUrl;
          payload.image_object_key = imageObjectKey;
          payload.material_asset_id = materialAssetId;
        }
        await adminUpdateBanner(banner.id, payload);
        message.success("已更新。");
      } else {
        await adminCreateBanner({
          title: values.title || "",
          link_url: values.link_url || "",
          sort_order: Number(values.sort_order || 0),
          enabled: !!values.enabled,
          remark: values.remark || "",
          image_url: previewUrl,
          image_object_key: imageObjectKey,
          material_asset_id: materialAssetId,
        });
        message.success("已创建。");
      }
      onSaved();
    } catch (err) {
      message.error(err?.message || "保存失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const sourceTag = isEdit && imageSource === SOURCE_KEEP
    ? (banner.material_asset_id ? "素材库" : "上传")
    : (imageSource === SOURCE_MATERIAL ? "素材库" : "新上传");

  return (
    <>
      <Modal
        open
        title={isEdit ? "编辑轮播图" : "新增轮播图"}
        onCancel={onCancel}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        width={620}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={initialValues}>
          <Form.Item label="图片" required>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {previewUrl ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <Image
                    src={previewUrl}
                    alt="轮播图预览"
                    style={{
                      width: 280,
                      height: 140,
                      objectFit: "cover",
                      borderRadius: 8,
                      border: "1px solid #f0f0f0",
                    }}
                    preview={{ src: previewUrl }}
                  />
                  <Tag color={imageSource === SOURCE_MATERIAL || (imageSource === SOURCE_KEEP && banner?.material_asset_id) ? "purple" : "blue"} style={{ position: "absolute", top: 8, left: 8 }}>
                    {sourceTag}
                  </Tag>
                </div>
              ) : (
                <div
                  style={{
                    width: 280,
                    height: 140,
                    borderRadius: 8,
                    border: "1px dashed #d9d9d9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-mute)",
                    background: "#fafafa",
                  }}
                >
                  暂无图片
                </div>
              )}
              <Radio.Group
                value={imageSource === SOURCE_KEEP ? SOURCE_UPLOAD : imageSource}
                onChange={(e) => setImageSource(e.target.value)}
              >
                <Radio.Button value={SOURCE_UPLOAD}>本地上传</Radio.Button>
                <Radio.Button value={SOURCE_MATERIAL}>素材库导入</Radio.Button>
              </Radio.Group>
              <Space wrap>
                {imageSource === SOURCE_UPLOAD ? (
                  <Upload
                    showUploadList={false}
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    beforeUpload={handleUpload}
                    disabled={uploading}
                  >
                    <Button icon={<CloudUploadOutlined />} loading={uploading}>选择本地图片</Button>
                  </Upload>
                ) : null}
                {imageSource === SOURCE_MATERIAL ? (
                  <Button icon={<FolderOpenOutlined />} onClick={() => setPickerOpen(true)}>从素材库选择</Button>
                ) : null}
                <span style={{ color: "var(--text-mute)", fontSize: 12 }}>支持 JPG / PNG / WEBP，最大 10MB。</span>
              </Space>
            </Space>
          </Form.Item>

          <Form.Item label="标题（可选）" name="title">
            <Input placeholder="例如：开学季优惠" maxLength={120} />
          </Form.Item>
          <Form.Item label="跳转链接（可选）" name="link_url">
            <Input placeholder="https://... 留空表示不跳转" maxLength={500} />
          </Form.Item>
          <Form.Item label="排序（升序）" name="sort_order">
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="备注（可选）" name="remark">
            <Input.TextArea rows={2} maxLength={500} placeholder="后台备注，仅管理员可见" />
          </Form.Item>
        </Form>
      </Modal>

      <MaterialImagePicker
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onConfirm={handlePickFromMaterial}
      />
    </>
  );
}
