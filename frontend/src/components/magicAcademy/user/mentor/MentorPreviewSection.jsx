import { useEffect, useState } from "react";
import { Avatar, Button, Modal, Spin, Tag } from "antd";
import { RightOutlined, UserOutlined } from "@ant-design/icons";
import { fetchEnabledMentors } from "./mentorApi";

const PREVIEW_COUNT = 4;

export default function MentorPreviewSection({ onViewAll, compact = false }) {
  const [mentors, setMentors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedMentor, setSelectedMentor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEnabledMentors()
      .then((list) => {
        if (!cancelled) setMentors(list);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (error || (!loading && mentors.length === 0)) return null;

  const previewList = mentors.slice(0, PREVIEW_COUNT);
  const hasMore = mentors.length > PREVIEW_COUNT;

  if (compact) {
    return (
      <div className="mentor-carousel-wrap fade-in-up" style={{ "--fade-delay": "380ms" }}>
        <div className="mentor-carousel-wrap__header">
          <span className="showcase-eyebrow" style={{ margin: 0 }}>Mentors</span>
          <Button type="link" onClick={onViewAll}>
            {hasMore ? "查看全部" : "导师专区"} <RightOutlined />
          </Button>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}><Spin /></div>
        ) : previewList.length <= 1 ? (
          <div className="mentor-marquee mentor-marquee--static">
            <div className="mentor-marquee__track">
              {previewList.map((m) => (
                <MentorShowCard key={m.id} mentor={m} onClick={() => setSelectedMentor(m)} />
              ))}
            </div>
          </div>
        ) : (
          <div className="mentor-marquee">
            <div
              className="mentor-marquee__track"
              style={{ animationDuration: `${previewList.length * 8}s` }}
            >
              {previewList.map((m) => (
                <MentorShowCard key={m.id} mentor={m} onClick={() => setSelectedMentor(m)} />
              ))}
              {previewList.map((m) => (
                <MentorShowCard key={`dup-${m.id}`} mentor={m} onClick={() => setSelectedMentor(m)} />
              ))}
            </div>
          </div>
        )}
        <MentorDetailModal mentor={selectedMentor} onClose={() => setSelectedMentor(null)} />
      </div>
    );
  }

  const displayList = mentors;

  return (
    <section className="showcase-section fade-in-up" style={{ "--fade-delay": "440ms" }}>
      <div className="showcase-section__header">
        <span className="showcase-eyebrow">Mentors</span>
        <h2 className="showcase-title" style={{ fontSize: 32, marginBottom: 0 }}>导师专区</h2>
        <p className="showcase-lead">向优秀导师学习，获取专业指导与成长建议。</p>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Spin />
        </div>
      ) : (
        <div className="mentor-carousel-static">
          {displayList.map((m) => (
            <MentorShowCard key={m.id} mentor={m} onClick={() => setSelectedMentor(m)} />
          ))}
        </div>
      )}
      <MentorDetailModal mentor={selectedMentor} onClose={() => setSelectedMentor(null)} />
    </section>
  );
}

function MentorShowCard({ mentor, onClick }) {
  return (
    <div className="mentor-show-card" onClick={onClick} style={{ cursor: "pointer" }}>
      <div className="mentor-show-card__photo">
        {mentor.avatar_url ? (
          <img src={mentor.avatar_url} alt={mentor.display_name} />
        ) : (
          <Avatar size={120} icon={<UserOutlined />} />
        )}
      </div>
      <div className="mentor-show-card__info">
        <strong className="mentor-show-card__name">{mentor.display_name}</strong>
        {mentor.title && <span className="mentor-show-card__title">{mentor.title}</span>}
        {mentor.tagline && <span className="mentor-show-card__tagline">{mentor.tagline}</span>}
      </div>
    </div>
  );
}

function MentorDetailModal({ mentor, onClose }) {
  if (!mentor) return null;
  const tags = mentor.expertise_tags
    ? mentor.expertise_tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return (
    <Modal
      open={!!mentor}
      onCancel={onClose}
      footer={null}
      width={640}
      centered
      destroyOnClose
    >
      <div className="mentor-detail">
        <div className="mentor-detail__header">
          <div className="mentor-detail__avatar">
            {mentor.avatar_url ? (
              <img src={mentor.avatar_url} alt={mentor.display_name} />
            ) : (
              <Avatar size={160} icon={<UserOutlined />} />
            )}
          </div>
          <div className="mentor-detail__intro">
            <h2 style={{ margin: 0, fontSize: 24 }}>{mentor.display_name}</h2>
            {mentor.title && <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 15 }}>{mentor.title}</p>}
            {mentor.tagline && <p style={{ margin: "8px 0 0", fontSize: 14 }}>{mentor.tagline}</p>}
            {mentor.years_experience > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>从业 {mentor.years_experience} 年</p>
            )}
          </div>
        </div>
        {tags.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {tags.map((tag) => (
              <Tag key={tag} color="blue" style={{ marginBottom: 6 }}>{tag}</Tag>
            ))}
          </div>
        )}
        {mentor.bio && (
          <div className="mentor-detail__bio">
            <h4 style={{ marginBottom: 8 }}>个人简介</h4>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, margin: 0 }}>{mentor.bio}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
