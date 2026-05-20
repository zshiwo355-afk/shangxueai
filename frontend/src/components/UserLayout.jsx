import { BookOutlined, HomeOutlined, LogoutOutlined, RocketOutlined, SettingOutlined } from "@ant-design/icons";
import { Avatar, Button, Space, Tag } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { logoutApi } from "../lib/api.auth";
import { clearAuth, getCurrentUser, isAdmin } from "../lib/auth";

const NAV_ITEMS = [
  { key: "home", label: "\u9996\u9875", path: "/home", icon: <HomeOutlined /> },
  { key: "training", label: "\u9500\u552e\u5bf9\u7ec3", path: "/workspace/training", icon: <RocketOutlined /> },
  { key: "magic", label: "\u9b54\u5b66\u9662", path: "/workspace/magic", icon: <BookOutlined /> },
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
    return "\u9500\u552e\u5bf9\u7ec3";
  }
  if (pathname.startsWith("/workspace/magic") || pathname.startsWith("/magic-academy")) {
    return "\u9b54\u5b66\u9662";
  }
  return "\u7528\u6237\u9996\u9875";
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
            <div className="user-layout__brand-mark">\u5546</div>
            <div className="user-layout__brand-copy">
              <strong>\u5546\u5b66\u9662 AI \u57f9\u8bad</strong>
              <span>{currentSection}</span>
            </div>
          </button>

          <nav className="user-layout__nav" aria-label="\u7528\u6237\u7aef\u4e3b\u5bfc\u822a">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.path
                || (item.key === "training" && resolveSection(location.pathname) === "\u9500\u552e\u5bf9\u7ec3")
                || (item.key === "magic" && resolveSection(location.pathname) === "\u9b54\u5b66\u9662");
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
                {"\u7ba1\u7406\u540e\u53f0"}
              </Button>
            ) : null}
            <div className="user-layout__user-card">
              <Avatar className="user-layout__avatar">
                {(user?.display_name || user?.username || "U").slice(0, 1).toUpperCase()}
              </Avatar>
              <div className="user-layout__user-copy">
                <strong>{user?.display_name || user?.username || "\u5b66\u5458"}</strong>
                <Space size={6} wrap>
                  {user?.department ? <Tag bordered={false}>{user.department}</Tag> : null}
                  <span>{user?.position || "\u5b66\u4e60\u4e2d"}</span>
                </Space>
              </div>
            </div>
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>
              {"\u9000\u51fa"}
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
