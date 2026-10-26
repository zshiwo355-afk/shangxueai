import {
  EyeOutlined,
  GiftOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  actOnEmployeeLotteryLink,
  createEmployeeLotteryLink,
  getEmployeeLotteryLink,
  listEmployeeLotteryCampaigns,
  listEmployeeLotteryLinkActions,
  listEmployeeLotteryLinkDraws,
  listEmployeeLotteryLinks,
} from "../../lib/api.lottery.manage";
import { LOTTERY_PAGE_SIZE_OPTIONS, lotteryPageChange, lotteryPageFromResponse } from "./lottery-pagination-utils";
import { lotteryLinkProgressLabel, lotteryLinkRemaining as remainingOf, singleDrawLinkPayload } from "./lottery-single-draw-utils";
import LotteryShareModal from "./LotteryShareModal";
import "./lottery-workspace.css";

const { Paragraph, Text, Title } = Typography;

const STATUS_META = {
  active: { color: "success", label: "可抽奖" },
  disabled: { color: "default", label: "已停用" },
  expired: { color: "warning", label: "已过期" },
  exhausted: { color: "gold", label: "次数用完" },
};

function itemsOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function itemOf(value) {
  return value?.item || value;
}

function fmtTime(value) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—";
}

function campaignLabel(item) {
  if (!item) return "—";
  const status = {
    draft: "草稿", published: "进行中", not_started: "未开始", paused: "已暂停", ended: "已结束", deleted: "已删除 · 历史归档",
  }[item.effective_status || item.status] || "已发布";
  return `#${item.id} · ${item.title} · ${status}`;
}

function campaignReadOnly(item) {
  return !item || !!item.deleted_at || item.can_create_links === false
    || ["draft", "paused", "ended", "deleted"].includes(item.effective_status || item.status);
}

function linkStatus(row) {
  if (row?.status === "disabled") return "disabled";
  if (row?.expires_at && dayjs(row.expires_at).isBefore(dayjs())) return "expired";
  if (remainingOf(row) <= 0) return "exhausted";
  return row?.status || "active";
}

function LinkShareModal({ row, open, onClose }) {
  return <LotteryShareModal row={row} open={open} onClose={onClose} />;
}

function LinkRecordsDrawer({ row, open, onClose }) {
  const [tab, setTab] = useState("draws");
  const [drawLoading, setDrawLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [draws, setDraws] = useState([]);
  const [actions, setActions] = useState([]);
  const [drawPage, setDrawPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const [actionPage, setActionPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const [linkDetail, setLinkDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [recordsRefresh, setRecordsRefresh] = useState(0);
  const [drawError, setDrawError] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!open || !row?.id) return;
    let alive = true;
    setDetailLoading(true);
    setDetailError("");
    getEmployeeLotteryLink(row.id).then((data) => {
      if (alive) setLinkDetail(itemOf(data));
    }).catch((error) => {
      if (alive) { setLinkDetail(null); setDetailError(error?.message || "收货资料加载失败。"); }
    }).finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [open, row?.id, detailRefresh]);

  useEffect(() => {
    if (!open || !row?.id) return;
    let alive = true;
    setDrawLoading(true);
    setDrawError("");
    listEmployeeLotteryLinkDraws(row.id, { page: drawPage.current, page_size: drawPage.pageSize }).then((data) => {
      if (!alive) return;
      const next = lotteryPageFromResponse(data, drawPage.current, drawPage.pageSize);
      setDraws(next.current === drawPage.current ? next.items : []);
      setDrawPage({ current: next.current, pageSize: next.pageSize, total: next.total });
    }).catch((error) => {
      if (alive) {
        setDraws([]);
        setDrawError(error?.message || "抽奖记录加载失败，请重试。");
      }
    }).finally(() => {
      if (alive) setDrawLoading(false);
    });
    return () => { alive = false; };
  }, [open, row?.id, drawPage.current, drawPage.pageSize, recordsRefresh]);

  useEffect(() => {
    if (!open || !row?.id) return;
    let alive = true;
    setActionLoading(true);
    setActionError("");
    listEmployeeLotteryLinkActions(row.id, { page: actionPage.current, page_size: actionPage.pageSize }).then((data) => {
      if (!alive) return;
      const next = lotteryPageFromResponse(data, actionPage.current, actionPage.pageSize);
      setActions(next.current === actionPage.current ? next.items : []);
      setActionPage({ current: next.current, pageSize: next.pageSize, total: next.total });
    }).catch((error) => {
      if (alive) {
        setActions([]);
        setActionError(error?.message || "链接操作记录加载失败，请重试。");
      }
    }).finally(() => {
      if (alive) setActionLoading(false);
    });
    return () => { alive = false; };
  }, [open, row?.id, actionPage.current, actionPage.pageSize, recordsRefresh]);

  return (
    <Drawer
      width={720}
      open={open}
      onClose={onClose}
      title={`${row?.customer_name || "客户"} · 链接记录`}
      destroyOnClose
    >
      <Descriptions bordered size="small" column={2} className="lottery-record-summary">
        <Descriptions.Item label="已抽次数">{linkDetail?.chance_used ?? row?.chance_used ?? 0}</Descriptions.Item>
        <Descriptions.Item label="剩余次数">{remainingOf(linkDetail || row)}</Descriptions.Item>
        <Descriptions.Item label="客户编号">{row?.customer_code || "—"}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{fmtTime(row?.created_at)}</Descriptions.Item>
      </Descriptions>
      <div className="lottery-form-tip">
        <Space style={{ marginBottom: 8 }}><Text strong>兑奖方式 / 历史收货资料</Text><Button size="small" icon={<ReloadOutlined />} loading={detailLoading} onClick={() => setDetailRefresh((value) => value + 1)}>刷新资料</Button></Space>
        {detailLoading ? <Spin /> : detailError ? <Alert type="warning" showIcon message={detailError} /> : linkDetail?.receipt?.submitted ? <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="收件人">{linkDetail.receipt.recipient_name}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{linkDetail.receipt.recipient_phone}</Descriptions.Item>
          <Descriptions.Item label="收货地址"><Text style={{ overflowWrap: "anywhere" }}>{linkDetail.receipt.recipient_address}</Text></Descriptions.Item>
          <Descriptions.Item label="登记时间">{fmtTime(linkDetail.receipt.submitted_at)}</Descriptions.Item>
          <Descriptions.Item label="说明">历史已登记资料仅供归属员工和管理员查看；现在改为客户联系销售兑奖。</Descriptions.Item>
        </Descriptions> : <Alert type="info" showIcon message="客户截图中奖信息，联系销售人员兑奖" description="客户无需填写收货资料。请核对本链接的中奖记录和奖品数量，再安排兑奖。" />}
      </div>
      <Segmented
        block
        value={tab}
        onChange={setTab}
        options={[
          { value: "draws", label: `抽奖记录 ${drawPage.total}` },
          { value: "actions", label: `操作记录 ${actionPage.total}` },
        ]}
      />
      <Space style={{ marginTop: 12, marginBottom: 12 }}>
        <Button size="small" icon={<ReloadOutlined />} loading={tab === "draws" ? drawLoading : actionLoading} onClick={() => setRecordsRefresh((value) => value + 1)}>刷新记录</Button>
        {(tab === "draws" ? drawError : actionError) ? <Text type="danger">{tab === "draws" ? drawError : actionError}</Text> : null}
      </Space>
      {tab === "draws" ? (
        <Table
          rowKey={(item) => item.id || item.request_id}
          loading={drawLoading}
          dataSource={draws}
          pagination={{ ...drawPage, pageSizeOptions: LOTTERY_PAGE_SIZE_OPTIONS, showSizeChanger: true, showTotal: (total) => `共 ${total} 次` }}
          onChange={(next) => setDrawPage((prev) => lotteryPageChange(prev, next.current, next.pageSize))}
          locale={{ emptyText: <Empty description="客户还没有抽奖" /> }}
          columns={[
            { title: "序号", dataIndex: "draw_sequence", width: 76, render: (value, _, index) => value || index + 1 },
            { title: "结果", dataIndex: "prize_name_snapshot", render: (value, item) => <Tag color={item.result_type === "win" ? "gold" : "default"}>{value || item.prize_name || "未中奖"}</Tag> },
            { title: "抽奖时间", dataIndex: "created_at", width: 170, render: fmtTime },
            { title: "领奖", dataIndex: "claim_status", width: 100, render: (value, item) => value ? <Tag>{({ pending: "待联系", contacted: "已联系", fulfilled: "已发放", cancelled: "已取消" })[value] || value}</Tag> : item.result_type === "win" ? "待登记" : "—" },
          ]}
        />
      ) : (
        <Table
          rowKey={(item) => item.id || `${item.created_at}-${item.action}`}
          loading={actionLoading}
          dataSource={actions}
          pagination={{ ...actionPage, pageSizeOptions: LOTTERY_PAGE_SIZE_OPTIONS, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          onChange={(next) => setActionPage((prev) => lotteryPageChange(prev, next.current, next.pageSize))}
          locale={{ emptyText: <Empty description="暂无可见的操作记录" /> }}
          columns={[
            { title: "操作", dataIndex: "action", width: 110, render: (value) => ({ create: "创建", adjust: "调整次数", disable: "停用", enable: "启用" }[value] || value) },
            { title: "次数变化", render: (_, item) => `${item.before_chance_total ?? item.before_total ?? "—"} → ${item.after_chance_total ?? item.after_total ?? "—"}` },
            { title: "原因", dataIndex: "reason", ellipsis: true, render: (value) => value || "—" },
            { title: "时间", dataIndex: "created_at", width: 170, render: fmtTime },
          ]}
        />
      )}
    </Drawer>
  );
}

export default function LotteryLinkWorkspacePage() {
  const { message, modal } = AntdApp.useApp();
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createConfirming, setCreateConfirming] = useState(false);
  const createConfirmingRef = useRef(false);
  const [shareRow, setShareRow] = useState(null);
  const [recordRow, setRecordRow] = useState(null);
  const [createForm] = Form.useForm();
  const campaignRequestRef = useRef(0);
  const linkRequestRef = useRef(0);
  const submittedKeywordRef = useRef("");
  const activeCampaignRef = useRef(campaignId);
  activeCampaignRef.current = campaignId;

  const campaign = useMemo(
    () => campaigns.find((item) => String(item.id) === String(campaignId)),
    [campaignId, campaigns],
  );
  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;
  const campaignUnavailable = campaignReadOnly(campaign);

  const loadCampaigns = useCallback(async () => {
    const requestId = ++campaignRequestRef.current;
    try {
      const data = await listEmployeeLotteryCampaigns();
      if (requestId !== campaignRequestRef.current) return;
      const next = itemsOf(data);
      setCampaigns(next);
      setCampaignId((current) => next.some((item) => String(item.id) === String(current)) ? current : (next.find((item) => !campaignReadOnly(item)) || next[0])?.id);
    } catch (error) {
      if (requestId === campaignRequestRef.current) {
        if (!activeCampaignRef.current) setLoading(false);
        message.error(error?.message || "可用活动加载失败。");
      }
    }
  }, [message]);

  const loadLinks = useCallback(async (page = pagination.current, pageSize = pagination.pageSize) => {
    if (String(activeCampaignRef.current) !== String(campaignId)) return;
    const requestId = ++linkRequestRef.current;
    const isCurrent = () => requestId === linkRequestRef.current
      && String(activeCampaignRef.current) === String(campaignId);
    if (!campaignId) {
      setRows([]);
      setPagination((prev) => ({ ...prev, total: 0 }));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await listEmployeeLotteryLinks({
        campaign_id: campaignId,
        keyword: submittedKeywordRef.current,
        page,
        page_size: pageSize,
      });
      if (!isCurrent()) return;
      const next = lotteryPageFromResponse(data, page, pageSize);
      if (next.current !== page) return await loadLinks(next.current, pageSize);
      setRows(next.items);
      setPagination({ current: next.current, pageSize: next.pageSize, total: next.total });
    } catch (error) {
      if (isCurrent()) {
        setRows([]);
        setPagination((prev) => ({ ...prev, total: 0 }));
        message.error(error?.message || "客户链接加载失败。");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [campaignId, message, pagination.current, pagination.pageSize]);

  useEffect(() => {
    loadCampaigns();
    return () => { campaignRequestRef.current += 1; linkRequestRef.current += 1; };
  }, [loadCampaigns]);
  useEffect(() => {
    setRows([]);
    setShareRow(null);
    setRecordRow(null);
    setCreateOpen(false);
    setPagination((prev) => ({ ...prev, current: 1, total: 0 }));
    loadLinks(1, pagination.pageSize);
    return () => { linkRequestRef.current += 1; };
  }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!campaignUnavailable) return;
    setShareRow(null);
    if (!saving && !createConfirming) {
      setCreateOpen(false);
    }
  }, [campaignUnavailable, createConfirming, saving]);

  const selectCampaign = (value) => {
    activeCampaignRef.current = value;
    linkRequestRef.current += 1;
    setRows([]);
    setPagination((prev) => ({ ...prev, current: 1, total: 0 }));
    setShareRow(null);
    setRecordRow(null);
    setCreateOpen(false);
    setCampaignId(value);
  };

  const openCreate = () => {
    if (campaignReadOnly(campaignRef.current)) return;
    createForm.resetFields();
    createForm.setFieldsValue({ campaign_id: campaignId });
    setCreateOpen(true);
  };

  const createLink = async (values) => {
    if (String(activeCampaignRef.current) !== String(values.campaign_id) || campaignReadOnly(campaignRef.current)) {
      message.warning("活动或授权状态已变化，请刷新后确认，未生成链接。");
      return;
    }
    setSaving(true);
    try {
      const result = await createEmployeeLotteryLink(singleDrawLinkPayload({
        ...values,
        expires_at: values.expires_at ? values.expires_at.toISOString() : null,
      }));
      const saved = itemOf(result);
      if (String(activeCampaignRef.current) !== String(values.campaign_id)) return;
      setCreateOpen(false);
      await loadLinks(1, pagination.pageSize);
      if (String(activeCampaignRef.current) !== String(values.campaign_id)) return;
      setShareRow(saved);
      message.success("客户专属链接已生成。");
    } catch (error) {
      message.error(error?.message || "生成专属链接失败。");
      await loadCampaigns();
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const confirmCreateLink = async () => {
    if (saving || createConfirmingRef.current || campaignReadOnly(campaignRef.current)) return;
    createConfirmingRef.current = true;
    setCreateConfirming(true);
    try {
      const values = await createForm.validateFields();
      const customerName = String(values.customer_name || "").trim();
      const payload = singleDrawLinkPayload({
        ...values,
        customer_name: customerName,
      });

      modal.confirm({
        title: "请再次确认抽奖机会",
        width: 500,
        okText: "确认生成（1 次）",
        cancelText: "返回修改",
        content: (
          <div className="lottery-create-confirm">
            <Alert
              type="warning"
              showIcon
              message={`${customerName} 将获得 1 次抽奖机会`}
              description="每条专属链接只能成功抽奖一次，不能追加次数。请确认客户和活动无误后生成。"
            />
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="客户">{customerName}</Descriptions.Item>
              <Descriptions.Item label="抽奖机会"><Text strong className="lottery-create-confirm__chance">1 次</Text></Descriptions.Item>
              <Descriptions.Item label="活动">{campaignLabel(campaign)}</Descriptions.Item>
              <Descriptions.Item label="有效期">{values.expires_at ? fmtTime(values.expires_at) : "不超过活动有效期"}</Descriptions.Item>
            </Descriptions>
          </div>
        ),
        onOk: () => createLink(payload),
        afterClose: () => {
          createConfirmingRef.current = false;
          setCreateConfirming(false);
        },
      });
    } catch (error) {
      createConfirmingRef.current = false;
      setCreateConfirming(false);
      if (error?.errorFields) return;
      message.error(error?.message || "请检查客户信息。");
    }
  };

  const toggleLink = (row) => {
    if (saving || campaignReadOnly(campaignRef.current)) return;
    const disabling = linkStatus(row) !== "disabled";
    modal.confirm({
      title: disabling ? "停用这条专属链接？" : "重新启用这条专属链接？",
      content: disabling ? "客户将立即无法继续抽奖，历史抽奖记录不会被删除。" : "启用不会恢复已用机会；仅尚未抽过的链接可以抽奖一次。",
      okText: disabling ? "确认停用" : "确认启用",
      okButtonProps: disabling ? { danger: true } : {},
      onOk: async () => {
        if (String(activeCampaignRef.current) !== String(row.campaign_id) || campaignReadOnly(campaignRef.current)) {
          message.warning("活动或授权状态已变化，请刷新后重新操作。");
          return;
        }
        setSaving(true);
        try {
          await actOnEmployeeLotteryLink(row.id, { action: disabling ? "disable" : "enable", reason: disabling ? "员工手动停用" : "员工手动启用" });
          if (String(activeCampaignRef.current) !== String(row.campaign_id)) return;
          message.success(disabling ? "链接已停用。" : "链接已启用。");
          await loadLinks();
        } catch (error) {
          message.error(error?.message || "链接操作失败。");
          await loadCampaigns();
          throw error;
        } finally { setSaving(false); }
      },
    });
  };

  const visibleRows = rows.filter((row) => String(row.campaign_id) === String(campaignId));
  const totalRemaining = visibleRows.reduce((sum, row) => sum + remainingOf(row), 0);
  const wonCount = visibleRows.reduce((sum, row) => sum + Number(row.win_count || 0), 0);

  const columns = [
    {
      title: "客户",
      dataIndex: "customer_name",
      width: 190,
      render: (value, row) => (
        <div className="lottery-customer-cell">
          <Text strong>{value || "未命名客户"}</Text>
          <Text type="secondary">{row.customer_code || row.customer_note || "未填写编号"}</Text>
        </div>
      ),
    },
    {
      title: "状态",
      width: 96,
      render: (_, row) => {
        if (campaignUnavailable) return <Tag bordered={false}>仅可查记录</Tag>;
        if (campaign?.effective_status === "not_started") return <Tag bordered={false} color="processing">未开始</Tag>;
        const status = linkStatus(row);
        const meta = STATUS_META[status] || { color: "default", label: status };
        return <Tag bordered={false} color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "抽奖进度",
      width: 240,
      render: (_, row) => {
        const used = Number(row.chance_used || 0);
        return (
          <div className="lottery-progress-cell">
            <Progress percent={used > 0 ? 100 : 0} showInfo={false} size="small" />
            <Text type="secondary">{lotteryLinkProgressLabel(row)}</Text>
          </div>
        );
      },
    },
    { title: "中奖", dataIndex: "win_count", width: 80, render: (value) => `${value || 0} 次` },
    { title: "兑奖方式", width: 140, render: () => <Tag>联系销售兑奖</Tag> },
    { title: "有效期", dataIndex: "expires_at", width: 170, render: (value) => value ? fmtTime(value) : "长期有效" },
    { title: "创建时间", dataIndex: "created_at", width: 170, render: fmtTime },
    {
      title: "操作",
      fixed: "right",
      width: 250,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button size="small" type="primary" ghost icon={<LinkOutlined />} disabled={campaignUnavailable || saving || linkStatus(row) !== "active"} onClick={() => setShareRow(row)}>扫码分享</Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setRecordRow(row)}>记录</Button>
          <Button size="small" disabled={campaignUnavailable || saving} danger={linkStatus(row) !== "disabled"} icon={<PauseCircleOutlined />} onClick={() => toggleLink(row)}>
            {linkStatus(row) === "disabled" ? "启用" : "停用"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="lottery-workspace-page">
      <section className="lottery-workspace-hero">
        <div className="lottery-workspace-hero__copy">
          <span className="lottery-workspace-eyebrow">Customer Celebration</span>
          <Title level={2}>客户抽奖</Title>
          <Paragraph>为客户生成专属链接，每条链接只能抽奖一次。通过微信分享，并在这里追踪抽奖与兑奖结果。</Paragraph>
          {campaign ? <Paragraph>当前活动：{campaignLabel(campaign)}</Paragraph> : null}
        </div>
        <Button type="primary" size="large" icon={<PlusOutlined />} disabled={!campaignId || campaignUnavailable || saving || createConfirming} onClick={openCreate}>生成客户专属链接</Button>
      </section>

      {!campaigns.length && !loading ? (
        <Alert
          type="info"
          showIcon
          message="暂时没有可用活动"
          description="请联系管理员发布抽奖活动，并为你开通创建客户链接的权限。"
        />
      ) : null}
      {campaignUnavailable && campaign ? <Alert type="info" showIcon message="当前活动仅可查看历史记录" description="活动已暂停、结束或删除，不能继续生成、分享或调整链接。客户归属、抽奖结果和领奖进度仍可查看。" /> : null}

      <section className="lottery-workspace-summary">
        <Card bordered={false}><Statistic title="当前客户链接" value={pagination.total} suffix="条" prefix={<LinkOutlined />} /></Card>
        <Card bordered={false}><Statistic title="列表内剩余机会" value={totalRemaining} suffix="次" /></Card>
        <Card bordered={false}><Statistic title="列表内中奖" value={wonCount} suffix="次" prefix={<GiftOutlined />} /></Card>
      </section>

      <section className="lottery-workspace-surface">
        <div className="lottery-workspace-toolbar">
          <Space wrap>
            <Select
              value={campaignId}
              placeholder="选择抽奖活动"
              style={{ width: 380, maxWidth: "100%" }}
              showSearch
              optionFilterProp="label"
              disabled={saving || createConfirming}
              options={campaigns.map((item) => ({ value: item.id, label: campaignLabel(item) }))}
              onChange={selectCampaign}
            />
            <Input.Search
              allowClear
              value={keyword}
              placeholder="搜索客户名 / 编号"
              style={{ width: 260 }}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={() => { submittedKeywordRef.current = keyword.trim(); loadLinks(1, pagination.pageSize); }}
            />
          </Space>
          <Button icon={<ReloadOutlined />} disabled={saving || createConfirming} onClick={() => { loadCampaigns(); loadLinks(); }}>刷新</Button>
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={visibleRows}
          loading={loading}
          scroll={{ x: 1380 }}
          locale={{ emptyText: <Empty description={campaignId ? "还没有为客户生成专属链接" : "请先选择活动"} /> }}
          pagination={{ ...pagination, pageSizeOptions: LOTTERY_PAGE_SIZE_OPTIONS, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          onChange={(next) => {
            const requested = lotteryPageChange(pagination, next.current, next.pageSize);
            loadLinks(requested.current, requested.pageSize);
          }}
        />
      </section>

      <Modal
        open={createOpen}
        title="生成客户专属链接"
        okText="生成并扫码分享"
        cancelText="取消"
        confirmLoading={saving || createConfirming}
        okButtonProps={{ disabled: campaignUnavailable }}
        onOk={confirmCreateLink}
        onCancel={() => setCreateOpen(false)}
        cancelButtonProps={{ disabled: saving || createConfirming }}
        closable={!saving && !createConfirming}
        keyboard={!saving && !createConfirming}
        maskClosable={!saving && !createConfirming}
        destroyOnHidden
      >
        <Alert className="lottery-form-tip" type="info" showIcon message="每条链接固定 1 次抽奖机会，由服务端核销，抽完后不能追加。" />
        <Form form={createForm} layout="vertical" requiredMark="optional" disabled={saving || createConfirming || campaignUnavailable}>
          <Form.Item name="campaign_id" label="活动" rules={[{ required: true, message: "请选择活动" }]}>
            <Select disabled options={campaigns.map((item) => ({ value: item.id, label: campaignLabel(item) }))} />
          </Form.Item>
          <div className="lottery-form-grid">
            <Form.Item name="customer_name" label="客户姓名 / 称呼" rules={[{ required: true, message: "请输入客户姓名或称呼" }, { max: 100 }]}>
              <Input placeholder="例如：王先生" autoComplete="off" />
            </Form.Item>
            <Form.Item name="customer_code" label="客户编号">
              <Input placeholder="选填，便于内部检索" autoComplete="off" maxLength={100} />
            </Form.Item>
          </div>
          <div className="lottery-form-grid">
            <Form.Item label="抽奖机会"><Tag color="gold">每条链接固定 1 次</Tag></Form.Item>
            <Form.Item name="expires_at" label="链接有效期">
              <DatePicker showTime style={{ width: "100%" }} disabledDate={(date) => date?.endOf("day").isBefore(dayjs())} />
            </Form.Item>
          </div>
          <Form.Item name="customer_note" label="内部备注">
            <Input.TextArea maxLength={300} showCount rows={3} placeholder="仅员工和管理员可见" />
          </Form.Item>
        </Form>
      </Modal>

      <LinkShareModal row={shareRow} open={!!shareRow} onClose={() => setShareRow(null)} />
      <LinkRecordsDrawer key={recordRow?.id || "empty"} row={recordRow} open={!!recordRow} onClose={() => setRecordRow(null)} />
    </div>
  );
}
