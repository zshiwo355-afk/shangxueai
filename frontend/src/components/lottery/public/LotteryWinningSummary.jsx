import { CameraOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Modal } from "antd";

import LotteryPrizeImage from "./LotteryPrizeImage";

function SummaryContent({ summary, campaignTitle, customerName, complete, onRefresh, refreshing }) {
  return (
    <>
      <div className="lottery-winning-heading"><span>MY REWARDS</span><h2>{complete ? "我的中奖清单" : "已收获的好礼"}</h2><p>{campaignTitle}</p>{customerName ? <strong>{customerName} 的专属好礼</strong> : null}</div>
      {complete ? <div className="lottery-redemption-notice"><CameraOutlined /><div><strong>请截图中奖信息，联系销售人员兑奖</strong><p>无需填写收货信息。请将下方完整清单截图发给联系您的销售人员。</p></div></div> : <p className="lottery-winning-progress">还有抽奖机会，抽完后可截图完整中奖清单，联系销售人员兑奖。</p>}
      {!summary ? <Alert type="warning" showIcon message="完整中奖清单暂未同步" description="请刷新后再截图，避免漏掉奖品。不会改变您的中奖结果。" action={<Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>刷新</Button>} /> : summary.items.length ? (
        <>
          <div className="lottery-winning-total"><span>累计中奖</span><strong>{summary.total_wins}<small> 件好礼</small></strong></div>
          <div className="lottery-winning-list">{summary.items.map((item, index) => <div key={`${item.prize_id}-${index}`}><div className="lottery-winning-list__image"><LotteryPrizeImage prize={item} /></div><strong>{item.prize_name}</strong><span>× {item.quantity}</span></div>)}</div>
        </>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本链接暂无中奖商品，请联系销售人员确认活动记录。" />}
      <p className="lottery-winning-footnote">本清单包含本链接全部中奖记录，具体兑奖以系统记录为准。</p>
    </>
  );
}

export default function LotteryWinningSummary({ mode, summary, campaignTitle, customerName, open, onOpen, onClose, onRefresh, refreshing }) {
  if (mode === "hidden") return null;
  const complete = mode === "complete";
  const contentProps = { summary, campaignTitle, customerName, complete, onRefresh, refreshing };
  return (
    <>
      <section className="lottery-winning-card" aria-label="完整中奖清单与兑奖说明">
        <SummaryContent {...contentProps} />
        {complete ? <Button block icon={<CameraOutlined />} onClick={onOpen}>查看截图兑奖清单</Button> : null}
      </section>
      <Modal open={open && complete} onCancel={onClose} footer={null} width={460} centered rootClassName="lottery-redemption-modal" destroyOnHidden>
        <SummaryContent {...contentProps} />
        <Button type="primary" size="large" block onClick={onClose}>我知道了，截图联系销售兑奖</Button>
      </Modal>
    </>
  );
}
