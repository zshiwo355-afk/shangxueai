import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
  VideoCameraOutlined,
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
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tree,
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
  moveMaterialAsset,
  moveMaterialProject,
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
  if (type === "video") return { label: "视频", color: "blue", icon: <VideoCameraOutlined /> };
  if (type === "image") return { label: "图片", color: "green", icon: <FileImageOutlined /> };
  if (type === "document") return { label: "文档", color: "gold", icon: <FileTextOutlined /> };
  return { label: "其他", color: "default", icon: <FileOutlined /> };
}

function buildFolderLookup(projects) {
  const map = new Map();
  (Array.isArray(projects) ? projects : []).forEach((item) => map.set(Number(item.id), item));
  return map;
}

function buildPathIds(projectId, projectMap) {
  if (!projectId || !projectMap.has(Number(projectId))) return [];
  const path = [];
  let current = projectMap.get(Number(projectId)) || null;
  const visited = new Set();
  while (current) {
    const currentId = Number(current.id);
    if (visited.has(currentId)) break;
    visited.add(currentId);
    path.push(currentId);
    current = current.parent_id ? projectMap.get(Number(current.parent_id)) || null : null;
  }
  return path.reverse();
}

function buildFolderTree({ folders, folderMap, selectedFolderId, assets, visibleFolderIds }) {
  const childrenMap = new Map();
  folders.forEach((item) => {
    const parentKey = item.parent_id == null ? "root" : Number(item.parent_id);
    const current = childrenMap.get(parentKey) || [];
    current.push(item);
    childrenMap.set(parentKey, current);
  });
  childrenMap.forEach((items) => items.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id)));

  const buildNodes = (parentId = null) => {
    const key = parentId == null ? "root" : Number(parentId);
    const items = childrenMap.get(key) || [];
    return items
      .filter((item) => !visibleFolderIds || visibleFolderIds.has(Number(item.id)))
      .map((item) => {
        const childFolderNodes = buildNodes(item.id);
        const assetNodes = Number(selectedFolderId) === Number(item.id)
          ? (assets || []).map((asset) => {
            const meta = assetTypeMeta(asset.asset_type);
            return {
              key: `asset-${asset.id}`,
              title: asset.name,
              icon: meta.icon,
              isLeaf: true,
              draggable: true,
              nodeType: "asset",
              asset,
            };
          })
          : [];
        return {
          key: `folder-${item.id}`,
          title: (
            <Space size={8}>
              <span>{item.name}</span>
              <Tag bordered={false}>{item.asset_count || 0}</Tag>
            </Space>
          ),
          icon: Number(selectedFolderId) === Number(item.id) ? <FolderOpenOutlined /> : <FolderOutlined />,
          children: [...childFolderNodes, ...assetNodes],
          folder: item,
          nodeType: "folder",
          draggable: true,
        };
      });
  };

  return buildNodes(null);
}

function collectVisibleFolderIds(folders, keyword) {
  const text = String(keyword || "").trim().toLowerCase();
  if (!text) return null;
  const folderMap = buildFolderLookup(folders);
  const visible = new Set();
  folders.forEach((item) => {
    const matched = [item.name, item.description, item.oss_prefix]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text));
    if (!matched) return;
    let current = item;
    while (current) {
      visible.add(Number(current.id));
      current = current.parent_id ? folderMap.get(Number(current.parent_id)) || null : null;
    }
  });
  return visible;
}

export default function MaterialLibraryPage() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState([]);
  const [projectKeyword, setProjectKeyword] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [expandedKeys, setExpandedKeys] = useState([]);
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

  const folderMap = useMemo(() => buildFolderLookup(projects), [projects]);
  const visibleFolderIds = useMemo(() => collectVisibleFolderIds(projects, projectKeyword), [projects, projectKeyword]);
  const selectedProject = useMemo(
    () => (selectedProjectId ? folderMap.get(Number(selectedProjectId)) || null : null),
    [folderMap, selectedProjectId],
  );
  const selectedPathIds = useMemo(
    () => buildPathIds(selectedProjectId, folderMap),
    [folderMap, selectedProjectId],
  );

  // 当前选中变化时，把它的祖先路径并入已展开集合（手动收起的兄弟节点不会被强制撑开）
  useEffect(() => {
    if (!selectedPathIds.length) return;
    const pathKeys = selectedPathIds.map((id) => `folder-${id}`);
    setExpandedKeys((prev) => {
      const set = new Set(prev);
      let changed = false;
      pathKeys.forEach((k) => {
        if (!set.has(k)) {
          set.add(k);
          changed = true;
        }
      });
      return changed ? Array.from(set) : prev;
    });
  }, [selectedPathIds]);

  const reloadProjects = async () => {
    const data = await listMaterialProjects("");
    const nextProjects = Array.isArray(data) ? data : [];
    setProjects(nextProjects);
    if (!selectedProjectId && nextProjects[0]?.id) {
      setSelectedProjectId(nextProjects[0].id);
      return;
    }
    if (selectedProjectId && !nextProjects.some((item) => Number(item.id) === Number(selectedProjectId))) {
      setSelectedProjectId(nextProjects[0]?.id || null);
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
      message.error(error?.message || "素材文件夹加载失败。");
    });
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reloadAssets().catch((error) => {
      message.error(error?.message || "素材文件加载失败。");
    });
  }, [assetKeyword, assetType, message, selectedProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动刷新：1) 标签页切回时立刻拉一次；2) 当前页可见时每 30 秒后台拉一次。
  useEffect(() => {
    const refreshAll = () => {
      reloadProjects().catch(() => {});
      reloadAssets().catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    window.addEventListener("focus", refreshAll);
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAll();
    }, 30000);
    return () => {
      window.removeEventListener("focus", refreshAll);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(intervalId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const manualRefresh = async () => {
    try {
      await Promise.all([reloadProjects(), reloadAssets()]);
      message.success("已刷新。");
    } catch (error) {
      message.error(error?.message || "刷新失败。");
    }
  };

  const openCreateProject = () => {
    setProjectEditing(null);
    projectForm.resetFields();
    projectForm.setFieldsValue({
      name: "",
      description: "",
      oss_prefix: "",
      visibility: "admin",
      parent_id: selectedProjectId || null,
    });
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
        parent_id: detail.parent_id ?? null,
      });
      setProjectModalOpen(true);
    } catch (error) {
      message.error(error?.message || "素材文件夹详情加载失败。");
    }
  };

  const submitProject = async () => {
    try {
      const values = await projectForm.validateFields();
      const payload = {
        name: values.name,
        description: values.description || "",
        oss_prefix: values.oss_prefix || "",
        visibility: values.visibility || "admin",
        parent_id: values.parent_id || null,
      };
      if (projectEditing?.id) {
        await updateMaterialProject(projectEditing.id, payload);
        message.success("文件夹已更新。");
      } else {
        await createMaterialProject(payload);
        message.success("文件夹已创建。");
      }
      setProjectModalOpen(false);
      setProjectEditing(null);
      await reloadProjects();
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "文件夹保存失败。");
      }
    }
  };

  const handleDeleteProject = async (projectId) => {
    try {
      await deleteMaterialProject(projectId);
      message.success("文件夹已删除。");
      await reloadProjects();
    } catch (error) {
      message.error(error?.message || "删除文件夹失败。");
    }
  };

  const openUploadAsset = () => {
    if (!selectedProjectId) {
      message.warning("请先选择一个文件夹。");
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

  const handleTreeDrop = async (info) => {
    if (info.dropToGap) {
      message.info("请把文件或文件夹拖到目标文件夹上。");
      return;
    }
    const dragKey = String(info.dragNode.key || "");
    const dropKey = String(info.node.key || "");
    if (!dropKey.startsWith("folder-")) {
      message.warning("只能拖到文件夹上。");
      return;
    }
    const targetFolderId = Number(dropKey.replace("folder-", ""));
    try {
      if (dragKey.startsWith("asset-")) {
        const assetId = Number(dragKey.replace("asset-", ""));
        await moveMaterialAsset(assetId, { project_id: targetFolderId });
        message.success("素材已移动。");
      } else if (dragKey.startsWith("folder-")) {
        const folderId = Number(dragKey.replace("folder-", ""));
        if (folderId === targetFolderId) return;
        await moveMaterialProject(folderId, { parent_id: targetFolderId });
        message.success("文件夹已移动。");
      }
      await reloadProjects();
      await reloadAssets();
      setSelectedProjectId(targetFolderId);
    } catch (error) {
      message.error(error?.message || "拖动移动失败。");
    }
  };

  const treeData = useMemo(
    () => buildFolderTree({
      folders: projects,
      folderMap,
      selectedFolderId: selectedProjectId,
      assets,
      visibleFolderIds,
    }),
    [assets, folderMap, projects, selectedProjectId, visibleFolderIds],
  );

  const assetColumns = [
    {
      title: "名称",
      dataIndex: "name",
      render: (_, row) => {
        const meta = assetTypeMeta(row.asset_type);
        return (
          <Space>
            {meta.icon}
            <Text strong>{row.name}</Text>
          </Space>
        );
      },
    },
    {
      title: "类型",
      dataIndex: "asset_type",
      width: 100,
      render: (value) => {
        const meta = assetTypeMeta(value);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: "原文件名", dataIndex: "file_name", width: 240 },
    { title: "大小", dataIndex: "file_size", width: 120, render: (value) => formatFileSize(value) },
    { title: "标签", dataIndex: "tags", render: (value) => value || "—" },
    { title: "备注", dataIndex: "remark", render: (value) => value || "—" },
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
          <Popconfirm title="删除该素材？" onConfirm={() => handleDeleteAsset(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ background: "transparent", minHeight: 680, gap: 16 }}>
      <Sider width={320} theme="light" style={{ background: "transparent" }}>
        <Card
          title="素材文件夹"
          extra={(
            <Space size={6}>
              <Button size="small" icon={<ReloadOutlined />} onClick={manualRefresh}>刷新</Button>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreateProject}>新建文件夹</Button>
            </Space>
          )}
          styles={{ body: { padding: 14 } }}
        >
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Input.Search
              placeholder="搜索文件夹"
              value={projectKeyword}
              onChange={(e) => setProjectKeyword(e.target.value)}
              allowClear
            />
            {treeData.length ? (
              <Tree
                blockNode
                showIcon
                draggable
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys.map(String))}
                selectedKeys={selectedProjectId ? [`folder-${selectedProjectId}`] : []}
                treeData={treeData}
                onSelect={(keys, info) => {
                  if (!keys?.length) return;
                  const key = String(keys[0]);
                  if (key.startsWith("folder-")) {
                    setSelectedProjectId(Number(key.replace("folder-", "")));
                    return;
                  }
                  if (key.startsWith("asset-")) {
                    setPreviewState({ open: true, asset: info.node.asset });
                  }
                }}
                onDrop={handleTreeDrop}
              />
            ) : (
              <Empty description={projectKeyword ? "没有匹配的文件夹" : "还没有素材文件夹"} />
            )}
          </Space>
        </Card>
      </Sider>

      <Content>
        <Card styles={{ body: { padding: 18 } }}>
          {selectedProject ? (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                <Space direction="vertical" size={4}>
                  <Title level={4} style={{ margin: 0 }}>{selectedProject.name}</Title>
                  <Text type="secondary">{selectedProject.description || "当前文件夹暂无描述"}</Text>
                  <Text type="secondary">当前路径：{(selectedProject.path_names || [selectedProject.name]).join(" / ")}</Text>
                  <Text type="secondary">OSS 路径：{selectedProject.oss_prefix || "自动生成"}</Text>
                </Space>
                <Space wrap>
                  <Button icon={<EditOutlined />} onClick={() => openEditProject(selectedProject.id)}>编辑文件夹</Button>
                  <Popconfirm title="删除该文件夹？" onConfirm={() => handleDeleteProject(selectedProject.id)}>
                    <Button danger icon={<DeleteOutlined />}>删除文件夹</Button>
                  </Popconfirm>
                  <Button icon={<PlusOutlined />} onClick={openCreateProject}>新增子文件夹</Button>
                  <Button type="primary" icon={<UploadOutlined />} onClick={openUploadAsset}>上传素材</Button>
                </Space>
              </Space>

              <Space wrap>
                <Input.Search
                  style={{ width: 260 }}
                  placeholder="搜索文件名 / 标签 / 备注"
                  value={assetKeyword}
                  onChange={(e) => setAssetKeyword(e.target.value)}
                  onSearch={setAssetKeyword}
                  allowClear
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

              <Table
                rowKey="id"
                dataSource={assets}
                columns={assetColumns}
                pagination={{ pageSize: 12 }}
                locale={{ emptyText: "当前文件夹下还没有素材" }}
              />
            </Space>
          ) : (
            <Empty description="请先创建并选择一个素材文件夹" />
          )}
        </Card>
      </Content>

      <Modal
        open={projectModalOpen}
        title={projectEditing ? "编辑文件夹" : "新建文件夹"}
        onCancel={() => setProjectModalOpen(false)}
        onOk={submitProject}
        destroyOnHidden
      >
        <Form form={projectForm} layout="vertical" preserve={false}>
          <Form.Item label="文件夹名称" name="name" rules={[{ required: true, message: "请输入文件夹名称" }]}>
            <Input placeholder="例如：课程封面 / 视频素材 / 文档" />
          </Form.Item>
          <Form.Item label="上级文件夹" name="parent_id">
            <Select
              allowClear
              placeholder="根目录"
              options={projects
                .filter((item) => !projectEditing || Number(item.id) !== Number(projectEditing.id))
                .map((item) => ({
                  value: item.id,
                  label: (item.path_names || [item.name]).join(" / "),
                }))}
            />
          </Form.Item>
          <Form.Item label="文件夹描述" name="description">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
          <Form.Item label="OSS 存储路径" name="oss_prefix">
            <Input placeholder="例如：materials/course-assets" />
          </Form.Item>
          <Form.Item label="可见性" name="visibility">
            <Select
              options={[
                { value: "private", label: "仅自己 / 超级管理员" },
                { value: "admin", label: "管理员可见" },
                { value: "shared", label: "共享文件夹" },
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
            <Input placeholder="例如：新产品宣传海报" />
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
