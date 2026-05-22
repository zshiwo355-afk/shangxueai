import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { antdTheme } from "./antdTheme";
import { installAuthFetch } from "./lib/auth";
import { bindMessageApi, notifyError } from "./lib/notify";
import "./styles.css";

installAuthFetch();

/** 把 AntdApp 内的 message / notification 实例桥接给纯 JS 模块（lib/notify.js） */
function MessageBridge({ children }) {
  const { message, notification } = AntdApp.useApp();
  useEffect(() => {
    bindMessageApi(message, notification);
  }, [message, notification]);

  // 全局兜底：未被 catch 的 Promise rejection / 顶层报错 → 走统一 toast
  useEffect(() => {
    const onRejection = (event) => {
      const reason = event?.reason;
      // 只接管「像是 API 错误」的 rejection；其它原生异常交给 React/console
      if (reason && (reason.isApiError || reason.code || reason.status)) {
        notifyError(reason, "操作失败。");
        event.preventDefault?.();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return children;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <AntdApp>
        <MessageBridge>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </MessageBridge>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
