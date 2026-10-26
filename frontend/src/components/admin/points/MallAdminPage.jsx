import { Tabs } from "antd";
import { MallGrantsTab, MallProductsTab, MallRedemptionsTab } from "./MallAdminTabs";

export default function MallAdminPage() {
  return (
    <Tabs
      defaultActiveKey="mall-points"
      items={[
        { key: "mall-points", label: "商城积分", children: <MallGrantsTab /> },
        { key: "mall-products", label: "商品管理", children: <MallProductsTab /> },
        { key: "mall-redemptions", label: "兑换记录", children: <MallRedemptionsTab /> },
      ]}
      destroyInactiveTabPane
    />
  );
}
