import { CloudUploadOutlined, FolderOpenOutlined, SearchOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Avatar,
  Button,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Upload,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  adminCreateMentor,
  adminGetMentor,
  adminImportMentorAvatarFromMaterial,
  adminSearchMentorCandidates,
  adminUpdateMentor,
  adminUploadMentorAvatar,
} from "../../../lib/api.mentors";
import MaterialImagePicker from "../banners/MaterialImagePicker";
import MentorRecommendationsList from "./MentorRecommendationsList";

const SOURCE_KEEP = "keep";
const SOURCE_UPLOAD = "uploaded";
const SOURCE_MATERIAL = "material";

export default function MentorEditDrawer({ mode, mentorId, onClose, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const isEdit = mode === "edit";
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [mentor, setMentor] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarObjectKey, setAvatarObjectKey] = useState("");
  const [avatarMaterialId, setAvatarMaterialId] = useState(null);
  const [imageSource, setImageSource] = useState(SOURCE_UPLOAD);
  const initialAvatarRef = useRef({ url: "", object_key: "", material_id: null });

  // 候选用户
  const [userKeyword, setUserKeyword] = useState("");
  const [userOptions, setUserOptions] = useState([]);
  const [userSearching, setUserSearching] = useState(false);
  const userSearchTimer = useRef(null);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    adminGetMentor(mentorId)
      .then((data) => {
        setMentor(data);
        setAvatarUrl(data.avatar_url || "");
        setAvatarObjectKey(data.avatar_object_key || "");
        setAvatarMaterialId(data.avatar_material_id || null);
        setImageSource(SOURCE_KEEP);
        initialAvatarRef.current = {
          url: data.avatar_url || "",
          object_key: data.avatar_object_key || "",
          material_id: data.avatar_material_id || null,
        };
        form.setFieldsValue({
          user_id: data.user_id,
          display_name: data.display_name,
          title: data.title,
          tagline: data.tagline,
          bio: data.bio || "",
          expertise_tags: data.expertise_tags,
          years_experience: data.years_experience,
          contact_wecom: data.contact_wecom,
          sort_order: data.sort_order,
          enabled: data.enabled,
          featured: data.featured,
        });
      })
      .catch((err) => message.error(err?.message || "加载失败。"))
      .finally(() => setLoading(false));
  }, [isEdit, mentorId, form, message]);

  const triggerUserSearch = (value) => {
    setUserKeyword(value);
    if (userSearchTimer.current) clearTimeout(userSearchTimer.current);
    userSearchTimer.current = setTimeout(() => {
      setUserSearching(true);
      adminSearchMentorCandidates(value)
        .then((list) => setUserOptions(Array.isArray(list) ? list : []))
        .catch(() => {})
        .finally(() => setUserSearching(false));
    }, 300);
  };

  useEffect(() => {
    if (isEdit) return;
    triggerUserSearch("");
    return () => { if (userSearchTimer.current) clearTimeout(userSearchTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  const handleSelectUser = (uid) => {
    const opt = userOptions.find((o) => Number(o.id) === Number(uid));
    if (opt) {
      // 默认填充展示名
      const cur = form.getFieldValue("display_name");
      if (!cur) form.setFieldsValue({ display_name: opt.display_name });
    }
  };

  const handleUpload = async (file) => {
    if (file.size > 10 * 1024 * 1024) {
      message.warning("图片不能超过 10MB。");
      return false;
    }
    setUploading(true);
    try {
      const res = await adminUploadMentorAvatar(mentorId || 0, file);
      setAvatarUrl(res.url || "");
      setAvatarObjectKey(res.object_key || "");
      setAvatarMaterialId(null);
      setImageSource(SOURCE_UPLOAD);
      message.success("头像上传成功。");
    } catch (err) {
      message.error(err?.message || "上传失败。");
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handlePickFromMaterial = async (picked) => {
    try {
      const res = await adminImportMentorAvatarFromMaterial(mentorId || 0, picked.id);
      setAvatarUrl(res.url || "");
      setAvatarObjectKey(res.object_key || "");
      setAvatarMaterialId(Number(res.material_asset_id || picked.id));
      setImageSource(SOURCE_MATERIAL);
      setPickerOpen(false);
      message.success("已选用素材库头像。");
    } catch (err) {
      message.error(err?.message || "导入失败。");
    }
  };

  const submit = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSubmitting(true);
    try {
      if (!isEdit) {
        const created = await adminCreateMentor({
          user_id: Number(values.user_id),
          display_name: values.display_name.trim(),
          title: values.title || "",
          tagline: values.tagline || "",
          bio: values.bio || "",
          expertise_tags: values.expertise_tags || "",
          years_experience: Number(values.years_experience || 0),
          contact_wecom: values.contact_wecom || "",
          sort_order: Number(values.sort_order || 0),
          enabled: !!values.enabled,
          featured: !!values.featured,
          avatar_url: avatarUrl,
          avatar_object_key: avatarObjectKey,
          avatar_material_id: avatarMaterialId,
        });
        message.success(`已创建：${created.display_name}`);
      } else {
        const payload = {
          display_name: values.display_name.trim(),
          title: values.title || "",
          tagline: values.tagline || "",
          bio: values.bio || "",
          expertise_tags: values.expertise_tags || "",
          years_experience: Number(values.years_experience || 0),
          contact_wecom: values.contact_wecom || "",
          sort_order: Number(values.sort_order || 0),
          enabled: !!values.enabled,
          featured: !!values.featured,
        };
        const avatarChanged =
          avatarUrl !== initialAvatarRef.current.url
          || avatarObjectKey !== initialAvatarRef.current.object_key
          || avatarMaterialId !== initialAvatarRef.current.material_id;
        if (avatarChanged) {
          payload.avatar_url = avatarUrl;
          payload.avatar_object_key = avatarObjectKey;
          payload.avatar_material_id = avatarMaterialId;
        }
        await adminUpdateMentor(mentorId, payload);
        message.success("已更新。");
      }
      onSaved();
    } catch (err) {
      message.error(err?.message || "保存失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const sourceTagText = useMemo(() => {
    if (imageSource === SOURCE_MATERIAL) return "素材库";
    if (imageSource === SOURCE_KEEP) return mentor?.avatar_material_id ? "素材库" : "上传";
    return "新上传";
  }, [imageSource, mentor]);

  const sourceTagColor = useMemo(() => {
    if (imageSource === SOURCE_MATERIAL) return "purple";
    if (imageSource === SOURCE_KEEP) return mentor?.avatar_material_id ? "purple" : "blue";
    return "blue";
  }, [imageSource, mentor]);

  return (
    <>
      <Drawer
        open
        title={isEdit ? `编辑导师 #${mentorId}` : "新增导师"}
        width={720}
        onClose={onClose}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={submitting} onClick={submit}>保存</Button>
          </Space>
        }
      >
        <Spin spinning={loading}>
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              enabled: true,
              featured: false,
              years_experience: 0,
              sort_order: 100,
            }}
            preserve={false}
          >
            {!isEdit ? (
              <Form.Item
                label="选择用户"
                name="user_id"
                rules={[{ required: true, message: "请选择关联用户" }]}
                extra="导师身份与用户角色解耦，不影响其登录权限。"
              >
                <Select
                  showSearch
                  placeholder="按姓名 / 工号 / 部门搜索"
                  filterOption={false}
                  onSearch={triggerUserSearch}
                  onChange={handleSelectUser}
                  notFoundContent={userSearching ? <Spin size="small" /> : "暂无候选用户"}
                  options={userOptions.map((u) => ({
                    label: `${u.display_name} · ${u.department || "无部门"} · ${u.position || ""} ${u.already_mentor ? "（已是导师）" : ""}`,
                    value: u.id,
                    disabled: u.already_mentor,
                  }))}
                  suffixIcon={<SearchOutlined />}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            ) : (
              <Form.Item label="关联用户">
                <Tag>#{mentor?.user_id}</Tag>
                <span style={{ marginLeft: 8 }}>
                  {mentor?.user_label || "—"}
                  {mentor?.user_department ? `（${mentor.user_department}）` : ""}
                </span>
              </Form.Item>
            )}

            <Form.Item label="头像">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div style={{ position: "relative", display: "inline-block" }}>
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt="头像预览"
                      width={120}
                      height={120}
                      style={{ objectFit: "cover", borderRadius: "50%", border: "1px solid #f0f0f0" }}
                      preview={{ src: avatarUrl }}
                    />
                  ) : (
                    <Avatar size={120} style={{ background: "#1677ff", fontSize: 32 }}>
                      {(form.getFieldValue("display_name") || "导").slice(0, 1).toUpperCase()}
                    </Avatar>
                  )}
                  {avatarUrl ? (
                    <Tag color={sourceTagColor} style={{ position: "absolute", bottom: 0, right: 0 }}>
                      {sourceTagText}
                    </Tag>
                  ) : null}
                </div>
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
                      accept=".jpg,.jpeg,.png,.webp"
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

            <Form.Item label="展示名" name="display_name" rules={[{ required: true, message: "请输入" }]}>
              <Input maxLength={128} placeholder="例如：王老师" />
            </Form.Item>
            <Form.Item label="头衔" name="title">
              <Input maxLength={128} placeholder="例如：金牌讲师 / 销售总监" />
            </Form.Item>
            <Form.Item label="一句话签名" name="tagline">
              <Input maxLength={255} placeholder="一句鼓励学员的话" />
            </Form.Item>
            <Form.Item label="长简介" name="bio">
              <Input.TextArea rows={5} maxLength={2000} showCount placeholder="多段说明，按段落换行" />
            </Form.Item>
            <Form.Item label="专长标签（逗号分隔）" name="expertise_tags">
              <Input maxLength={500} placeholder="成交话术,异议处理,谈判" />
            </Form.Item>
            <Form.Item label="从业年限" name="years_experience">
              <InputNumber style={{ width: "100%" }} min={0} max={80} />
            </Form.Item>
            <Form.Item label="企业微信联系方式" name="contact_wecom">
              <Input maxLength={128} placeholder="可选，用户端可显示" />
            </Form.Item>
            <Form.Item label="排序（升序）" name="sort_order">
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item label="启用（在用户端展示）" name="enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="首页推荐位" name="featured" valuePropName="checked" extra={'开启后会出现在用户端首页"推荐导师"区块'}>
              <Switch />
            </Form.Item>
          </Form>

          {isEdit ? (
            <MentorRecommendationsList mentorId={mentorId} />
          ) : (
            <div style={{ marginTop: 16, padding: 12, background: "#f6f8fb", borderRadius: 8, color: "var(--text-mute)", fontSize: 13 }}>
              保存后可在编辑页面继续添加"推荐课程 / 读物 / 试卷 / 外链"。
            </div>
          )}
        </Spin>
      </Drawer>

      <MaterialImagePicker
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onConfirm={handlePickFromMaterial}
      />
    </>
  );
}
