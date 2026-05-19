import { Button, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { clearActiveSession } from "../lib/storage";
import ChatHistoryView from "./ChatHistoryView";
import ReviewView from "./ReviewView";

export default function ReviewPage() {
  const { sid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [review, setReview] = useState(() => location.state?.review || null);
  const chatHistory = location.state?.chatHistory || [];

  useEffect(() => {
    if (!review) {
      message.warning("复盘数据已失效，请重新开始训练。");
      navigate("/home", { replace: true });
    }
  }, [review, message, navigate]);

  if (!review) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(review, null, 2));
      message.success("复盘 JSON 已复制。");
    } catch {
      message.error("复制失败，请手动选择。");
    }
  };

  const goHome = () => {
    clearActiveSession();
    navigate("/home", { replace: true });
  };

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <Button onClick={() => navigate("/home")}>返回首页</Button>
        <h2 style={{ margin: 0 }}>训练复盘</h2>
        <Button onClick={() => navigate("/train/prepare")}>再训一次</Button>
      </div>
      <ReviewView review={review} />
      <ChatHistoryView messages={chatHistory} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={handleCopy}>复制复盘 JSON</Button>
        <Button type="primary" onClick={goHome}>开始下一次</Button>
      </div>
    </div>
  );
}
