import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Form,
  Image,
  Input,
  Layout,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useEffect, useMemo, useState } from "react";

import {
  buildMaterialAssetPreviewUrl,
  createMaterialProject,
  deleteMaterialAsset,
  deleteMaterialProject,
  getMaterialAsset,
  getMaterialProject,
  listMaterialAssets,
  listMaterialProjects,
  updateMaterialAsset,
  updateMaterialProject,
  uploadMaterialAsset,
} from "../../lib/api.materials";

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function assetTypeMeta(type) {
  if (type === "video") return { label: "视频", color: "blue" };
  if (type === "image") return { label: "图片", color: "green" };
  if (type === "document") return { label: "文档", color: "gold" };
  return { label: "其他", color: "default" };
}

export default function MaterialLibraryPage() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState([]);
  const [projectKeyword, setProjectKeyword] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [assets, setAssets] = useState([]);
  const [assetKeyword, setAssetKeyword] = useState("");
  const [assetType, setAssetType] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectEditing, setProjectEditing] = useState(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [assetEditing, setAssetEditing] = useState(null);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [projectForm] = Form.useForm();
  const [assetForm] = Form.useForm();
  const [selectedUploadFile, setSelectedUploadFile] = useState(null);
  const [previewState, setPreviewState] = useState({ open: false, asset: null });

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const reloadProjects = async () => {
    const data = await listMaterialProjects(projectKeyword);
    setProjects(Array.isArray(data) ? data : []);
    if (!selectedProjectId && data?.[0]?.id) setSelectedProjectId(data[0].id);
    if (selectedProjectId && !data.some((item) => item.id === selectedProjectId)) {
      setSelectedProjectId(data[0]?.id || null);
    }
  };

  const reloadAssets = async (projectId = selectedProjectId) => {
    if (!projectId) {
      setAssets([]);
      return;
    }
    const data = await listMaterialAssets(projectId, {
      keyword: assetKeyword,
      asset_type: assetType || undefined,
    });
    setAssets(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    reloadProjects().catch((error) => {
      message.error(error?.message || "素材项目加载失败。");
    });
  }, [projectKeyword]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reloadAssets().catch((error) => {
      message.error(error?.message || "素材文件加载失败。");
    });
  }, [selectedProjectId, assetKeyword, assetType]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateProject = () => {
    setProjectEditing(null);
    projectForm.resetFields();
    projectForm.setFieldsValue({ name: "", description: "", oss_prefix: "", visibility: "admin" });
    setProjectModalOpen(true);
  };

  const openEditProject = async (projectId) => {
    try {
      const detail = await getMaterialProject(projectId);
      setProjectEditing(detail);
      projectForm.resetFields();
      projectForm.setFieldsValue({
        name: detail.name,
        description: detail.description,
        oss_prefix: detail.oss_prefix,
        visibility: detail.visibility || "admin",
      });
      setProjectModalOpen(true);
    } catch (error) {
      message.error(error?.message || "素材项目详情加载失败。");
    }
  };

  const submitProject = async () => {
    try {
      const values = await projectForm.validateFields();
      if (projectEditing?.id) {
        await updateMaterialProject(projectEditing.id, values);
        message.success("素材项目已更新。");
      } else {
        await createMaterialProject(values);
        message.success("素材项目已创建。");
      }
      setProjectModalOpen(false);
      setProjectEditing(null);
      await reloadProjects();
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "素材项目保存失败。");
      }
    }
  };

  const handleDeleteProject = async (projectId) => {
    try {
      await deleteMaterialProject(projectId);
      message.success("素材项目已删除。");
      await reloadProjects();
    } catch (error) {
      message.error(error?.message || "删除素材项目失败。");
    }
  };

  const openUploadAsset = () => {
    if (!selectedProjectId) {
      message.warning("请先选择素材项目。");
      return;
    }
    setAssetEditing(null);
    setSelectedUploadFile(null);
    assetForm.resetFields();
    assetForm.setFieldsValue({ name: "", remark: "", tags: "" });
    setAssetModalOpen(true);
  };

  const openEditAsset = async (assetId) => {
    try {
      const detail = await getMaterialAsset(assetId);
      setAssetEditing(detail);
      assetForm.resetFields();
      assetForm.setFieldsValue({
        name: detail.name,
        remark: detail.remark,
        tags: detail.tags,
      });
      setSelectedUploadFile(null);
      setAssetModalOpen(true);
    } catch (error) {
      message.error(error?.message || "素材详情加载失败。");
    }
  };

  const submitAsset = async () => {
    try {
      const values = await assetForm.validateFields();
      if (assetEditing?.id) {
        await updateMaterialAsset(assetEditing.id, values);
        message.success("素材已更新。");
      } else {
        if (!selectedUploadFile) {
          message.warning("请先选择要上传的文件。");
          return;
        }
        setUploadingAsset(true);
        await uploadMaterialAsset(selectedProjectId, {
          ...values,
          file: selectedUploadFile,
        });
        message.success("素材已上传。");
      }
      setAssetModalOpen(false);
      setAssetEditing(null);
      setSelectedUploadFile(null);
      await reloadProjects();
      await reloadAssets();
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "素材保存失败。");
      }
    } finally {
      setUploadingAsset(false);
    }
  };

  const handleDeleteAsset = async (assetId) => {
    try {
      await deleteMaterialAsset(assetId);
      message.success("素材已删除。");
      await reloadProjects();
      await reloadAssets();
    } catch (error) {
      message.error(error?.message || "删除素材失败。");
    }
  };

  const assetColumns = [
    { title: "名称", dataIndex: "name" },
    {
      title: "类型",
      dataIndex: "asset_type",
      width: 100,
      render: (value) => {
        const meta = assetTypeMeta(value);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: "原文件名", dataIndex: "file_name", width: 220 },
    { title: "大小", dataIndex: "file_size", width: 120, render: (value) => formatFileSize(value) },
    { title: "标签", dataIndex: "tags", render: (value) => value || "—" },
    { title: "备注", dataIndex: "remark", render: (value) => value || "—" },
    { title: "OSS 路径", dataIndex: "object_key", ellipsis: true },
    {
      title: "操作",
      width: 220,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewState({ open: true, asset: row })}>
            预览
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditAsset(row.id)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该素材？" onConfirm={() => handleDeleteAsset(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ background: "transparent", minHeight: 640, gap: 16 }}>
      <Sider width={280} theme="light" style={{ background: "transparent" }}>
        <Card
          title="素材项目"
          extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreateProject}>新增项目</Button>}
        >
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Input.Search
              placeholder="搜索项目"
              value={projectKeyword}
              onChange={(e) => setProjectKeyword(e.target.value)}
              onSearch={setProjectKeyword}
            />
            <List
              dataSource={projects}
              locale={{ emptyText: "暂无素材项目" }}
              renderItem={(item) => (
                <List.Item
                  style={{
                    cursor: "pointer",
                    padding: 12,
                    borderRadius: 12,
                    background: selectedProjectId === item.id ? "rgba(0,0,0,0.04)" : "transparent",
                  }}
                  onClick={() => setSelectedProjectId(item.id)}
                  actions={[
                    <Button key="edit" type="link" size="small" onClick={(e) => { e.stopPropagation(); openEditProject(item.id); }}>编辑</Button>,
                    <Popconfirm key="del" title="删除该项目？" onConfirm={(e) => { e?.stopPropagation?.(); return handleDeleteProject(item.id); }}>
                      <Button size="small" danger type="link" onClick={(e) => e.stopPropagation()}>删除</Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<FolderOpenOutlined style={{ fontSize: 18 }} />}
                    title={<Space wrap><Text strong>{item.name}</Text><Tag>{item.asset_count}</Tag></Space>}
                    description={(
                      <Space direction="vertical" size={2}>
                        <Text type="secondary">{item.oss_prefix}</Text>
                        <Text type="secondary">{item.description || "—"}</Text>
                      </Space>
                    )}
                  />
                </List.Item>
              )}
            />
          </Space>
        </Card>
      </Sider>

      <Content>
        <Card>
          {selectedProject ? (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                <Space direction="vertical" size={4}>
                  <Title level={4} style={{ margin: 0 }}>{selectedProject.name}</Title>
                  <Text type="secondary">{selectedProject.description || "暂无描述"}</Text>
                  <Text type="secondary">OSS 路径：{selectedProject.oss_prefix}</Text>
                </Space>
                <Button type="primary" icon={<UploadOutlined />} onClick={openUploadAsset}>上传素材</Button>
              </Space>

              <Space wrap>
                <Input.Search
                  style={{ width: 240 }}
                  placeholder="搜索文件名/标签/备注"
                  value={assetKeyword}
                  onChange={(e) => setAssetKeyword(e.target.value)}
                  onSearch={setAssetKeyword}
                />
                <Select
                  allowClear
                  style={{ width: 160 }}
                  placeholder="按类型筛选"
                  value={assetType || undefined}
                  onChange={(value) => setAssetType(value || "")}
                  options={[
                    { value: "video", label: "视频" },
                    { value: "image", label: "图片" },
                    { value: "document", label: "文档" },
                    { value: "other", label: "其他" },
                  ]}
                />
              </Space>

              <Table rowKey="id" dataSource={assets} columns={assetColumns} pagination={{ pageSize: 10 }} />
            </Space>
          ) : (
            <Empty description="请先选择或创建素材项目" />
          )}
        </Card>
      </Content>

      <Modal
        open={projectModalOpen}
        title={projectEditing ? "编辑素材项目" : "新增素材项目"}
        onCancel={() => setProjectModalOpen(false)}
        onOk={submitProject}
        destroyOnHidden
      >
        <Form form={projectForm} layout="vertical" preserve={false}>
          <Form.Item label="项目名称" name="name" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="例如：新人入职" />
          </Form.Item>
          <Form.Item label="项目描述" name="description">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
          <Form.Item label="OSS 存储路径" name="oss_prefix">
            <Input placeholder="例如：materials/onboarding" />
          </Form.Item>
          <Form.Item label="可见性" name="visibility">
            <Select
              options={[
                { value: "private", label: "仅自己 / 超级管理员" },
                { value: "admin", label: "管理员可见" },
                { value: "shared", label: "共享项目" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={assetModalOpen}
        title={assetEditing ? "编辑素材" : "上传素材"}
        onCancel={() => {
          if (uploadingAsset) return;
          setAssetModalOpen(false);
          setAssetEditing(null);
          setSelectedUploadFile(null);
        }}
        onOk={submitAsset}
        confirmLoading={uploadingAsset}
        destroyOnHidden
      >
        <Form form={assetForm} layout="vertical" preserve={false}>
          <Form.Item label="素材名称" name="name" rules={[{ required: true, message: "请输入素材名称" }]}>
            <Input placeholder="例如：新品培训视频" />
          </Form.Item>
          {!assetEditing ? (
            <Form.Item label="选择文件" required>
              <Upload
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  setSelectedUploadFile(file);
                  if (!assetForm.getFieldValue("name")) {
                    assetForm.setFieldValue("name", file.name.replace(/\.[^.]+$/, ""));
                  }
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>
                  {selectedUploadFile ? `已选择：${selectedUploadFile.name}` : "选择文件"}
                </Button>
              </Upload>
            </Form.Item>
          ) : null}
          <Form.Item label="标签" name="tags">
            <Input placeholder="多个标签可用逗号分隔" />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={previewState.open}
        title={previewState.asset?.name || "素材预览"}
        footer={null}
        onCancel={() => setPreviewState({ open: false, asset: null })}
        width={860}
        destroyOnHidden
      >
        {previewState.asset ? (
          previewState.asset.asset_type === "image" ? (
            <Image src={buildMaterialAssetPreviewUrl(previewState.asset.id)} alt={previewState.asset.name} style={{ width: "100%" }} />
          ) : previewState.asset.asset_type === "video" ? (
            <video
              src={buildMaterialAssetPreviewUrl(previewState.asset.id)}
              controls
              style={{ width: "100%", borderRadius: 12, background: "#000" }}
            />
          ) : (
            <Space direction="vertical" size={12}>
              <Text>当前类型暂不支持在线预览。</Text>
              <Button type="primary" href={buildMaterialAssetPreviewUrl(previewState.asset.id)} target="_blank">
                打开 / 下载文件
              </Button>
            </Space>
          )
        ) : null}
      </Modal>
    </Layout>
  );
}
