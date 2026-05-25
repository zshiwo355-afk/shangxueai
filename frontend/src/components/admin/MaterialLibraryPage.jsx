import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tree,
  Typography,
  Upload,
} from "antd";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  buildMaterialAssetPreviewUrl,
  createMaterialProject,
  deleteMaterialAsset,
  deleteMaterialProject,
  getMaterialAsset,
  getMaterialProject,
  listAllMaterialAssets,
  listMaterialAssets,
  listMaterialProjects,
  moveMaterialAsset,
  moveMaterialProject,
  updateMaterialAsset,
  updateMaterialProject,
  uploadMaterialAsset,
} from "../../lib/api.materials";
import MaterialAssetPreview from "./MaterialAssetPreview";

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

const ALL_ASSETS_KEY = "__all__";

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

function buildFolderTree({ folders, selectedFolderId, visibleFolderIds }) {
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
        return {
          key: `folder-${item.id}`,
          title: (
            <span className="material-folder-tree__title">
              <span className="material-folder-tree__name">{item.name}</span>
              <span
                className={`material-folder-tree__count${Number(item.asset_count || 0) ? " is-active" : ""}`}
              >
                {item.asset_count || 0}
              </span>
            </span>
          ),
          icon: Number(selectedFolderId) === Number(item.id) ? <FolderOpenOutlined /> : <FolderOutlined />,
          children: childFolderNodes,
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
  const [selectedProjectId, setSelectedProjectId] = useState(ALL_ASSETS_KEY);
  const [expandedKeys, setExpandedKeys] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetTotal, setAssetTotal] = useState(0);
  const [assetPage, setAssetPage] = useState(1);
  const [assetPageSize, setAssetPageSize] = useState(12);
  const [folderLoading, setFolderLoading] = useState(true);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetKeyword, setAssetKeyword] = useState("");
  const [assetType, setAssetType] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectEditing, setProjectEditing] = useState(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [assetEditing, setAssetEditing] = useState(null);
  const [moveAssetState, setMoveAssetState] = useState({ open: false, asset: null });
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [projectForm] = Form.useForm();
  const [assetForm] = Form.useForm();
  const [moveAssetForm] = Form.useForm();
  const [selectedUploadFile, setSelectedUploadFile] = useState(null);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState(null);
  const [previewState, setPreviewState] = useState({ open: false, asset: null });
  const selectedProjectIdRef = useRef(ALL_ASSETS_KEY);
  const assetTypeRef = useRef("");
  const assetKeywordRef = useRef("");
  const assetPageRef = useRef(1);
  const assetPageSizeRef = useRef(12);
  const selectionInitializedRef = useRef(false);

  const isAllMode = selectedProjectId === ALL_ASSETS_KEY;
  const deferredProjectKeyword = useDeferredValue(projectKeyword);
  const deferredAssetKeyword = useDeferredValue(assetKeyword);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    assetTypeRef.current = assetType;
  }, [assetType]);

  useEffect(() => {
    assetKeywordRef.current = deferredAssetKeyword;
  }, [deferredAssetKeyword]);

  useEffect(() => {
    assetPageRef.current = assetPage;
  }, [assetPage]);

  useEffect(() => {
    assetPageSizeRef.current = assetPageSize;
  }, [assetPageSize]);

  const folderMap = useMemo(() => buildFolderLookup(projects), [projects]);
  const visibleFolderIds = useMemo(() => collectVisibleFolderIds(projects, deferredProjectKeyword), [projects, deferredProjectKeyword]);
  const selectedProject = useMemo(
    () => (selectedProjectId && !isAllMode ? folderMap.get(Number(selectedProjectId)) || null : null),
    [folderMap, isAllMode, selectedProjectId],
  );
  const selectedPathIds = useMemo(
    () => (isAllMode ? [] : buildPathIds(selectedProjectId, folderMap)),
    [folderMap, isAllMode, selectedProjectId],
  );
  const folderNameById = useMemo(() => {
    const map = new Map();
    (projects || []).forEach((item) => map.set(Number(item.id), item.name || ""));
    return map;
  }, [projects]);
  const folderOptions = useMemo(
    () => projects.map((item) => ({
      value: item.id,
      label: (item.path_names || [item.name]).join(" / "),
    })),
    [projects],
  );
  const totalAssetCount = useMemo(
    () => projects.reduce((sum, item) => sum + Number(item.asset_count || 0), 0),
    [projects],
  );
  const displayExpandedKeys = useMemo(() => {
    if (!visibleFolderIds) return expandedKeys;
    const next = new Set(expandedKeys);
    visibleFolderIds.forEach((id) => next.add(`folder-${id}`));
    return Array.from(next);
  }, [expandedKeys, visibleFolderIds]);

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

  const reloadProjects = async ({ silent = false } = {}) => {
    if (!silent) setFolderLoading(true);
    try {
      const data = await listMaterialProjects("");
      const nextProjects = Array.isArray(data) ? data : [];
      const currentSelectedProjectId = selectedProjectIdRef.current;
      setProjects(nextProjects);
      if (!selectionInitializedRef.current) {
        selectionInitializedRef.current = true;
        if (!currentSelectedProjectId) {
          startTransition(() => setSelectedProjectId(ALL_ASSETS_KEY));
        }
        return;
      }
      if (
        currentSelectedProjectId
        && currentSelectedProjectId !== ALL_ASSETS_KEY
        && !nextProjects.some((item) => Number(item.id) === Number(currentSelectedProjectId))
      ) {
        startTransition(() => setSelectedProjectId(ALL_ASSETS_KEY));
      }
    } finally {
      if (!silent) setFolderLoading(false);
    }
  };

  const reloadAssets = async (
    projectId = selectedProjectIdRef.current,
    {
      silent = false,
      keyword = assetKeywordRef.current,
      type = assetTypeRef.current,
      page = assetPageRef.current,
      pageSize = assetPageSizeRef.current,
    } = {},
  ) => {
    if (!silent) setAssetLoading(true);
    try {
      if (projectId === ALL_ASSETS_KEY) {
        const data = await listAllMaterialAssets({
          keyword,
          asset_type: type || undefined,
          page,
          page_size: pageSize,
        });
        setAssets(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
        setAssetTotal(Number(data?.total ?? (Array.isArray(data) ? data.length : 0)));
        return;
      }
      if (!projectId) {
        setAssets([]);
        setAssetTotal(0);
        return;
      }
      const data = await listMaterialAssets(projectId, {
        keyword,
        asset_type: type || undefined,
        page,
        page_size: pageSize,
      });
      setAssets(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
      setAssetTotal(Number(data?.total ?? (Array.isArray(data) ? data.length : 0)));
    } finally {
      if (!silent) setAssetLoading(false);
    }
  };

  useEffect(() => {
    reloadProjects().catch((error) => {
      message.error(error?.message || "素材文件夹加载失败。");
    });
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAssetPage(1);
  }, [assetType, deferredAssetKeyword, selectedProjectId]);

  useEffect(() => {
    reloadAssets().catch((error) => {
      message.error(error?.message || "素材文件加载失败。");
    });
  }, [assetPage, assetPageSize, assetType, deferredAssetKeyword, message, selectedProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动刷新：标签页切回 / 窗口聚焦时拉一次（去重 2 秒）；当前页可见时每 120 秒后台拉一次。
  useEffect(() => {
    let lastRefresh = 0;
    const REFRESH_DEBOUNCE_MS = 2000;
    const refreshAll = () => {
      const now = Date.now();
      if (now - lastRefresh < REFRESH_DEBOUNCE_MS) return;
      lastRefresh = now;
      reloadProjects({ silent: true }).catch(() => {});
      reloadAssets(undefined, { silent: true }).catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    // focus 与 visibilitychange 经常一起触发，refreshAll 内部已用时间戳去重，避免双发
    window.addEventListener("focus", refreshAll);
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAll();
    }, 120000);
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
      parent_id: isAllMode ? null : (selectedProjectId || null),
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
        oss_prefix: projectEditing?.oss_prefix || "",
        visibility: projectEditing?.visibility || "admin",
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
    // 乐观更新：本地立刻移除该文件夹（含其所有子孙）+ 选中切回"全部素材"，
    // 避免 Sider Spin 蒙层 + 选中文件夹消失导致的视觉跳动
    const targetId = Number(projectId);
    const prevProjects = projects;
    const prevSelected = selectedProjectId;
    const removed = new Set([targetId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of prevProjects) {
        const pid = Number(item.parent_id);
        if (removed.has(pid) && !removed.has(Number(item.id))) {
          removed.add(Number(item.id));
          grew = true;
        }
      }
    }
    setProjects((list) => list.filter((item) => !removed.has(Number(item.id))));
    if (removed.has(Number(prevSelected))) {
      setSelectedProjectId(ALL_ASSETS_KEY);
    }
    try {
      await deleteMaterialProject(projectId);
      message.success("文件夹已删除。");
      reloadProjects({ silent: true }).catch(() => {});
      reloadAssets(undefined, { silent: true }).catch(() => {});
    } catch (error) {
      // 失败回滚
      setProjects(prevProjects);
      setSelectedProjectId(prevSelected);
      message.error(error?.message || "删除文件夹失败。");
    }
  };

  const openUploadAsset = () => {
    if (!selectedProjectId || isAllMode) {
      message.warning("请先选择一个文件夹再上传素材。");
      return;
    }
    const targetId = Number(selectedProjectId);
    if (!folderMap.has(targetId)) {
      message.warning("当前文件夹不存在，请重新选择。");
      return;
    }
    setUploadTargetFolderId(targetId);
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

  const openMoveAsset = (asset) => {
    moveAssetForm.resetFields();
    moveAssetForm.setFieldsValue({ project_id: Number(asset.project_id) });
    setMoveAssetState({ open: true, asset });
  };

  const submitMoveAsset = async () => {
    try {
      const values = await moveAssetForm.validateFields();
      if (!moveAssetState.asset?.id) return;
      const targetProjectId = Number(values.project_id);
      if (targetProjectId === Number(moveAssetState.asset.project_id)) {
        setMoveAssetState({ open: false, asset: null });
        return;
      }
      await moveMaterialAsset(moveAssetState.asset.id, { project_id: targetProjectId });
      message.success("素材已移动。");
      setMoveAssetState({ open: false, asset: null });
      await reloadProjects();
      await reloadAssets();
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "移动素材失败。");
      }
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
        if (!uploadTargetFolderId) {
          message.warning("上传目标文件夹丢失，请重新选择文件夹后再试。");
          return;
        }
        setUploadingAsset(true);
        await uploadMaterialAsset(uploadTargetFolderId, {
          ...values,
          file: selectedUploadFile,
        });
        message.success("素材已上传。");
        // Make sure the user lands on the folder they just uploaded into,
        // even if they (or some background event) changed selection mid-flight.
        if (selectedProjectId !== uploadTargetFolderId) {
          setSelectedProjectId(uploadTargetFolderId);
        }
      }
      setAssetModalOpen(false);
      setAssetEditing(null);
      setSelectedUploadFile(null);
      setUploadTargetFolderId(null);
      await reloadProjects();
      await reloadAssets(uploadTargetFolderId || selectedProjectId);
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "素材保存失败。");
      }
    } finally {
      setUploadingAsset(false);
    }
  };

  const handleDeleteAsset = async (assetId) => {
    // 乐观更新：先从本地数组里移除，再静默校准，避免 Table loading 蒙层导致整页抖动
    const prevAssets = assets;
    const prevTotal = assetTotal;
    setAssets((list) => list.filter((item) => Number(item.id) !== Number(assetId)));
    setAssetTotal((total) => Math.max(0, Number(total || 0) - 1));
    try {
      await deleteMaterialAsset(assetId);
      message.success("素材已删除。");
      // 后台静默拉一次，校准 total 与文件夹计数；不亮 loading
      reloadProjects({ silent: true }).catch(() => {});
      reloadAssets(undefined, { silent: true }).catch(() => {});
    } catch (error) {
      // 失败回滚
      setAssets(prevAssets);
      setAssetTotal(prevTotal);
      message.error(error?.message || "删除素材失败。");
    }
  };

  const handleTreeDrop = async (info) => {
    const dragKey = String(info.dragNode.key || "");
    const dropKey = String(info.node.key || "");
    const draggingFolder = dragKey.startsWith("folder-");
    if (!draggingFolder) return;

    // Resolve the target folder id for the drop, regardless of whether the
    // user dropped onto a node or into the gap above/below it.
    let targetFolderId = null;
    if (info.dropToGap) {
      // Dropped into a gap — treat as "place at this node's level", so the
      // target is the hovered node's parent folder.
      if (dropKey.startsWith("folder-")) {
        const hoveredFolderId = Number(dropKey.replace("folder-", ""));
        const hoveredFolder = folderMap.get(hoveredFolderId);
        targetFolderId = hoveredFolder?.parent_id != null ? Number(hoveredFolder.parent_id) : null;
      }
    } else if (dropKey.startsWith("folder-")) {
      // Dropped directly onto a folder — go inside it.
      targetFolderId = Number(dropKey.replace("folder-", ""));
    }

    try {
      const folderId = Number(dragKey.replace("folder-", ""));
      if (folderId === targetFolderId) return;
      await moveMaterialProject(folderId, { parent_id: targetFolderId });
      message.success("文件夹已移动。");
      await reloadProjects();
      await reloadAssets();
      if (targetFolderId != null) {
        startTransition(() => setSelectedProjectId(targetFolderId));
      }
    } catch (error) {
      message.error(error?.message || "拖动移动失败。");
    }
  };

  const treeData = useMemo(
    () => buildFolderTree({
      folders: projects,
      selectedFolderId: selectedProjectId,
      visibleFolderIds,
    }),
    [projects, selectedProjectId, visibleFolderIds],
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
    { title: "原文件名", dataIndex: "file_name", width: 220, ellipsis: true },
    { title: "大小", dataIndex: "file_size", width: 100, render: (value) => formatFileSize(value) },
    { title: "标签", dataIndex: "tags", width: 120, ellipsis: true, render: (value) => value || "—" },
    { title: "备注", dataIndex: "remark", width: 140, ellipsis: true, render: (value) => value || "—" },
    {
      title: "操作",
      key: "action",
      width: 400,
      fixed: "right",
      render: (_, row) => (
        <Space size={4} wrap={false}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewState({ open: true, asset: row })}>
            预览
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            href={buildMaterialAssetPreviewUrl(row.id, { download: true })}
            target="_blank"
            rel="noreferrer"
          >
            下载
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditAsset(row.id)}>
            编辑
          </Button>
          <Button size="small" icon={<SwapOutlined />} onClick={() => openMoveAsset(row)}>
            移动
          </Button>
          <Popconfirm title="删除该素材？" onConfirm={() => handleDeleteAsset(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const allModeAssetColumns = [
    assetColumns[0],
    assetColumns[1],
    {
      title: "所在文件夹",
      dataIndex: "project_name",
      width: 180,
      render: (value, row) => {
        const name = value || folderNameById.get(Number(row.project_id)) || "—";
        return (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => row.project_id && setSelectedProjectId(Number(row.project_id))}
          >
            {name}
          </Button>
        );
      },
    },
    ...assetColumns.slice(2),
  ];

  return (
    <Layout style={{ background: "transparent", minHeight: 680, gap: 16 }}>
      <Sider width={272} theme="light" style={{ background: "transparent" }}>
        <div className="material-folder-panel">
          <div className="material-folder-panel__head">
            <span className="material-folder-panel__title">素材文件夹</span>
            <Space size={2}>
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={manualRefresh}
                title="刷新"
              />
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={openCreateProject}
                title="新建文件夹"
              />
            </Space>
          </div>
          <div className="material-folder-panel__search">
            <Input
              size="small"
              placeholder="搜索文件夹"
              value={projectKeyword}
              onChange={(e) => setProjectKeyword(e.target.value)}
              allowClear
            />
          </div>
          <div className="material-folder-panel__body">
            <Spin spinning={folderLoading}>
              {(() => {
              const treeWithAll = [
                {
                  key: ALL_ASSETS_KEY,
                  title: (
                    <span className="material-folder-tree__title material-folder-tree__title--all">
                      <span className="material-folder-tree__name">全部素材</span>
                      <span className={`material-folder-tree__count${totalAssetCount ? " is-active" : ""}`}>{totalAssetCount}</span>
                    </span>
                  ),
                  icon: <FolderOpenOutlined />,
                  isLeaf: true,
                  selectable: true,
                  draggable: false,
                },
                ...treeData,
              ];
              const selectedKey = isAllMode
                ? [ALL_ASSETS_KEY]
                : selectedProjectId
                  ? [`folder-${selectedProjectId}`]
                  : [];
              return (
                <div className="material-folder-tree">
                  <Tree
                    blockNode
                    showIcon
                    draggable={(node) => node?.key !== ALL_ASSETS_KEY}
                    expandedKeys={displayExpandedKeys}
                    autoExpandParent={false}
                    onExpand={(keys) => setExpandedKeys(keys.map(String))}
                    selectedKeys={selectedKey}
                    treeData={treeWithAll}
                    onSelect={(keys) => {
                      if (!keys?.length) return;
                      const key = String(keys[0]);
                      if (key === ALL_ASSETS_KEY) {
                        startTransition(() => setSelectedProjectId(ALL_ASSETS_KEY));
                        return;
                      }
                      if (key.startsWith("folder-")) {
                        startTransition(() => setSelectedProjectId(Number(key.replace("folder-", ""))));
                      }
                    }}
                    onDrop={handleTreeDrop}
                  />
                </div>
                );
              })()}
              {!treeData.length ? (
                <div className="material-folder-panel__empty">
                  {deferredProjectKeyword ? "没有匹配的文件夹" : "还没有素材文件夹"}
                </div>
              ) : null}
            </Spin>
          </div>
        </div>
      </Sider>

      <Content>
        <Card styles={{ body: { padding: 18 } }}>
          {isAllMode ? (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                <Space direction="vertical" size={4}>
                  <Title level={4} style={{ margin: 0 }}>全部素材</Title>
                  <Text type="secondary">汇总所有文件夹下的素材，共 {assetTotal} 个</Text>
                </Space>
                <Space wrap>
                  <Button icon={<PlusOutlined />} onClick={openCreateProject}>新建文件夹</Button>
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
                loading={assetLoading}
                dataSource={assets}
                columns={allModeAssetColumns}
                scroll={{ x: "max-content" }}
                pagination={{
                  current: assetPage,
                  pageSize: assetPageSize,
                  total: assetTotal,
                  showSizeChanger: true,
                  pageSizeOptions: ["12", "24", "48", "96"],
                  onChange: (pageValue, sizeValue) => {
                    setAssetPage(pageValue);
                    setAssetPageSize(sizeValue);
                  },
                }}
                locale={{ emptyText: "暂无任何素材" }}
              />
            </Space>
          ) : selectedProject ? (
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
                loading={assetLoading}
                dataSource={assets}
                columns={assetColumns}
                scroll={{ x: "max-content" }}
                pagination={{
                  current: assetPage,
                  pageSize: assetPageSize,
                  total: assetTotal,
                  showSizeChanger: true,
                  pageSizeOptions: ["12", "24", "48", "96"],
                  onChange: (pageValue, sizeValue) => {
                    setAssetPage(pageValue);
                    setAssetPageSize(sizeValue);
                  },
                }}
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
        destroyOnHidden={false}
        forceRender
      >
        <Form form={projectForm} layout="vertical" preserve={false}>
          <Form.Item label="文件夹名称" name="name" rules={[{ required: true, message: "请输入文件夹名称" }]}>
            <Input placeholder="例如：课程封面 / 视频素材 / 文档" />
          </Form.Item>
          <Form.Item label="上级文件夹" name="parent_id">
            <Select
              allowClear
              placeholder="根目录"
              options={folderOptions.filter((item) => !projectEditing || Number(item.value) !== Number(projectEditing.id))}
            />
          </Form.Item>
          <Form.Item label="文件夹描述" name="description">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={moveAssetState.open}
        title="移动素材"
        onCancel={() => setMoveAssetState({ open: false, asset: null })}
        onOk={submitMoveAsset}
        destroyOnHidden={false}
        forceRender
      >
        <Form form={moveAssetForm} layout="vertical" preserve={false}>
          <Form.Item label="素材名称">
            <Input value={moveAssetState.asset?.name || ""} disabled />
          </Form.Item>
          <Form.Item
            label="目标文件夹"
            name="project_id"
            rules={[{ required: true, message: "请选择目标文件夹" }]}
          >
            <Select
              showSearch
              placeholder="选择目标文件夹"
              optionFilterProp="label"
              options={folderOptions}
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
          setUploadTargetFolderId(null);
        }}
        onOk={submitAsset}
        confirmLoading={uploadingAsset}
        destroyOnHidden={false}
        forceRender
      >
        <Form form={assetForm} layout="vertical" preserve={false}>
          {!assetEditing && uploadTargetFolderId ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={(() => {
                const target = folderMap.get(Number(uploadTargetFolderId));
                const path = (target?.path_names || [target?.name]).filter(Boolean).join(" / ") || "(未知文件夹)";
                return `将上传到：${path}`;
              })()}
            />
          ) : null}
          <Form.Item label="素材名称" name="name" rules={[{ required: true, message: "请输入素材名称" }]}>
            <Input placeholder="例如：新产品宣传海报" />
          </Form.Item>
          {!assetEditing ? (
            <Form.Item label="选择文件" required>
              <Upload
                maxCount={1}
                showUploadList={false}
                accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.md,.csv,.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.mp4,.mov,.webm,.m4v,.mp3,.m4a,.wav,.aac,.ogg,.amr,.flac"
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
              <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                支持上传 Word、Excel、PPT、PDF、文本、图片、视频和音频文件。
              </Text>
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
        className="material-preview-modal"
        open={previewState.open}
        title={previewState.asset?.name || "素材预览"}
        footer={null}
        onCancel={() => setPreviewState({ open: false, asset: null })}
        width="92vw"
        style={{ top: 24, paddingBottom: 0, maxWidth: 1400 }}
        styles={{ body: { padding: 16 } }}
        destroyOnHidden
      >
        {previewState.asset ? (
          <MaterialAssetPreview
            asset={previewState.asset}
            url={buildMaterialAssetPreviewUrl(previewState.asset.id)}
          />
        ) : null}
      </Modal>
    </Layout>
  );
}
