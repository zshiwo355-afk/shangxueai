import { LogoutOutlined, AppstoreOutlined, FormOutlined, SolutionOutlined, TeamOutlined, ReadOutlined, SafetyCertificateOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Typography } from "antd";
import { useMemo } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import UsersTab from "./admin/UsersTab";
import OptionsTab from "./admin/OptionsTab";
import ExamsTab from "./admin/ExamsTab";
import PapersAdminPage from "./admin/papers/PapersAdminPage";
import WhitelistTab from "./admin/WhitelistTab";
import MagicAcademyPage from "./MagicAcademyPage";
import MaterialLibraryPage from "./admin/MaterialLibraryPage";
import { logoutApi } from "../lib/api.auth";
import { clearAuth, getCurrentUser, isSuperAdmin } from "../lib/auth";

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
  { key: "users", icon: <TeamOutlined />, label: "用户管理" },
  { key: "options", icon: <AppstoreOutlined />, label: "通关管理" },
  { key: "exams", icon: <FormOutlined />, label: "AI通关" },
  { key: "papers", icon: <SolutionOutlined />, label: "考试管理" },
  { key: "magic-academy", icon: <ReadOutlined />, label: "课程管理" },
  { key: "materials", icon: <FolderOpenOutlined />, label: "素材库管理" },
  { key: "whitelist", icon: <SafetyCertificateOutlined />, label: "白名单管理", superOnly: true },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getCurrentUser();
  const showWhitelist = isSuperAdmin();
  const menuItems = useMemo(
    () => MENU_ITEMS.filter((item) => !item.superOnly || showWhitelist),
    [showWhitelist],
  );

  const activeKey = useMemo(() => {
    if (location.pathname.startsWith("/admin/whitelist")) return "whitelist";
    if (location.pathname.startsWith("/admin/materials")) return "materials";
    if (location.pathname.startsWith("/admin/magic-academy")) return "magic-academy";
    if (location.pathname.startsWith("/admin/papers")) return "papers";
    const m = location.pathname.match(/^\/admin\/?([\w-]+)?/);
    return m?.[1] || "users";
  }, [location.pathname]);

  const handleLogout = async () => {
    try { await logoutApi(); } catch { /* ignore */ }
    clearAuth();
    navigate("/login", { replace: true });
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220} theme="light" style={{ borderRight: "1px solid var(--line-soft)" }}>
        <div style={{ padding: "20px 16px 16px" }}>
          <div className="prepare-emblem" style={{ width: 40, height: 40, fontSize: 18, marginBottom: 6, borderRadius: 12 }}>怀</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>怀仁商学院 管理后台</div>
          <div style={{ fontSize: 12, color: "var(--text-mute)" }}>{user?.display_name || user?.username}</div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems}
          onClick={({ key }) => {
            navigate(`/admin/${key}`);
          }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 24px",
            borderBottom: "1px solid var(--line-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {menuItems.find((m) => m.key === activeKey)?.label || "管理后台"}
          </Typography.Title>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
        </Header>
        <Content style={{ padding: 24, overflow: "auto" }}>
          <Routes>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users" element={<UsersTab />} />
            <Route path="options" element={<OptionsTab />} />
            <Route path="exams" element={<ExamsTab />} />
            <Route path="papers/*" element={<PapersAdminPage />} />
            <Route path="magic-academy" element={<MagicAcademyPage embedded />} />
            <Route path="materials" element={<MaterialLibraryPage />} />
            <Route path="whitelist" element={showWhitelist ? <WhitelistTab /> : <Navigate to="/admin/users" replace />} />
            <Route path="*" element={<Navigate to="users" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
