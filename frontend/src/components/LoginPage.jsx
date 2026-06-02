import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Form, Input } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { buildWecomStartUrl, getAuthProviders, login } from "../lib/api.auth";
import { setCurrentUser, setToken } from "../lib/auth";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState(true);
  const [wecomEnabled, setWecomEnabled] = useState(false);
  const [wecomAutoRedirect, setWecomAutoRedirect] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntdApp.useApp();

  useEffect(() => {
    let mounted = true;
    const loadProviders = async () => {
      try {
        const providers = await getAuthProviders();
        if (!mounted) return;
        setWecomEnabled(Boolean(providers?.wecom_enabled));
        setWecomAutoRedirect(Boolean(providers?.wecom_auto_redirect_in_client));
      } catch {
        if (!mounted) return;
        setWecomEnabled(false);
        setWecomAutoRedirect(false);
      } finally {
        if (mounted) {
          setProviderLoading(false);
        }
      }
    };
    loadProviders();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const errorText = location.state?.wecomError;
    if (!errorText) return;
    message.error(errorText);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, message, navigate]);

  useEffect(() => {
    if (providerLoading || !wecomEnabled || !wecomAutoRedirect) {
      return;
    }
    const ua = (navigator.userAgent || "").toLowerCase();
    if (!ua.includes("wxwork")) {
      return;
    }
    const redirect = location.state?.from && location.state.from !== "/login"
      ? location.state.from
      : "/home";
    window.location.assign(buildWecomStartUrl(redirect));
  }, [location.state, providerLoading, wecomAutoRedirect, wecomEnabled]);

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const res = await login({ username: values.username, password: values.password });
      setToken(res.token);
      setCurrentUser(res.user);
      const role = (res.user?.role || "").toLowerCase();
      const fallback = role === "admin" || role === "super_admin" ? "/admin" : "/home";
      const from = location.state?.from && location.state.from !== "/login" ? location.state.from : fallback;
      navigate(from, { replace: true });
    } catch (err) {
      message.error(err?.message || "登录失败。");
    } finally {
      setLoading(false);
    }
  };

  const yearText = dayjs().format("YYYY");

  return (
    <div className="auth-shell">
      <aside className="auth-shell__brand">
        <span className="auth-shell__watermark" aria-hidden="true">怀</span>
        <div className="auth-shell__brand-inner">
          <div className="auth-shell__logo">
            <span className="auth-shell__logo-mark">怀</span>
            <div className="auth-shell__logo-copy">
              <strong>怀仁商学院</strong>
              <span>Huairen Business School</span>
            </div>
          </div>

          <div className="auth-shell__hero">
            <span className="auth-shell__eyebrow">Enterprise Learning Platform</span>
            <h1 className="auth-shell__title">用心练习<br />每天进步一点</h1>
            <p className="auth-shell__lead">
              融合 AI 销售对练、魔学院课程与试卷考核的一站式企业学习平台，
              让员工成长可衡量、可追踪、可沉淀。
            </p>
          </div>

          <ul className="auth-shell__features">
            <li>
              <span className="auth-shell__feature-num">01</span>
              <div>
                <strong>沉浸式销售对练</strong>
                <span>AI 客户角色多场景陪练，实时复盘话术。</span>
              </div>
            </li>
            <li>
              <span className="auth-shell__feature-num">02</span>
              <div>
                <strong>体系化课程沉淀</strong>
                <span>视频 / 节点答题 / 读书打卡，让知识形成闭环。</span>
              </div>
            </li>
            <li>
              <span className="auth-shell__feature-num">03</span>
              <div>
                <strong>真考试与人工复核</strong>
                <span>题库 + 试卷 + 派发 + AI 自动判分 + 老师复核。</span>
              </div>
            </li>
          </ul>

          <div className="auth-shell__footer">
            <span>© {yearText} 怀仁商学院</span>
            <span>Huairen · 数据持续沉淀</span>
          </div>
        </div>
      </aside>

      <main className="auth-shell__panel">
        <div className="auth-shell__panel-inner">
          <div className="auth-shell__panel-head">
            <span className="auth-shell__eyebrow">Sign In</span>
            <h2>欢迎登录</h2>
            <p>请使用账号密码登录。从企业微信工作台进入时会自动免登录。</p>
          </div>

          <Form
            layout="vertical"
            onFinish={handleSubmit}
            requiredMark={false}
            className="auth-shell__form"
          >
            <Form.Item
              name="username"
              label="账号"
              rules={[{ required: true, message: "请输入账号" }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="请输入账号"
                size="large"
                autoFocus
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                size="large"
                autoComplete="current-password"
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                登录
              </Button>
            </Form.Item>
          </Form>

          <p className="auth-shell__note">
            遇到登录问题，请联系企业管理员或所属部门。
          </p>
        </div>

        <div className="auth-shell__panel-foot">
          <span>© {yearText} 怀仁商学院 · 保留所有权利</span>
        </div>
      </main>
    </div>
  );
}
