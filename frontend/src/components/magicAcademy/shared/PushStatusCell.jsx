import { Button, Space, Tag } from "antd";

import {
  formatPushLatestTime,
  getPushStatusMeta,
  getPushSummaryText,
  isPushRetryDisabled,
} from "./pushStatusUtils";

export default function PushStatusCell({
  summary = null,
  retryLoading = false,
  onOpenDetail,
  onRetry,
}) {
  const meta = getPushStatusMeta(summary?.status);
  const retryDisabled = isPushRetryDisabled(summary);

  return (
    <Space direction="vertical" size={4}>
      <Space wrap size={4}>
        <Tag color={meta.color}>{meta.label}</Tag>
        <span style={{ color: "#8c8c8c", fontSize: 12 }}>
          {getPushSummaryText(summary)}
        </span>
      </Space>
      <span style={{ color: "#8c8c8c", fontSize: 12 }}>
        {formatPushLatestTime(summary)}
      </span>
      <Space size={4} wrap>
        <Button size="small" onClick={onOpenDetail}>
          查看明细
        </Button>
        <Button
          size="small"
          disabled={retryDisabled}
          loading={retryLoading}
          onClick={onRetry}
        >
          立即补推
        </Button>
      </Space>
    </Space>
  );
}
