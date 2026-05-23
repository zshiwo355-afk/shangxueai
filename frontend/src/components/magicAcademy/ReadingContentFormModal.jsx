import { UploadOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  DatePicker,
  Form,
  Image,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import { buildMaterialAssetPreviewUrl } from "../../lib/api.materials";

const { Text } = Typography;

export default function ReadingContentFormModal({
  open,
  mode,
  submitting,
  form,
  imageSource,
  editing,
  imageFile,
  setImageFile,
  imageKeyword,
  setImageKeyword,
  imageAssets,
  selectedAsset,
  employeeUsers,
  employeeDepartmentOptions,
  employeePositionOptions,
  onCancel,
  onOk,
}) {
  return (
    <Modal
      open={open}
      title={mode === "edit" ? "编辑读书内容" : "新增读书内容"}
      onCancel={onCancel}
      onOk={onOk}
      okText="保存"
      confirmLoading={submitting}
      width={760}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          reading_date: dayjs(),
          title: "",
          description: "",
          target_user_ids: [],
          target_department_ids: [],
          target_position_ids: [],
          dispatch_mode: "user",
          newcomer_only: false,
        }}
      >
        <Form.Item label="阅读日期" name="reading_date" rules={[{ required: true, message: "请选择阅读日期" }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
          <Input placeholder="例如：今日阅读：第一章" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea rows={3} placeholder="选填" />
        </Form.Item>
        <Form.Item label="图片来源" name="image_source">
          <Radio.Group
            options={[
              { value: "upload", label: "上传新图片" },
              { value: "material", label: "从素材库选择图片" },
            ]}
          />
        </Form.Item>
        <Form.Item label="派发维度" name="dispatch_mode" rules={[{ required: true, message: "请选择派发维度" }]}>
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
        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue }) => {
            const targetType = getFieldValue("dispatch_mode");
            if (targetType === "department") {
              return (
                <Form.Item label="推送部门" name="target_department_ids" rules={[{ required: true, message: "请选择至少一个部门" }]}>
                  <Select mode="multiple" options={employeeDepartmentOptions} placeholder="选择部门" />
                </Form.Item>
              );
            }
            if (targetType === "position") {
              return (
                <Form.Item label="推送岗位" name="target_position_ids" rules={[{ required: true, message: "请选择至少一个岗位" }]}>
                  <Select mode="multiple" options={employeePositionOptions} placeholder="选择岗位" />
                </Form.Item>
              );
            }
            if (targetType === "user") {
              return (
                <Form.Item label="推送员工" name="target_user_ids" rules={[{ required: true, message: "请选择至少一个员工" }]}>
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    options={employeeUsers.map((item) => ({
                      value: item.id,
                      label: `${item.real_name || item.display_name || item.username} (${item.username})`,
                    }))}
                    placeholder="选择员工"
                  />
                </Form.Item>
              );
            }
            return (
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
            );
          }}
        </Form.Item>
        {imageSource === "upload" ? (
          <Form.Item label="图片" required>
            <Upload
              maxCount={1}
              showUploadList={false}
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              beforeUpload={(file) => {
                setImageFile(file);
                form.setFieldValue("material_asset_id", undefined);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>
                {imageFile ? `已选择图片：${imageFile.name}` : "选择图片"}
              </Button>
            </Upload>
            <Space direction="vertical" size={6} style={{ marginTop: 8 }}>
              {editing?.image_url && !imageFile ? (
                <Image src={editing.image_url} alt={editing.title} width={120} />
              ) : null}
              <Text type="secondary">仅支持 jpg / jpeg / png / webp，文件不超过 10MB，图片会直接上传到 OSS。</Text>
            </Space>
          </Form.Item>
        ) : (
          <Card size="small" title="从素材库选择图片">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Input.Search
                placeholder="搜索图片素材名称 / 项目名"
                value={imageKeyword}
                onChange={(e) => setImageKeyword(e.target.value)}
                onSearch={setImageKeyword}
              />
              <Form.Item
                label="选择图片素材"
                name="material_asset_id"
                rules={[{ required: true, message: "请选择素材库图片" }]}
                style={{ marginBottom: 0 }}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择素材库中的图片素材"
                  options={imageAssets.map((item) => ({
                    value: item.id,
                    label: `${item.name} / ${item.project_name || "未分组"}`,
                  }))}
                />
              </Form.Item>
              {selectedAsset ? (
                <Space direction="vertical" size={6}>
                  <Image
                    src={buildMaterialAssetPreviewUrl(selectedAsset.id)}
                    alt={selectedAsset.name}
                    width={140}
                  />
                  <Text type="secondary">已选素材：{selectedAsset.name}</Text>
                  <Text type="secondary">原文件名：{selectedAsset.file_name}</Text>
                  <Text type="secondary">所属项目：{selectedAsset.project_name || "—"}</Text>
                </Space>
              ) : null}
            </Space>
          </Card>
        )}
      </Form>
    </Modal>
  );
}
