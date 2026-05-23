import {
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Button, Image, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { buildMaterialAssetPreviewUrl } from "../../lib/api.materials";

const { Text, Paragraph, Title } = Typography;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "m4v", "ogv"]);
const AUDIO_EXTS = new Set(["mp3", "m4a", "wav", "aac", "ogg", "amr", "flac"]);
const PDF_EXTS = new Set(["pdf"]);
const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "log", "csv", "tsv",
  "yml", "yaml", "html", "htm", "xml",
  "js", "jsx", "ts", "tsx", "css", "scss", "py", "java", "go", "rs", "c", "cpp", "h", "hpp", "sh", "sql",
]);
const OFFICE_EXTS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

function getExtension(name) {
  const text = String(name || "");
  const dot = text.lastIndexOf(".");
  if (dot < 0) return "";
  return text.slice(dot + 1).toLowerCase();
}

function detectMode(asset) {
  const ext = getExtension(asset?.file_name) || getExtension(asset?.name);
  if (asset?.asset_type === "image" || IMAGE_EXTS.has(ext)) return "image";
  if (asset?.asset_type === "video" || VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (PDF_EXTS.has(ext)) return "pdf";
  if (TEXT_EXTS.has(ext)) return "text";
  if (OFFICE_EXTS.has(ext)) return "office";
  return "other";
}

function ModeIcon({ mode }) {
  if (mode === "image") return <FileImageOutlined />;
  if (mode === "video" || mode === "audio") return <VideoCameraOutlined />;
  if (mode === "pdf" || mode === "text") return <FileTextOutlined />;
  return <FileOutlined />;
}

function TextPreview({ url }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((value) => {
        if (cancelled) return;
        setText(value.length > 200_000 ? `${value.slice(0, 200_000)}\n\n…（文件过大，仅显示前 200KB）` : value);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "文本读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <div className="material-preview__loading">
        <Spin />
      </div>
    );
  }
  if (error) return <Text type="danger">文本读取失败：{error}</Text>;
  return (
    <pre className="material-preview__code">{text}</pre>
  );
}

export default function MaterialAssetPreview({ asset, url }) {
  if (!asset || !url) return null;
  const mode = detectMode(asset);
  const downloadUrl = buildMaterialAssetPreviewUrl(asset.id, { download: true });

  if (mode === "image") {
    return (
      <div className="material-preview material-preview--image">
        <Image
          src={url}
          alt={asset.name || asset.file_name}
          preview={{ mask: "点击放大查看" }}
          style={{ maxWidth: "100%", maxHeight: "82vh", objectFit: "contain" }}
        />
      </div>
    );
  }

  if (mode === "video") {
    return (
      <video
        className="material-preview__video"
        src={url}
        controls
        style={{ width: "100%", maxHeight: "82vh", borderRadius: 12, background: "#000" }}
      />
    );
  }

  if (mode === "audio") {
    return (
      <div className="material-preview material-preview--audio">
        <Title level={5} style={{ margin: 0 }}>{asset.name || asset.file_name}</Title>
        <audio src={url} controls style={{ width: "100%" }} />
        <Text type="secondary">{asset.file_name}</Text>
      </div>
    );
  }

  if (mode === "pdf") {
    return (
      <iframe
        title={asset.name || asset.file_name}
        src={url}
        className="material-preview__pdf"
        style={{ width: "100%", height: "82vh", border: "none", borderRadius: 12, background: "#fff" }}
      />
    );
  }

  if (mode === "text") {
    return <TextPreview url={url} />;
  }

  return (
    <div className="material-preview material-preview--fallback">
      <ModeIcon mode={mode} />
      <Title level={5} style={{ margin: 0 }}>{asset.name || asset.file_name}</Title>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {mode === "office"
          ? "Office 文档不支持在浏览器内直接预览，请下载后查看。"
          : "当前文件类型暂不支持在线预览。"}
      </Paragraph>
      <Space>
        <Button type="primary" icon={<DownloadOutlined />} href={downloadUrl} target="_blank" rel="noreferrer">
          下载文件
        </Button>
        <Button href={url} target="_blank" rel="noreferrer">
          在新标签打开
        </Button>
      </Space>
    </div>
  );
}

