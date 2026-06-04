import { useEffect, useState } from "react";
import { Avatar, Button, Empty, Spin, Tag, Typography } from "antd";
import { ArrowLeftOutlined, UserOutlined } from "@ant-design/icons";
import { fetchEnabledMentors } from "./mentorApi";

const { Paragraph } = Typography;

export default function MentorDirectoryPage({ onBack }) {
  const [mentors, setMentors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEnabledMentors()
      .then((list) => {
        if (!cancelled) setMentors(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "导师列表加载失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mentor-directory">
      <div className="mentor-directory__header">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回首页
        </Button>
        <h2 className="mentor-directory__title">导师专区</h2>
        <p className="mentor-directory__subtitle">全部启用导师</p>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin size="large" />
        </div>
      ) : error ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={error}
        >
          <Button onClick={onBack}>返回首页</Button>
        </Empty>
      ) : mentors.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无导师信息"
        >
          <Button onClick={onBack}>返回首页</Button>
        </Empty>
      ) : (
        <div className="mentor-directory__grid">
          {mentors.map((m) => (
            <MentorFullCard key={m.id} mentor={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MentorFullCard({ mentor }) {
  const tags = (mentor.expertise_tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <div className="mentor-card mentor-card--full">
      <Avatar
        size={72}
        src={mentor.avatar_url || undefined}
        icon={!mentor.avatar_url ? <UserOutlined /> : undefined}
        className="mentor-card__avatar"
      />
      <div className="mentor-card__body">
        <strong className="mentor-card__name">{mentor.display_name}</strong>
        {mentor.title && (
          <span className="mentor-card__title">{mentor.title}</span>
        )}
        {mentor.tagline && (
          <Paragraph
            className="mentor-card__tagline"
            ellipsis={{ rows: 3 }}
          >
            {mentor.tagline}
          </Paragraph>
        )}
        {mentor.bio && (
          <Paragraph
            className="mentor-card__bio"
            ellipsis={{ rows: 4 }}
          >
            {mentor.bio}
          </Paragraph>
        )}
        {tags.length > 0 && (
          <div className="mentor-card__tags">
            {tags.map((tag) => (
              <Tag key={tag} color="blue">{tag}</Tag>
            ))}
          </div>
        )}
        {mentor.years_experience > 0 && (
          <span className="mentor-card__meta">
            {mentor.years_experience} 年经验
          </span>
        )}
      </div>
    </div>
  );
}
