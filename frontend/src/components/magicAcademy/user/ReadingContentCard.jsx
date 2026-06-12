import { AudioOutlined, FileImageOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Card, Image, Space, Tag, Typography, Upload } from "antd";
import { useState } from "react";

const { Paragraph, Text } = Typography;

// iOS Safari 会按 accept 列表匹配文件 UTI，匹配不上的文件直接置灰禁选；
// 混合"扩展名 + MIME"时解析有 bug，常把语音备忘录导出的 m4a 也一起灰掉
//（表现为「能看见文件但点不动」）。iOS 上索性不限制，靠后端扩展名校验兜底。
const IS_IOS = typeof navigator !== "undefined"
  && (/iP(hone|ad|od)/.test(navigator.userAgent || "")
    // iPadOS 13+ 默认请求桌面站点，UA 里没有 iPad，用触摸点数 + Mac 识别
    || (/Macintosh/.test(navigator.userAgent || "") && typeof document !== "undefined" && "ontouchend" in document));
const AUDIO_ACCEPT = IS_IOS ? undefined : ".mp3,.m4a,.wav,.aac,.amr,.caf,.ogg,.webm,audio/*";

export default function ReadingContentCard({
  item,
  statusColor,
  canMakeup,
  makeupReason,
  onSubmit,
  onSubmitMakeup,
}) {
  const [audioFile, setAudioFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const hasSelection = !!audioFile || !!imageFile;

  const handleSubmit = async () => {
    if (!hasSelection || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit?.({ audioFile, imageFile });
      setAudioFile(null);
      setImageFile(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMakeup = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmitMakeup?.({ audioFile, imageFile });
      setAudioFile(null);
      setImageFile(null);
    } finally {
      setSubmitting(false);
    }
  };

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
        {!item.completed ? (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Space wrap>
              <Upload
                showUploadList={false}
                accept={AUDIO_ACCEPT}
                maxCount={1}
                beforeUpload={(file) => {
                  setAudioFile(file);
                  return false;
                }}
              >
                <Button icon={<AudioOutlined />} disabled={!item.can_submit && !canMakeup}>
                  {audioFile ? "重新选择录音" : "选择录音"}
                </Button>
              </Upload>
              <Upload
                showUploadList={false}
                accept="image/*"
                maxCount={1}
                beforeUpload={(file) => {
                  setImageFile(file);
                  return false;
                }}
              >
                <Button icon={<FileImageOutlined />} disabled={!item.can_submit && !canMakeup}>
                  {imageFile ? "重新选择图片" : "选择图片"}
                </Button>
              </Upload>
            </Space>
            {audioFile ? <Text type="secondary">录音：{audioFile.name}</Text> : null}
            {imageFile ? <Text type="secondary">图片：{imageFile.name}</Text> : null}
            <Text type="secondary">录音和图片至少提交一项。</Text>
          </Space>
        ) : null}
        <Space wrap>
          {item.completed ? (
            <Button type="primary" disabled>已完成</Button>
          ) : (
            <Button
              type="primary"
              icon={<UploadOutlined />}
              loading={submitting}
              disabled={!item.can_submit || !hasSelection}
              onClick={handleSubmit}
            >
              提交本条打卡
            </Button>
          )}
          {!item.completed && canMakeup ? (
            <Button loading={submitting} disabled={!hasSelection} onClick={handleMakeup}>补交本条</Button>
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
