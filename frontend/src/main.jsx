import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { antdTheme } from "./antdTheme";
import { installAuthFetch } from "./lib/auth";
import "./styles.css";

installAuthFetch();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
