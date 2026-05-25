import {
  BookOutlined,
  FormOutlined,
  HomeOutlined,
  LogoutOutlined,
  RocketOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Space, Tag } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { logoutApi } from "../lib/api.auth";
import { clearAuth, getCurrentUser, isAdmin } from "../lib/auth";

const NAV_ITEMS = [
  { key: "home", label: "首页", path: "/home", icon: <HomeOutlined /> },
  { key: "training", label: "销售对练", path: "/workspace/training", icon: <RocketOutlined /> },
  { key: "magic", label: "课程管理", path: "/workspace/magic", icon: <BookOutlined /> },
  { key: "papers", label: "考试中心", path: "/papers", icon: <FormOutlined /> },
];

function resolveSection(pathname) {
  if (
    pathname.startsWith("/workspace/training")
    || pathname.startsWith("/train")
    || pathname.startsWith("/training")
    || pathname.startsWith("/exam")
    || pathname.startsWith("/review")
    || pathname.startsWith("/chat")
  ) {
    return "销售对练";
  }
  if (pathname.startsWith("/workspace/magic") || pathname.startsWith("/magic-academy")) {
    return "课程管理";
  }
  if (pathname.startsWith("/papers")) {
    return "考试中心";
  }
  return "用户首页";
}

export default function UserLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getCurrentUser();
  const currentSection = resolveSection(location.pathname);
  const showAdminEntry = isAdmin();

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // Ignore logout errors and clear the local session anyway.
    }
    clearAuth();
    navigate("/login", { replace: true });
  };

  return (
    <div className="user-layout">
      <header className="user-layout__header">
        <div className="user-layout__header-inner">
          <button type="button" className="user-layout__brand" onClick={() => navigate("/home")}>
            <div className="user-layout__brand-mark">怀</div>
            <div className="user-layout__brand-copy">
              <strong>怀仁商学院</strong>
              <span>{currentSection}</span>
            </div>
          </button>

          <nav className="user-layout__nav" aria-label="用户端主导航">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.path
                || (item.key === "training" && resolveSection(location.pathname) === "销售对练")
                || (item.key === "magic" && resolveSection(location.pathname) === "课程管理")
                || (item.key === "papers" && resolveSection(location.pathname) === "考试中心");

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`user-layout__nav-item${active ? " is-active" : ""}`}
                  onClick={() => navigate(item.path)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="user-layout__actions">
            {showAdminEntry ? (
              <Button icon={<SettingOutlined />} onClick={() => navigate("/admin")}>
                管理后台
              </Button>
            ) : null}

            <div className="user-layout__user-card">
              <Avatar className="user-layout__avatar">
                {(user?.display_name || user?.username || "U").slice(0, 1).toUpperCase()}
              </Avatar>
              <div className="user-layout__user-copy">
                <strong>{user?.display_name || user?.username || "学员"}</strong>
                <Space size={6} wrap>
                  {user?.department ? <Tag bordered={false}>{user.department}</Tag> : null}
                  <span>{user?.position || "学习中"}</span>
                </Space>
              </div>
            </div>

            <Button icon={<LogoutOutlined />} onClick={handleLogout}>
              退出
            </Button>
          </div>
        </div>
      </header>

      <main className="user-layout__content">
        <Outlet />
      </main>
    </div>
  );
}
