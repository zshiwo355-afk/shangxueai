import { App as AntdApp, Button, Card, Space, Typography } from "antd";
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
      message.warning("复盘数据已经失效，请重新进入销售对练。");
      navigate("/workspace/training", { replace: true });
    }
  }, [review, message, navigate]);

  if (!review) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(review, null, 2));
      message.success("复盘 JSON 已复制。");
    } catch {
      message.error("复制失败，请稍后重试。");
    }
  };

  const goWorkspace = () => {
    clearActiveSession();
    navigate("/workspace/training", { replace: true });
  };

  return (
    <div className="page-shell page-shell--wide">
      <div className="page-toolbar page-toolbar--stack">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>返回销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>训练复盘</h2>
            <Text type="secondary">先看这次训练的结果，再回放完整对话，最后决定要不要继续练下一场。</Text>
          </div>
        </div>
        <Space wrap>
          <Button onClick={() => navigate("/training/records")}>查看训练记录</Button>
          <Button type="primary" onClick={() => navigate("/train/prepare")}>再练一次</Button>
        </Space>
      </div>

      <Card className="journey-tip-card" bordered={false}>
        <Space direction="vertical" size={8}>
          <Text strong>下一步建议</Text>
          <Text type="secondary">如果这次分数偏低，建议直接再开一轮训练；如果表现稳定，可以先回到销售对练工作台查看最近记录和考试任务。</Text>
        </Space>
      </Card>

      <ReviewView review={review} />
      <ChatHistoryView messages={chatHistory} />

      <div className="journey-actions">
        <Button onClick={handleCopy}>复制复盘 JSON</Button>
        <Button onClick={() => navigate("/training/records")}>回到训练记录</Button>
        <Button type="primary" onClick={goWorkspace}>回到销售对练</Button>
      </div>
    </div>
  );
}
