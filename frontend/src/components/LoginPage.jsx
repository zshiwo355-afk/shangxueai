import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Form, Input, App as AntdApp } from "antd";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../lib/api.auth";
import { setCurrentUser, setToken } from "../lib/auth";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntdApp.useApp();

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const res = await login({ username: values.username, password: values.password });
      setToken(res.token);
      setCurrentUser(res.user);
      const role = (res.user?.role || "").toLowerCase();
      const fallback = role === "admin" ? "/admin" : "/home";
      const from = location.state?.from && location.state.from !== "/login" ? location.state.from : fallback;
      navigate(from, { replace: true });
    } catch (err) {
      message.error(err?.message || "登录失败。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-emblem">怀</div>
        <h1 className="login-title">怀仁商学院</h1>
        <p className="login-subtitle">请输入账号登录</p>

        <Form layout="vertical" onFinish={handleSubmit} initialValues={{ username: "admin" }}>
          <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" size="large" autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>

        <p className="login-hint">默认管理员账号：admin / 123456</p>
      </div>
    </div>
  );
}
