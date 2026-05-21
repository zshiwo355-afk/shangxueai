import { App as AntdApp, Button, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { clearActiveSession } from "../lib/storage";
import ChatHistoryView from "./ChatHistoryView";
import ReviewView from "./ReviewView";

const { Text } = Typography;

export default function ReviewPage() {
  const { sid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [review] = useState(() => location.state?.review || null);
  const chatHistory = location.state?.chatHistory || [];

  useEffect(() => {
    if (!review) {
      message.warning("复盘数据已失效，请重新进入。");
      navigate("/workspace/training", { replace: true });
    }
  }, [review, message, navigate]);

  if (!review) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(review, null, 2));
      message.success("已复制。");
    } catch {
      message.error("复制失败，请稍后重试。");
    }
  };

  const goWorkspace = () => {
    clearActiveSession();
    navigate("/workspace/training", { replace: true });
  };

  return (
    <div className="page-shell page-shell--wide page-shell--minimal">
      <div className="page-toolbar page-toolbar--stack page-toolbar--minimal">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>训练复盘</h2>
            <Text type="secondary">先看结果，再看回放。</Text>
          </div>
        </div>
        <Space wrap>
          <Button onClick={() => navigate("/training/records")}>训练记录</Button>
          <Button type="primary" onClick={() => navigate("/train/prepare")}>再练一次</Button>
        </Space>
      </div>

      <ReviewView review={review} />
      <ChatHistoryView messages={chatHistory} />

      <div className="journey-actions journey-actions--spread journey-actions--minimal">
        <Button onClick={handleCopy}>复制结果</Button>
        <Space wrap>
          <Button onClick={() => navigate("/training/records")}>训练记录</Button>
          <Button type="primary" onClick={goWorkspace}>返回工作台</Button>
        </Space>
      </div>
    </div>
  );
}
