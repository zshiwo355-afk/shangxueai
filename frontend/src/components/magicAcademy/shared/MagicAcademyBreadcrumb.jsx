import { ArrowLeftOutlined } from "@ant-design/icons";
import { Typography } from "antd";

const { Title } = Typography;

export default function MagicAcademyBreadcrumb({
  title,
  subtitle,
  onBack,
  backText = "返回课程管理",
}) {
  return (
    <div className="magic-academy-crumb fade-in-up">
      <button type="button" className="magic-academy-crumb__back" onClick={onBack}>
        <ArrowLeftOutlined />
        <span>{backText}</span>
      </button>
      <div className="magic-academy-crumb__title">
        <Title level={2} className="showcase-title" style={{ margin: 0, fontSize: 26 }}>{title}</Title>
        {subtitle ? <p className="showcase-lead" style={{ margin: 0 }}>{subtitle}</p> : null}
      </div>
    </div>
  );
}
