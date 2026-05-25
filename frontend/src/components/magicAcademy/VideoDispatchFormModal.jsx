import { FolderOpenOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Progress,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
  Upload,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { listAllMaterialAssets } from "../../lib/api.materials";
import MaterialAssetPickerModal from "../common/MaterialAssetPickerModal";
import {
  buildVideoDispatchFormValues,
  buildVideoTargetsFromDispatch,
  formatFileSize,
  targetsToOptions,
} from "./magicAcademyShared";

const { Text } = Typography;

export default function VideoDispatchFormModal({ open, onCancel, onSubmit, editing, users, submitting, uploadProgress }) {
  const [form] = Form.useForm();
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadMeta, setUploadMeta] = useState(null);
  const [materialAssets, setMaterialAssets] = useState([]);
  const [materialKeyword, setMaterialKeyword] = useState("");
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const { message } = AntdApp.useApp();
  const optionSource = useMemo(() => targetsToOptions(users), [users]);
  const employeeUsers = useMemo(() => users.filter((item) => item.role === "user"), [users]);
  const userOptions = useMemo(
    () => employeeUsers.map((item) => ({
      value: String(item.id),
      label: `${item.real_name || item.display_name || item.username} (${item.username})`,
    })),
    [employeeUsers],
  );
  const departmentOptions = useMemo(
    () => optionSource.departments.map((item) => ({ value: item, label: item })),
    [optionSource.departments],
  );
  const positionOptions = useMemo(
    () => optionSource.positions.map((item) => ({ value: item, label: item })),
    [optionSource.positions],
  );
  const videoSource = Form.useWatch("video_source", form) || "upload";
  const materialAssetId = Form.useWatch("material_asset_id", form);
  const dispatchMode = Form.useWatch("dispatch_mode", form) || "user";
  const targetUserIds = Form.useWatch("target_user_ids", form);
  const targetDepartmentIds = Form.useWatch("target_department_ids", form);
  const targetPositions = Form.useWatch("target_positions", form);
  const newcomerOnly = Form.useWatch("newcomer_only", form);
  const selectedMaterialAsset = useMemo(
    () => materialAssets.find((item) => item.id === materialAssetId) || null,
    [materialAssets, materialAssetId],
  );
  const resolvedTargetCount = useMemo(() => {
    if (dispatchMode === "department") {
      const values = new Set(targetDepartmentIds || []);
      return employeeUsers.filter((item) => values.has(item.department)).length;
    }
    if (dispatchMode === "position") {
      const values = new Set(targetPositions || []);
      return employeeUsers.filter((item) => values.has(item.position)).length;
    }
    if (dispatchMode === "all") {
      return employeeUsers.filter((item) => (newcomerOnly ? item.is_newcomer : true)).length;
    }
    return Array.isArray(targetUserIds) ? targetUserIds.length : 0;
  }, [dispatchMode, employeeUsers, newcomerOnly, targetDepartmentIds, targetPositions, targetUserIds]);

  const fillVideoForm = () => {
    const dispatchValues = buildVideoDispatchFormValues(editing?.targets);
    if (!editing) {
      form.resetFields();
      form.setFieldsValue({
        title: "",
        description: "",
        category: "",
        is_required: false,
        is_newcomer_required: false,
        duration_seconds: undefined,
        status: "draft",
        video_source: "upload",
        material_asset_id: undefined,
        ...dispatchValues,
      });
      setUploadMeta(null);
      setSelectedFile(null);
      return;
    }
    form.resetFields();
    form.setFieldsValue({
      title: editing?.title || "",
      description: editing?.description || "",
      category: editing?.category || "",
      is_required: !!editing?.is_required,
      is_newcomer_required: !!editing?.is_newcomer_required,
      duration_seconds: editing?.duration_seconds || editing?.duration || undefined,
      status: editing?.status || "draft",
      video_source: "upload",
      material_asset_id: editing?.material_asset_id || undefined,
      ...dispatchValues,
    });
    setUploadMeta({
      file_name: editing.file_name,
      file_path: editing.file_path,
      mime_type: editing.mime_type,
      file_size: editing.file_size,
      duration_seconds: editing.duration_seconds || 0,
      original_filename: editing.original_filename || editing.file_name,
    });
    setSelectedFile(null);
  };

  useEffect(() => {
    if (!open || editing || videoSource !== "material") return;
    const timer = window.setTimeout(() => {
      listAllMaterialAssets({ asset_type: "video", keyword: materialKeyword })
        .then((data) => setMaterialAssets(Array.isArray(data) ? data : []))
        .catch((error) => message.error(error?.message || "素材库视频加载失败。"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [editing, materialKeyword, message, open, videoSource]);

  useEffect(() => {
    if (!open || editing) return;
    if (videoSource === "upload") {
      form.setFieldValue("material_asset_id", undefined);
      return;
    }
    setSelectedFile(null);
    if (selectedMaterialAsset) {
      if (!String(form.getFieldValue("title") || "").trim()) {
        form.setFieldValue("title", selectedMaterialAsset.name || selectedMaterialAsset.file_name || "");
      }
      if (!form.getFieldValue("duration_seconds") && Number(selectedMaterialAsset.duration_seconds || 0) > 0) {
        form.setFieldValue("duration_seconds", Number(selectedMaterialAsset.duration_seconds || 0));
      }
    }
  }, [editing, form, open, selectedMaterialAsset, videoSource]);

  const handleOk = async () => {
    const values = await form.validateFields();
    if (!editing?.id && values.video_source === "upload" && !selectedFile) {
      message.error("请先上传视频文件。");
      return;
    }
    if (!editing?.id && values.video_source === "material" && !values.material_asset_id) {
      message.error("请选择素材库视频。");
      return;
    }
    await onSubmit({
      title: values.title,
      description: values.description || "",
      category: values.category || "",
      video_source: values.video_source || "upload",
      material_asset_id: values.material_asset_id || null,
      file_name: uploadMeta?.file_name,
      file_path: uploadMeta?.file_path,
      mime_type: selectedFile?.type || uploadMeta?.mime_type,
      file_size: selectedFile?.size || uploadMeta?.file_size || 0,
      duration_seconds: Number(values.duration_seconds || uploadMeta?.duration_seconds || 0),
      is_required: !!values.is_required,
      is_newcomer_required: !!values.is_newcomer_required,
      status: values.status,
      targets: buildVideoTargetsFromDispatch(values),
      original_filename: selectedFile?.name || uploadMeta?.original_filename || uploadMeta?.file_name,
      selected_file: selectedFile,
    });
  };

  return (
    <Modal
      open={open}
      title={editing ? "编辑视频" : "新建视频"}
      onCancel={onCancel}
      onOk={handleOk}
      width={860}
      okText={submitting ? `上传中 ${uploadProgress}%` : "保存"}
      okButtonProps={{ disabled: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      confirmLoading={submitting}
      afterOpenChange={(nextOpen) => {
        if (nextOpen) fillVideoForm();
      }}
      destroyOnHidden={false}
      forceRender
    >
      <Form form={form} layout="vertical">
        <Form.Item label="视频标题" name="title" rules={[{ required: true, message: "请输入视频标题" }]}>
          <Input placeholder="例如：新人必看 - 品牌介绍" />
        </Form.Item>
        <Form.Item label="视频简介" name="description">
          <Input.TextArea rows={3} placeholder="选填" />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item label="视频分类" name="category" style={{ minWidth: 220 }}>
            <Input placeholder="例如：新人培训" />
          </Form.Item>
          <Form.Item label="状态" name="status" style={{ minWidth: 220 }}>
            <Select options={[{ value: "draft", label: "草稿" }, { value: "published", label: "已发布" }, { value: "disabled", label: "停用" }]} />
          </Form.Item>
        </Space>
        {!editing ? (
          <Form.Item label="视频来源" name="video_source">
            <Radio.Group
              options={[
                { value: "upload", label: "上传新视频" },
                { value: "material", label: "从素材库选择" },
              ]}
            />
          </Form.Item>
        ) : null}
        {editing || videoSource === "upload" ? (
          <Form.Item label="视频文件">
            <Upload
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                setSelectedFile(file);
                setUploadMeta({
                  file_name: file.name,
                  original_filename: file.name,
                  mime_type: file.type || "video/mp4",
                  file_size: file.size,
                  duration_seconds: Number(form.getFieldValue("duration_seconds") || 0),
                });
                return false;
              }}
              accept=".mp4,.mov,.webm,.m4v,video/mp4,video/quicktime,video/webm"
              disabled={submitting}
            >
              <Button icon={<UploadOutlined />} loading={submitting}>
                {editing
                  ? (selectedFile ? `已选择新视频：${selectedFile.name}` : "重新上传并覆盖")
                  : (selectedFile ? `已选择视频：${selectedFile.name}` : "选择视频文件")}
              </Button>
            </Upload>
            <Space direction="vertical" size={4} style={{ marginTop: 8, color: "var(--text-mute)" }}>
              <Text type="secondary">
                {uploadMeta
                  ? `${editing ? "当前文件" : "文件名"}：${uploadMeta.original_filename || uploadMeta.file_name}`
                  : "尚未选择文件"}
              </Text>
              {uploadMeta ? <Text type="secondary">文件大小：{formatFileSize(uploadMeta.file_size)}</Text> : null}
              {uploadMeta ? <Text type="secondary">文件类型：{uploadMeta.mime_type || "未知"}</Text> : null}
              {submitting ? <Progress percent={uploadProgress} size="small" /> : null}
            </Space>
          </Form.Item>
        ) : (
          <Card size="small" title="从素材库选择视频">
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<FolderOpenOutlined />}
                  onClick={() => setMaterialPickerOpen(true)}
                >
                  打开素材库搜索
                </Button>
                <Input.Search
                  style={{ minWidth: 220 }}
                  placeholder="或在下拉里直接搜索"
                  value={materialKeyword}
                  onChange={(e) => setMaterialKeyword(e.target.value)}
                  onSearch={setMaterialKeyword}
                />
              </Space>
              <Form.Item
                label="选择视频素材"
                name="material_asset_id"
                rules={[{ required: true, message: "请选择素材库视频" }]}
                style={{ marginBottom: 0 }}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择素材库中的视频素材"
                  options={materialAssets.map((item) => ({
                    value: item.id,
                    label: `${item.name} / ${item.project_name || "未分组"}`,
                  }))}
                />
              </Form.Item>
              {selectedMaterialAsset ? (
                <Space direction="vertical" size={4}>
                  <Text type="secondary">已选素材：{selectedMaterialAsset.name}</Text>
                  <Text type="secondary">原文件名：{selectedMaterialAsset.file_name}</Text>
                  <Text type="secondary">所属文件夹：{selectedMaterialAsset.project_name || "—"}</Text>
                  <Text type="secondary">文件大小：{formatFileSize(selectedMaterialAsset.file_size || 0)}</Text>
                  <Text type="secondary">上传时间：{selectedMaterialAsset.created_at?.replace("T", " ").slice(0, 19) || "—"}</Text>
                </Space>
              ) : null}
            </Space>
          </Card>
        )}
        <Space size={24}>
          <Form.Item label="是否必修" name="is_required" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="是否新人默认必修" name="is_newcomer_required" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <Card size="small" title="派发范围">
          <Form.Item label="派发维度" name="dispatch_mode">
            <Radio.Group
              options={[
                { value: "user", label: "指定员工" },
                { value: "department", label: "按部门" },
                { value: "position", label: "按岗位" },
                { value: "all", label: "全员" },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          {dispatchMode === "user" ? (
            <Form.Item label="员工" name="target_user_ids" rules={[{ required: true, message: "请选择至少一个员工" }]}>
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={userOptions}
                placeholder="选择员工"
                maxTagCount="responsive"
              />
            </Form.Item>
          ) : null}
          {dispatchMode === "department" ? (
            <Form.Item label="部门" name="target_department_ids" rules={[{ required: true, message: "请选择至少一个部门" }]}>
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={departmentOptions}
                placeholder={departmentOptions.length ? "选择部门" : "当前暂无可选部门"}
                disabled={!departmentOptions.length}
                maxTagCount="responsive"
              />
            </Form.Item>
          ) : null}
          {dispatchMode === "position" ? (
            <Form.Item label="岗位" name="target_positions" rules={[{ required: true, message: "请选择至少一个岗位" }]}>
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={positionOptions}
                placeholder={positionOptions.length ? "选择岗位" : "当前暂无可选岗位"}
                disabled={!positionOptions.length}
                maxTagCount="responsive"
              />
            </Form.Item>
          ) : null}
          {dispatchMode === "all" ? (
            <Form.Item
              label="范围"
              name="newcomer_only"
              getValueProps={(value) => ({ value: value ? "newcomer" : "all" })}
              normalize={(value) => value === "newcomer"}
            >
              <Radio.Group
                options={[
                  { value: "all", label: "全部员工" },
                  { value: "newcomer", label: "仅新人" },
                ]}
                optionType="button"
              />
            </Form.Item>
          ) : null}
          <Alert
            type={resolvedTargetCount ? "info" : "warning"}
            showIcon
            message={resolvedTargetCount ? `当前将命中 ${resolvedTargetCount} 位员工` : "当前尚未命中任何员工"}
          />
        </Card>
      </Form>

      <MaterialAssetPickerModal
        open={materialPickerOpen}
        onCancel={() => setMaterialPickerOpen(false)}
        onPick={(asset) => {
          setMaterialAssets((prev) => {
            const exists = prev.some((item) => Number(item.id) === Number(asset.id));
            return exists ? prev : [asset, ...prev];
          });
          form.setFieldValue("material_asset_id", asset.id);
          if (!String(form.getFieldValue("title") || "").trim()) {
            form.setFieldValue("title", asset.name || asset.file_name || "");
          }
          if (!form.getFieldValue("duration_seconds") && Number(asset.duration_seconds || 0) > 0) {
            form.setFieldValue("duration_seconds", Number(asset.duration_seconds || 0));
          }
          setMaterialPickerOpen(false);
        }}
        title="从素材库选择视频"
        assetType="video"
        hint="仅展示素材库中的视频文件，可按名称 / 文件名搜索。"
        pickButtonText="使用此视频"
      />
    </Modal>
  );
}
