import {
  BookOutlined,
  FormOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuOutlined,
  RocketOutlined,
  ScheduleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Drawer, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { logoutApi } from "../lib/api.auth";
import { fetchGuideStatus } from "../lib/api.guide";
import { clearAuth, getCurrentUser, isAdmin } from "../lib/auth";
import logoImg from "../assets/logo.png";
import NewbieGuide from "./NewbieGuide";
import FloatingAiButton from "./FloatingAiButton";

const NAV_ITEMS = [
  { key: "home", label: "首页", path: "/home", icon: <HomeOutlined /> },
  { key: "todo", label: "我的待办", path: "/todo", icon: <ScheduleOutlined /> },
  { key: "training", label: "销售对练", path: "/workspace/training", icon: <RocketOutlined /> },
  { key: "magic", label: "课程管理", path: "/workspace/magic", icon: <BookOutlined /> },
  { key: "papers", label: "考试中心", path: "/papers", icon: <FormOutlined /> },
];

function resolveSection(pathname) {
  if (pathname.startsWith("/todo")) {
    return "我的待办";
  }
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guideActive, setGuideActive] = useState(false);

  useEffect(() => {
    if (user?.guide_completed_at) return;
    fetchGuideStatus()
      .then((data) => { if (data?.should_show) setGuideActive(true); })
      .catch(() => {});
  }, []);

  // Close drawer on every route change so menu doesn't linger after navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // Ignore logout errors and clear the local session anyway.
    }
    clearAuth();
    navigate("/login", { replace: true });
  };

  const goTo = (path) => {
    setDrawerOpen(false);
    navigate(path);
  };

  return (
    <div className="user-layout">
      <header className="user-layout__header">
        <div className="user-layout__header-inner">
          <button type="button" className="user-layout__brand" onClick={() => navigate("/home")}>
            <div className="user-layout__brand-mark">
              <img src={logoImg} alt="怀仁商学院" />
            </div>
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
                  data-guide={`nav-${item.key}`}
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
                  <Tag bordered={false} color={user?.job_level === "P线" ? "geekblue" : "cyan"}>{user?.job_level || "M线"}</Tag>
                  <span>{user?.position || "学习中"}</span>
                </Space>
              </div>
            </div>

            <Button icon={<LogoutOutlined />} onClick={handleLogout}>
              退出
            </Button>
          </div>

          <button
            type="button"
            className="user-layout__menu-trigger"
            aria-label="打开菜单"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuOutlined />
          </button>
        </div>
      </header>

      <Drawer
        className="user-layout-drawer"
        placement="right"
        width={300}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={(
          <div className="user-layout-drawer__user">
            <Avatar className="user-layout__avatar">
              {(user?.display_name || user?.username || "U").slice(0, 1).toUpperCase()}
            </Avatar>
            <div>
              <strong>{user?.display_name || user?.username || "学员"}</strong>
              <div className="user-layout-drawer__user-meta">
                {user?.department ? <Tag bordered={false}>{user.department}</Tag> : null}
                <Tag bordered={false} color={user?.job_level === "P线" ? "geekblue" : "cyan"}>{user?.job_level || "M线"}</Tag>
                <span>{user?.position || "学习中"}</span>
              </div>
            </div>
          </div>
        )}
        styles={{ body: { padding: 0 } }}
      >
        <nav className="user-layout-drawer__nav" aria-label="移动端导航">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path
              || (item.key === "training" && resolveSection(location.pathname) === "销售对练")
              || (item.key === "magic" && resolveSection(location.pathname) === "课程管理")
              || (item.key === "papers" && resolveSection(location.pathname) === "考试中心");
            return (
              <button
                key={item.key}
                type="button"
                className={`user-layout-drawer__nav-item${active ? " is-active" : ""}`}
                onClick={() => goTo(item.path)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="user-layout-drawer__footer">
          {showAdminEntry ? (
            <Button block icon={<SettingOutlined />} onClick={() => goTo("/admin")}>
              管理后台
            </Button>
          ) : null}
          <Button block icon={<LogoutOutlined />} onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </Drawer>

      <main className="user-layout__content">
        <Outlet />
      </main>

      <NewbieGuide active={guideActive} onFinish={() => setGuideActive(false)} />
      <FloatingAiButton />
    </div>
  );
}
