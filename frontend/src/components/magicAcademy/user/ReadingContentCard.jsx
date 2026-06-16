import { AudioOutlined, FileImageOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Card, Image, Space, Tag, Typography, Upload } from "antd";
import { useRef, useState } from "react";

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
  actionRef,
  onSubmit,
  onSubmitMakeup,
}) {
  const [audioFile, setAudioFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const actionRowRef = useRef(null);
  const lastImageTapAtRef = useRef(0);

  const hasSelection = !!audioFile || !!imageFile;

  const setActionRowNode = (node) => {
    actionRowRef.current = node;
    if (actionRef) actionRef.current = node;
  };

  const revealActionButton = () => {
    const scroll = () => {
      actionRowRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(scroll);
      return;
    }
    setTimeout(scroll, 0);
  };

  const openImagePreview = () => {
    setPreviewOpen(true);
  };

  const handleImageTap = () => {
    const now = Date.now();
    if (now - lastImageTapAtRef.current <= 360) {
      lastImageTapAtRef.current = 0;
      openImagePreview();
      return;
    }
    lastImageTapAtRef.current = now;
  };

  const handleImageKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openImagePreview();
    }
  };

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
    <Card key={item.id} size="small" className="reading-content-card">
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap className="reading-content-card__header">
          <Text strong>{item.title}</Text>
          <Tag bordered={false} color="blue">{item.reading_date}</Tag>
          <Tag bordered={false} color={statusColor}>
            {item.current_status || "未完成"}
          </Tag>
        </Space>
        {item.description ? <Paragraph style={{ marginBottom: 0 }}>{item.description}</Paragraph> : null}
        <Space wrap className="reading-content-card__meta">
          <Text type="secondary">推送时间：{item.push_at?.replace("T", " ").slice(0, 19) || "—"}</Text>
          <Text type="secondary">补卡截止：{item.makeup_deadline_at?.replace("T", " ").slice(0, 19) || "—"}</Text>
        </Space>
        {item.image_url ? (
          <div
            className="reading-content-card__image-frame"
            role="button"
            tabIndex={0}
            aria-label="双击放大读书材料图片"
            onClick={handleImageTap}
            onDoubleClick={openImagePreview}
            onKeyDown={handleImageKeyDown}
          >
            <Image
              src={item.image_url}
              alt={item.title}
              preview={false}
              classNames={{
                root: "reading-content-card__image-root",
                image: "reading-content-card__image",
              }}
              styles={{
                root: { width: "100%", maxWidth: "100%" },
                image: {
                  width: "100%",
                  maxWidth: "100%",
                  height: "100%",
                  borderRadius: 12,
                  objectFit: "cover",
                  objectPosition: "top center",
                },
              }}
            />
            <span className="reading-content-card__image-hint">双击放大</span>
            <Image
              src={item.image_url}
              alt={item.title}
              styles={{
                root: { display: "none" },
                image: { display: "none" },
              }}
              preview={{
                src: item.image_url,
                open: previewOpen,
                onOpenChange: setPreviewOpen,
              }}
            />
          </div>
        ) : null}
        {!item.completed ? (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Space wrap className="reading-content-card__pickers">
              <Upload
                showUploadList={false}
                accept={AUDIO_ACCEPT}
                maxCount={1}
                beforeUpload={(file) => {
                  setAudioFile(file);
                  revealActionButton();
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
                  revealActionButton();
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
        <div ref={setActionRowNode} className="reading-content-card__submit-actions">
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
        </div>
      </Space>
    </Card>
  );
}
