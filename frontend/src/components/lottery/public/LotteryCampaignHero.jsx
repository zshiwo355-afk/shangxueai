import { Tag, Typography } from "antd";
import { useState } from "react";

const { Paragraph, Title } = Typography;

export default function LotteryCampaignHero({ campaign, customerName }) {
  const [failedImage, setFailedImage] = useState("");
  const imageUrl = campaign.hero_image_url || "";
  const title = campaign.title?.trim() || "转动好运，收获好礼";
  const description = campaign.description?.trim() || "";
  const showDescription = description && description.replace(/\s/g, "") !== title.replace(/\s/g, "");

  return (
    <>
      {imageUrl && imageUrl !== failedImage ? (
        <div className="lottery-hero__media">
          <img
            src={imageUrl}
            alt={`${title}活动主题图`}
            loading="eager"
            fetchPriority="high"
            onError={() => setFailedImage(imageUrl)}
          />
        </div>
      ) : null}
      <div className="lottery-hero__content">
        <div className="lottery-hero__meta">
          <div className="lottery-hero__brand"><span>11.11</span><i />客户专属好礼</div>
          {customerName ? <Tag bordered={false}>致 {customerName} 的专属好礼</Tag> : null}
        </div>
        <Title>{title}</Title>
        {showDescription ? <Paragraph>{description}</Paragraph> : null}
      </div>
    </>
  );
}
