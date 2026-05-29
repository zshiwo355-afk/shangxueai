import {
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Alert, Button, Image, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  getMaterialAssetSignedUrl,
  triggerMaterialDownload,
} from "../../lib/api.materials";

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

/**
 * Office documents (.doc/.docx/.xls/.xlsx/.ppt/.pptx) can't be rendered
 * natively in the browser. We hand the OSS signed URL to Microsoft's
 * Office Online Viewer (https://view.officeapps.live.com), which renders
 * the document on their servers and serves it back to us as an HTML view.
 *
 * Caveats users may hit:
 *   - the file must be reachable from Microsoft's servers (signed OSS
 *     URLs are public via signature, so this is fine);
 *   - viewer fails on files >~25MB and on unusual formats (pages give a
 *     vague error). We surface a download fallback in those cases.
 */
function OfficePreview({ asset }) {
  const [signedUrl, setSignedUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSignedUrl("");
    getMaterialAssetSignedUrl(asset.id)
      .then((data) => {
        if (cancelled) return;
        setSignedUrl(data?.url || "");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "获取预览地址失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  if (loading) {
    return (
      <div className="material-preview__loading">
        <Spin />
      </div>
    );
  }
  if (error || !signedUrl) {
    return <Text type="danger">预览地址加载失败：{error || "请稍后再试"}</Text>;
  }
  const viewerSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Alert
        type="info"
        showIcon
        message="Word / Excel / PPT 由微软 Office Online 渲染，约需 3–8 秒；超过 25MB 或复杂格式可能加载失败，可点右下角下载查看。"
      />
      <iframe
        title={asset.name || asset.file_name}
        src={viewerSrc}
        className="material-preview__office"
        style={{ width: "100%", height: "78vh", border: "none", borderRadius: 12, background: "#fff" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button icon={<DownloadOutlined />} onClick={() => triggerMaterialDownload(asset.id)}>
          下载文件
        </Button>
      </div>
    </div>
  );
}

export default function MaterialAssetPreview({ asset, url }) {
  if (!asset || !url) return null;
  const mode = detectMode(asset);

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
        poster={asset.cover_url || undefined}
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

  if (mode === "office") {
    return <OfficePreview asset={asset} />;
  }

  return (
    <div className="material-preview material-preview--fallback">
      <ModeIcon mode={mode} />
      <Title level={5} style={{ margin: 0 }}>{asset.name || asset.file_name}</Title>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        当前文件类型暂不支持在线预览。
      </Paragraph>
      <Space>
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => triggerMaterialDownload(asset.id)}>
          下载文件
        </Button>
        <Button href={url} target="_blank" rel="noreferrer">
          在新标签打开
        </Button>
      </Space>
    </div>
  );
}
