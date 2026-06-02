import { App as AntdApp, Spin } from "antd";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { clearAuth, setCurrentUser, setToken } from "../lib/auth";

function parseHashPayload() {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(raw);
  const token = params.get("token") || "";
  const redirect = params.get("redirect") || "/home";
  const error = params.get("error") || "";
  const userRaw = params.get("user") || "";
  let user = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      user = null;
    }
  }
  return { token, redirect, error, user };
}

export default function WecomCallbackPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  useEffect(() => {
    const { token, redirect, error, user } = parseHashPayload();
    if (error || !token || !user) {
      const fallbackMessage = error || "企业微信登录失败，请稍后重试。";
      clearAuth();
      message.error(fallbackMessage);
      navigate("/login", { replace: true, state: { wecomError: fallbackMessage } });
      return;
    }
    setToken(token);
    setCurrentUser(user);
    navigate(redirect || "/home", { replace: true });
  }, [message, navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-canvas)",
      }}
    >
      <Spin size="large" tip="正在完成企业微信登录..." />
    </div>
  );
}
