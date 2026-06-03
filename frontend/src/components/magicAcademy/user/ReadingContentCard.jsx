import { UploadOutlined } from "@ant-design/icons";
import { Button, Card, Image, Space, Tag, Typography, Upload } from "antd";

const { Paragraph, Text } = Typography;

export default function ReadingContentCard({
  item,
  statusColor,
  canMakeup,
  makeupReason,
  onUploadRequest,
  onSubmitMakeup,
}) {
  return (
    <Card key={item.id} size="small">
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap>
          <Text strong>{item.title}</Text>
          <Tag bordered={false} color="blue">{item.reading_date}</Tag>
          <Tag bordered={false} color={statusColor}>
            {item.current_status || "未完成"}
          </Tag>
        </Space>
        {item.description ? <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph> : null}
        <Space wrap>
          <Text type="secondary">推送时间：{item.push_at?.replace("T", " ").slice(0, 19) || "—"}</Text>
          <Text type="secondary">补卡截止：{item.makeup_deadline_at?.replace("T", " ").slice(0, 19) || "—"}</Text>
        </Space>
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt={item.title}
            style={{ maxWidth: 420, borderRadius: 12 }}
            preview={{ src: item.image_url }}
          />
        ) : null}
        <Space wrap>
          <Upload
            showUploadList={false}
            customRequest={onUploadRequest}
          >
            <Button type="primary" icon={<UploadOutlined />} disabled={!item.can_submit}>
              {item.completed ? "已完成" : "提交本条打卡"}
            </Button>
          </Upload>
          {!item.completed && canMakeup ? (
            <Button onClick={onSubmitMakeup}>补交本条</Button>
          ) : null}
          {!item.can_submit && item.submit_disabled_reason ? (
            <Text type="secondary">{item.submit_disabled_reason}</Text>
          ) : null}
          {!item.completed && !item.can_submit && !item.submit_disabled_reason && makeupReason ? (
            <Text type="secondary">{makeupReason}</Text>
          ) : null}
        </Space>
      </Space>
    </Card>
  );
}
