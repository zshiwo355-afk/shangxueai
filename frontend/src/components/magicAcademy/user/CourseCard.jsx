import { ArrowRightOutlined } from "@ant-design/icons";
import { Button, Progress, Space } from "antd";

export default function CourseCard({
  cover,
  title,
  badges,
  metaText,
  progressPercent,
  actionLabel,
  onAction,
  disabled = false,
  delayMs = 0,
}) {
  return (
    <div
      className="workspace-line-item workspace-line-item--stack fade-in-up"
      style={{ "--fade-delay": `${delayMs}ms` }}
    >
      {cover}
      <div className="workspace-line-item__content">
        <Space size={[8, 8]} wrap>
          <strong>{title}</strong>
          {badges}
        </Space>
        <span>{metaText}</span>
        <Progress percent={progressPercent} size="small" showInfo={false} />
      </div>
      <Button type="link" disabled={disabled} onClick={onAction}>
        {actionLabel}
        <ArrowRightOutlined />
      </Button>
    </div>
  );
}
