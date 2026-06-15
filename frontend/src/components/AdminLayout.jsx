import {
  AppstoreOutlined,
  BellOutlined,
  BookOutlined,
  CloseOutlined,
  DashboardOutlined,
  FolderOpenOutlined,
  FormOutlined,
  GiftOutlined,
  HistoryOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SolutionOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserSwitchOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Space, Spin } from "antd";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { logoutApi } from "../lib/api.auth";
import { clearAuth, isSuperAdmin } from "../lib/auth";
import logoImg from "../assets/logo.png";
import "./admin-shell.css";

const UsersTab = lazy(() => import("./admin/UsersTab"));
const OptionsTab = lazy(() => import("./admin/OptionsTab"));
const ExamsTab = lazy(() => import("./admin/ExamsTab"));
const PapersAdminPage = lazy(() => import("./admin/papers/PapersAdminPage"));
const WhitelistTab = lazy(() => import("./admin/WhitelistTab"));
const MagicAcademyPage = lazy(() => import("./MagicAcademyPage"));
const MaterialLibraryPage = lazy(() => import("./admin/MaterialLibraryPage"));
const NotificationsTab = lazy(() => import("./admin/NotificationsTab"));
const PointsAdminPage = lazy(() => import("./admin/points/PointsAdminPage"));
const MentorsTab = lazy(() => import("./admin/mentors/MentorsTab"));
const DashboardPage = lazy(() => import("./admin/dashboard/DashboardPage"));
const SyncLogsTab = lazy(() => import("./admin/SyncLogsTab"));
const LiveAdminPage = lazy(() => import("./admin/live/LiveAdminPage"));

const { Header, Sider, Content } = Layout;

const MENU_GROUPS = [
  { key: "dashboard", icon: <DashboardOutlined />, label: "数据看板", path: "/admin/dashboard" },
  {
    key: "learning",
    icon: <ReadOutlined />,
    label: "学习中心",
    children: [
      { key: "magic-academy", icon: <ReadOutlined />, label: "课程管理", path: "/admin/magic-academy/courses" },
      { key: "magic-reading", icon: <BookOutlined />, label: "读书打卡", path: "/admin/magic-academy/reading" },
      { key: "live", icon: <VideoCameraOutlined />, label: "直播管理", path: "/admin/live" },
      { key: "exams", icon: <FormOutlined />, label: "AI 通关", path: "/admin/exams" },
      { key: "papers", icon: <SolutionOutlined />, label: "考试管理", path: "/admin/papers" },
    ],
  },
  {
    key: "operations",
    icon: <GiftOutlined />,
    label: "运营激励",
    children: [
      { key: "points", icon: <TrophyOutlined />, label: "积分管理", path: "/admin/points" },
      { key: "mentors", icon: <UserSwitchOutlined />, label: "导师管理", path: "/admin/mentors" },
      { key: "notifications", icon: <BellOutlined />, label: "推送监控", path: "/admin/notifications" },
    ],
  },
  {
    key: "user-mgmt",
    icon: <TeamOutlined />,
    label: "用户与权限",
    children: [
      { key: "users", icon: <TeamOutlined />, label: "用户管理", path: "/admin/users" },
      { key: "sync-logs", icon: <HistoryOutlined />, label: "同步记录", path: "/admin/sync-logs" },
      { key: "whitelist", icon: <SafetyCertificateOutlined />, label: "白名单管理", superOnly: true, path: "/admin/whitelist" },
    ],
  },
  {
    key: "system",
    icon: <SettingOutlined />,
    label: "系统配置",
    children: [
      { key: "options", icon: <AppstoreOutlined />, label: "配置管理", path: "/admin/options" },
      { key: "materials", icon: <FolderOpenOutlined />, label: "素材库", path: "/admin/materials" },
    ],
  },
];

const MENU_FLAT = MENU_GROUPS.flatMap((g) => (g.children ? g.children : [g]));

function findParentKey(leafKey) {
  return MENU_GROUPS.find((g) => g.children?.some((c) => c.key === leafKey))?.key;
}

function findLeaf(key) {
  return MENU_FLAT.find((m) => m.key === key);
}

function findGroup(leafKey) {
  return MENU_GROUPS.find((g) => g.children?.some((c) => c.key === leafKey));
}

function TabFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "120px 0" }}>
      <Spin size="large" />
    </div>
  );
}

const DEFAULT_TAB = { key: "dashboard", label: "数据看板", path: "/admin/dashboard", closable: false };

const SIDER_COLLAPSE_KEY = "admin.sider.collapsed";

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const showWhitelist = isSuperAdmin();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDER_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDER_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const menuItems = useMemo(() => {
    return MENU_GROUPS
      .map((g) => {
        if (!g.children) return { key: g.key, icon: g.icon, label: g.label };
        const children = g.children.filter((c) => !c.superOnly || showWhitelist);
        if (!children.length) return null;
        return {
          key: g.key,
          icon: g.icon,
          label: g.label,
          children: children.map((c) => ({ key: c.key, icon: c.icon, label: c.label })),
        };
      })
      .filter(Boolean);
  }, [showWhitelist]);

  const activeKey = useMemo(() => {
    if (location.pathname.startsWith("/admin/whitelist")) return "whitelist";
    if (location.pathname.startsWith("/admin/sync-logs")) return "sync-logs";
    if (location.pathname.startsWith("/admin/materials")) return "materials";
    if (location.pathname.startsWith("/admin/mentors")) return "mentors";
    if (location.pathname.startsWith("/admin/points")) return "points";
    if (location.pathname.startsWith("/admin/notifications")) return "notifications";
    if (location.pathname.startsWith("/admin/live")) return "live";
    if (location.pathname.startsWith("/admin/magic-academy/reading")) return "magic-reading";
    if (location.pathname.startsWith("/admin/magic-academy")) return "magic-academy";
    if (location.pathname.startsWith("/admin/papers")) return "papers";
    if (location.pathname.startsWith("/admin/dashboard")) return "dashboard";
    const m = location.pathname.match(/^\/admin\/?([\w-]+)?/);
    return m?.[1] || "dashboard";
  }, [location.pathname]);

  const [openKeys, setOpenKeys] = useState(() => {
    const parent = findParentKey(activeKey);
    return parent ? [parent] : [];
  });
  useEffect(() => {
    const parent = findParentKey(activeKey);
    if (parent) {
      setOpenKeys((prev) => (prev.includes(parent) ? prev : [...prev, parent]));
    }
  }, [activeKey]);

  const [tabs, setTabs] = useState([DEFAULT_TAB]);
  const lastKeyRef = useRef(null);
  useEffect(() => {
    if (lastKeyRef.current === activeKey) return;
    lastKeyRef.current = activeKey;
    const leaf = findLeaf(activeKey);
    if (!leaf) return;
    setTabs((prev) => {
      if (prev.some((t) => t.key === activeKey)) return prev;
      return [...prev, {
        key: activeKey,
        label: leaf.label,
        path: leaf.path || `/admin/${activeKey}`,
        closable: activeKey !== "dashboard",
      }];
    });
  }, [activeKey]);

  const closeTab = (key) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.key !== key);
      if (key === activeKey && next.length) {
        const fallback = next[Math.min(idx, next.length - 1)];
        navigate(fallback.path);
      }
      return next.length ? next : [DEFAULT_TAB];
    });
  };

  const handleLogout = async () => {
    try { await logoutApi(); } catch { /* ignore */ }
    clearAuth();
    navigate("/login", { replace: true });
  };

  const activeLeaf = findLeaf(activeKey);
  const activeGroup = findGroup(activeKey);
  const headerEyebrow = activeGroup?.label || (activeKey === "dashboard" ? "Overview" : "管理后台");

  return (
    <Layout className="admin-shell" style={{ height: "100vh" }}>
      <Sider
        width={248}
        collapsedWidth={72}
        collapsible
        collapsed={collapsed}
        trigger={null}
        theme="light"
        className={`admin-sider${collapsed ? " admin-sider--collapsed" : ""}`}
      >
        <div className="admin-sider__brand">
          <div className="admin-sider__brand-mark">
            <img src={logoImg} alt="怀仁商学院" />
          </div>
          <div className="admin-sider__brand-text">
            <span className="admin-sider__brand-name">怀仁商学院</span>
            <span className="admin-sider__brand-sub">Admin Console</span>
          </div>
        </div>
        <div className="admin-sider__nav-eyebrow">Navigation</div>
        <Menu
          mode="inline"
          multiple={false}
          inlineCollapsed={collapsed}
          selectedKeys={[activeKey]}
          openKeys={collapsed ? undefined : openKeys}
          onOpenChange={setOpenKeys}
          items={menuItems}
          className="admin-sider__menu"
          classNames={{ popup: "admin-sider-popup" }}
          motion={{ motionName: "" }}
          onClick={({ key }) => {
            const item = findLeaf(key);
            if (!item) return;
            navigate(item.path || `/admin/${key}`);
          }}
        />
        <button
          type="button"
          className="admin-sider__collapse"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "展开菜单" : "收起菜单"}
          title={collapsed ? "展开菜单" : "收起菜单"}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          <span className="admin-sider__collapse-text">收起菜单</span>
        </button>
      </Sider>
      <Layout style={{ height: "100vh" }}>
        <Header className="admin-header">
          <div className="admin-header__title">
            <span className="admin-header__eyebrow">{headerEyebrow}</span>
            <span className="admin-header__name">{activeLeaf?.label || "管理后台"}</span>
          </div>
          <Space size={8}>
            <Button icon={<HomeOutlined />} onClick={() => navigate("/todo")}>
              用户端
            </Button>
            <Button
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              className="admin-header__logout"
            >
              退出
            </Button>
          </Space>
        </Header>

        <div className="admin-tabs">
          {tabs.map((tab) => {
            const isActive = tab.key === activeKey;
            return (
              <div
                key={tab.key}
                onClick={() => { if (!isActive) navigate(tab.path); }}
                className={`admin-tab${isActive ? " admin-tab--active" : ""}`}
              >
                <span>{tab.label}</span>
                {tab.closable ? (
                  <CloseOutlined
                    onClick={(ev) => {
                      ev.stopPropagation();
                      closeTab(tab.key);
                    }}
                    className="admin-tab__close"
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <Content className="admin-content">
          <Suspense fallback={<TabFallback />}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="users" element={<UsersTab />} />
              <Route path="sync-logs" element={<SyncLogsTab />} />
              <Route path="options" element={<OptionsTab />} />
              <Route path="exams" element={<ExamsTab />} />
              <Route path="papers/*" element={<PapersAdminPage />} />
              <Route path="magic-academy" element={<Navigate to="/admin/magic-academy/courses" replace />} />
              <Route path="magic-academy/courses" element={<MagicAcademyPage embedded adminSection="courses" />} />
              <Route path="magic-academy/reading" element={<MagicAcademyPage embedded adminSection="reading" />} />
              <Route path="live/*" element={<LiveAdminPage />} />
              <Route path="materials" element={<MaterialLibraryPage />} />
              <Route path="mentors" element={<MentorsTab />} />
              <Route path="points" element={<PointsAdminPage />} />
              <Route path="notifications" element={<NotificationsTab />} />
              <Route path="whitelist" element={showWhitelist ? <WhitelistTab /> : <Navigate to="/admin/users" replace />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
