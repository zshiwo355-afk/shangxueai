import {
  AuditOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  GiftOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
  TrophyOutlined,
  UploadOutlined,
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
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { adminListUsers, adminSearchUsers } from "../../../lib/api.admin";
import {
  actOnAdminLotteryLink,
  changeAdminLotteryCampaignStatus,
  changeAdminLotteryClaimStatus,
  changeAdminLotteryPrizeStatus,
  createAdminLotteryCampaign,
  createAdminLotteryPrize,
  deleteAdminLotteryCampaign,
  getAdminLotteryCampaign,
  getEmployeeLotteryLink,
  listAdminLotteryCampaigns,
  listAdminLotteryClaims,
  listAdminLotteryDraws,
  listAdminLotteryAuditLogs,
  listAdminLotteryLinkActions,
  listAdminLotteryLinks,
  listAdminLotteryStaff,
  saveAdminLotteryStaff,
  updateAdminLotteryCampaign,
  updateAdminLotteryPrize,
  updateAdminLotteryProbabilities,
  uploadAdminLotteryImage,
} from "../../../lib/api.lottery.manage";
import { buildMaterialAssetPreviewUrl } from "../../../lib/api.materials";
import DepartmentUserTreeSelect from "../../common/DepartmentUserTreeSelect";
import MaterialAssetPickerModal from "../../common/MaterialAssetPickerModal";
import LotteryShareModal from "../../lottery/LotteryShareModal";
import { lotteryLinkProgressLabel, lotteryLinkRemaining as remainingOf } from "../../lottery/lottery-single-draw-utils";
import { claimEditableStatuses, claimLinkRecord, hasClaimReceipt, lotteryPrizeConfig, preferredCampaignId, probabilityPercentToPpm } from "./lottery-admin-utils";
import { LOTTERY_PAGE_OPTIONS, loadAllLotteryCampaigns, loadLotteryPage, lotteryPageRequest } from "./lottery-pagination";
import { addStaffUsers, applyStaffEnabled, normalizeStaffSelection, selectableStaffIds, staffPermissionPayload } from "./lottery-staff-utils";
import { prizeEditPayload, prizeEditSnapshot } from "./lottery-prize-edit-utils";
import "./lottery-admin.css";

const { Paragraph, Text, Title } = Typography;
const { RangePicker } = DatePicker;

const CAMPAIGN_STATUS = {
  draft: { label: "草稿", color: "default" },
  published: { label: "已发布", color: "success" },
  paused: { label: "已暂停", color: "warning" },
  ended: { label: "已结束", color: "default" },
  deleted: { label: "已删除 · 历史归档", color: "default" },
};

const CLAIM_STATUS = {
  pending: { label: "待联系", color: "warning" },
  contacted: { label: "已联系", color: "processing" },
  fulfilled: { label: "已发放", color: "success" },
  cancelled: { label: "已取消", color: "default" },
};

const PRIZE_TYPES = [
  { value: "physical", label: "实物奖品" },
  { value: "coupon", label: "权益 / 券" },
];

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

function statusTag(status) {
  const meta = CAMPAIGN_STATUS[status] || { label: status || "未知", color: "default" };
  return <Tag bordered={false} color={meta.color}>{meta.label}</Tag>;
}

function claimTag(status) {
  const meta = CLAIM_STATUS[status] || { label: status || "未知", color: "default" };
  return <Tag bordered={false} color={meta.color}>{meta.label}</Tag>;
}

function imageOf(row) {
  if (row?.image_url) return row.image_url;
  if (row?.image_material_asset_id) return buildMaterialAssetPreviewUrl(row.image_material_asset_id);
  return "";
}

function campaignImage(row, kind) {
  const urlKey = kind === "hero" ? "hero_image_url" : "share_image_url";
  const assetKey = kind === "hero" ? "hero_image_material_asset_id" : "share_image_material_asset_id";
  if (row?.[urlKey]) return row[urlKey];
  return row?.[assetKey] ? buildMaterialAssetPreviewUrl(row[assetKey]) : "";
}

function LotteryImageField({ form, kind, label }) {
  const { message } = AntdApp.useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const urlName = kind === "prize" ? "image_url" : `${kind}_image_url`;
  const objectName = kind === "prize" ? "image_object_key" : `${kind}_image_object_key`;
  const assetName = kind === "prize" ? "image_material_asset_id" : `${kind}_image_material_asset_id`;
  const url = Form.useWatch(urlName, form);
  const assetId = Form.useWatch(assetName, form);
  const preview = url || (assetId ? buildMaterialAssetPreviewUrl(assetId) : "");

  const uploadLocalImage = async (file) => {
    const normalizedType = String(file?.type || "").toLowerCase();
    const normalizedName = String(file?.name || "").toLowerCase();
    const supported = ["image/jpeg", "image/png", "image/webp"].includes(normalizedType)
      || /\.(jpe?g|png|webp)$/.test(normalizedName);
    if (!supported) {
      message.warning("仅支持 JPG、PNG、WEBP 图片。");
      return Upload.LIST_IGNORE;
    }
    if (Number(file?.size || 0) > 10 * 1024 * 1024) {
      message.warning("图片不能超过 10MB。");
      return Upload.LIST_IGNORE;
    }
    try {
      setUploading(true);
      const result = await uploadAdminLotteryImage(file);
      const uploaded = result?.item || result;
      const imageUrl = uploaded?.url || uploaded?.image_url || "";
      const objectKey = uploaded?.object_key || uploaded?.image_object_key || "";
      if (!imageUrl) throw new Error("上传完成，但没有获得图片地址。");
      form.setFieldsValue({
        [urlName]: imageUrl,
        [objectName]: objectKey,
        [assetName]: null,
      });
      message.success(`${label}上传成功。`);
    } catch (error) {
      message.error(error?.message || `${label}上传失败。`);
    } finally {
      setUploading(false);
    }
    return Upload.LIST_IGNORE;
  };

  return (
    <div className="lottery-image-field">
      <div className="lottery-image-field__preview">
        {preview ? <img src={preview} alt="" /> : <GiftOutlined />}
      </div>
      <div className="lottery-image-field__fields">
        <Form.Item label={label} name={urlName}>
          <Input
            placeholder="可直接填写 HTTPS 图片地址"
            disabled={uploading}
            onChange={() => {
              if (form.getFieldValue(objectName) || form.getFieldValue(assetName)) {
                form.setFieldsValue({ [objectName]: "", [assetName]: null });
              }
            }}
          />
        </Form.Item>
        <Space wrap className="lottery-image-field__actions">
          <Upload
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            beforeUpload={uploadLocalImage}
            showUploadList={false}
            disabled={uploading}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              {uploading ? "正在上传" : "从本地上传"}
            </Button>
          </Upload>
          <Button disabled={uploading} onClick={() => setPickerOpen(true)}>从素材库选择</Button>
          {assetId ? <Tag color="blue">素材 #{assetId}</Tag> : null}
          {(url || assetId) ? (
            <Button
              type="link"
              danger
              disabled={uploading}
              onClick={() => form.setFieldsValue({ [urlName]: "", [objectName]: "", [assetName]: null })}
            >
              清除图片
            </Button>
          ) : null}
        </Space>
        <Text type="secondary" className="lottery-image-field__hint">支持 JPG、PNG、WEBP，单张最大 10MB。</Text>
        <Form.Item name={objectName} hidden><Input /></Form.Item>
        <Form.Item name={assetName} hidden><InputNumber /></Form.Item>
      </div>
      <MaterialAssetPickerModal
        open={pickerOpen}
        onCancel={() => { if (!uploading) setPickerOpen(false); }}
        onPick={async (asset) => {
          form.setFieldsValue({ [urlName]: asset.cover_url || "", [objectName]: asset.object_key || "", [assetName]: asset.id });
          setPickerOpen(false);
        }}
        assetType="image"
        title={`选择${label}`}
        pickButtonText="使用"
      />
    </div>
  );
}

function CampaignEditor({ open, campaign, onClose, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      title: "",
      description: "",
      rules_text: "",
      share_title: "",
      share_desc: "",
      hero_image_url: "",
      hero_image_object_key: "",
      hero_image_material_asset_id: null,
      share_image_url: "",
      share_image_object_key: "",
      share_image_material_asset_id: null,
      ...campaign,
      max_chances_per_link: 1,
      activity_time: campaign?.start_at && campaign?.end_at ? [dayjs(campaign.start_at), dayjs(campaign.end_at)] : null,
    });
  }, [campaign, form, open]);

  const submit = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        max_links_per_employee: 0,
        max_chances_per_link: 1,
        start_at: values.activity_time?.[0]?.toISOString() || null,
        end_at: values.activity_time?.[1]?.toISOString() || null,
      };
      delete payload.activity_time;
      const result = campaign?.id
        ? await updateAdminLotteryCampaign(campaign.id, payload)
        : await createAdminLotteryCampaign(payload);
      message.success(campaign?.id ? "活动设置已保存。" : "抽奖活动已创建。 ");
      onSaved(itemOf(result));
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error?.message || "活动保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      width={760}
      open={open}
      onClose={onClose}
      destroyOnClose
      title={campaign?.id ? "编辑抽奖活动" : "新建抽奖活动"}
      extra={<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={submit}>保存</Button>}
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <section className="lottery-editor-section">
          <Title level={5}>活动信息</Title>
          <Form.Item name="title" label="活动名称" rules={[{ required: true, message: "请输入活动名称" }, { max: 120 }]}>
            <Input placeholder="例如：怀仁酒业双十一幸运转盘" />
          </Form.Item>
          <Form.Item name="description" label="活动简介" rules={[{ max: 500 }]}>
            <Input.TextArea rows={3} showCount maxLength={500} placeholder="展示在抽奖页首屏" />
          </Form.Item>
          <Form.Item name="activity_time" label="活动时间" rules={[{ required: true, message: "请选择开始和结束时间" }]}>
            <RangePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="rules_text" label="活动规则" rules={[{ required: true, message: "请填写活动规则" }, { max: 5000 }]}>
            <Input.TextArea rows={6} showCount maxLength={5000} placeholder="参与资格、领奖方式、有效期等。建议同时写明理性饮酒与年龄提示。" />
          </Form.Item>
        </section>

        <section className="lottery-editor-section">
          <Title level={5}>抽奖页视觉</Title>
          <LotteryImageField form={form} kind="hero" label="活动主视觉" />
        </section>

        <section className="lottery-editor-section">
          <Title level={5}>微信分享卡片</Title>
          <Form.Item name="share_title" label="分享标题" rules={[{ max: 120 }]}>
            <Input placeholder="不填时使用活动名称" />
          </Form.Item>
          <Form.Item name="share_desc" label="分享摘要" rules={[{ max: 300 }]}>
            <Input.TextArea rows={2} showCount maxLength={300} placeholder="简短说明活动和客户的抽奖机会" />
          </Form.Item>
          <LotteryImageField form={form} kind="share" label="分享卡片图片" />
        </section>
      </Form>
    </Drawer>
  );
}

function CampaignOverview({ campaign, probabilityPpm, prizeRows, onEdit, onRefresh, onStatus, onDelete }) {
  const archived = !!campaign.deleted_at || campaign.status === "deleted";
  const totalPercent = probabilityPpm / 10000;
  const probabilityReady = lotteryPrizeConfig(prizeRows).ready;
  return (
    <div className="lottery-campaign-overview">
      <Card bordered={false} className="lottery-campaign-card">
        <div className="lottery-campaign-card__media">
          {campaignImage(campaign, "hero") ? <img src={campaignImage(campaign, "hero")} alt="" /> : <GiftOutlined />}
        </div>
        <div className="lottery-campaign-card__body">
          <Space wrap><Tag color="blue">活动 #{campaign.id}</Tag>{statusTag(archived ? "deleted" : campaign.status)}<Tag bordered={false}>版本 {campaign.config_version || 1}</Tag></Space>
          <Title level={3}>{campaign.title}</Title>
          <Paragraph type="secondary" ellipsis={{ rows: 2 }}>{campaign.description || "还没有填写活动简介"}</Paragraph>
          <Space wrap>
            {!archived ? <Button icon={<EditOutlined />} onClick={onEdit}>编辑活动</Button> : null}
            <Button icon={<ReloadOutlined />} onClick={onRefresh}>刷新</Button>
            {!archived && (campaign.status === "draft" || campaign.status === "paused") ? (
              <Popconfirm
                title={probabilityReady ? "确认发布必中活动？" : "奖品配置尚未满足发布条件"}
                description={probabilityReady ? "所有成功抽奖均中奖；仅有库存且配置概率大于 0 的奖品按权重参与，全部可抽奖品售罄后暂停抽奖、不扣次数。" : `当前配置概率 ${totalPercent.toFixed(4)}%；需启用 1–12 个实际奖品、合计 100%，至少一项有库存且概率大于 0。历史未中奖项须先停用或手动调整。`}
                okButtonProps={{ disabled: !probabilityReady }}
                onConfirm={() => onStatus("published")}
              >
                <Button type="primary" icon={<CheckCircleOutlined />} disabled={!probabilityReady}>发布活动</Button>
              </Popconfirm>
            ) : null}
            {!archived && campaign.status === "published" ? <Button icon={<PauseCircleOutlined />} onClick={() => onStatus("paused")}>暂停</Button> : null}
            {!archived && campaign.status !== "ended" ? <Popconfirm title="结束后客户将不能再抽奖，确认结束？" onConfirm={() => onStatus("ended")}><Button danger>结束活动</Button></Popconfirm> : null}
            {!archived ? <Button danger type="text" icon={<DeleteOutlined />} onClick={onDelete}>删除活动</Button> : null}
          </Space>
        </div>
      </Card>
      <div className="lottery-admin-kpis">
        <Card bordered={false}><Statistic title="客户链接" value={campaign.link_count ?? "—"} prefix={<LinkOutlined />} /></Card>
        <Card bordered={false}><Statistic title="已完成抽奖" value={campaign.draw_count ?? "—"} suffix={campaign.draw_count == null ? "" : "次"} /></Card>
        <Card bordered={false}><Statistic title="中奖记录" value={campaign.win_count ?? "—"} suffix={campaign.win_count == null ? "" : "次"} prefix={<TrophyOutlined />} /></Card>
        <Card bordered={false}><Statistic title="待处理领奖" value={campaign.pending_claim_count ?? "—"} suffix={campaign.pending_claim_count == null ? "" : "条"} /></Card>
      </div>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="活动时间">{fmtTime(campaign.start_at)} 至 {fmtTime(campaign.end_at)}</Descriptions.Item>
        <Descriptions.Item label="现行单链接规则">固定 1 次，不可追加</Descriptions.Item>
        <Descriptions.Item label="概率总和"><Text type={probabilityReady ? "success" : "danger"}>{totalPercent.toFixed(4)}%</Text></Descriptions.Item>
        <Descriptions.Item label="创建时间">{fmtTime(campaign.created_at)}</Descriptions.Item>
        <Descriptions.Item label="最近更新">{fmtTime(campaign.updated_at)}</Descriptions.Item>
        <Descriptions.Item label="活动标识" span={3}><Text copyable className="lottery-campaign-slug">{campaign.slug || `#${campaign.id}`}</Text></Descriptions.Item>
      </Descriptions>
    </div>
  );
}

function PrizeEditor({ campaignId, prize, configVersion, published, open, onClose, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const probabilityPercent = Form.useWatch("probability_percent", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      name: "",
      description: "",
      type: "physical",
      probability_percent: 0,
      stock_total: 1,
      enabled: true,
      sort_order: 0,
      image_url: "",
      image_object_key: "",
      image_material_asset_id: null,
      ...prize,
      type: prize?.type === "no_win" ? undefined : (prize?.type || "physical"),
      probability_percent: Number(prize?.probability_ppm || 0) / 10000,
    });
  }, [form, open, prize]);

  const submit = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const payload = prizeEditPayload(values, { existing: !!prize?.id, published, configVersion });
      const result = prize?.id
        ? await updateAdminLotteryPrize(prize.id, payload)
        : await createAdminLotteryPrize(campaignId, payload);
      message.success(prize?.id ? "奖品已更新。" : "奖品已添加。 ");
      onSaved(itemOf(result));
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error?.message || "奖品保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      width={620}
      open={open}
      onClose={onClose}
      destroyOnClose
      title={prize?.id ? "编辑奖品" : "新增奖品"}
      extra={<Button type="primary" loading={saving} icon={<SaveOutlined />} onClick={submit}>保存</Button>}
    >
      {published ? <Alert className="lottery-form-tip" type="info" showIcon message="已发布活动可直接编辑奖品资料" description="名称、图片、说明、类型、顺序和库存保存后生效，历史中奖信息不变。概率请关闭此窗口后使用“调整概率”统一修改；参与状态需暂停活动后调整。" /> : null}
      {prize?.type === "no_win" ? <Alert className="lottery-form-tip" type="warning" showIcon message="这是历史未中奖奖项，不能继续作为抽奖结果" description="可关闭窗口后停用此项；如要改为实际奖品，请明确选择新类型并核对名称、概率和库存后保存。系统不会自动转换类型或调整概率，历史结果保持不变。" /> : null}
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="name" label="奖品名称" rules={[{ required: true, message: "请输入奖品名称" }, { max: 120 }]}>
          <Input placeholder="例如：贵州酱香酒礼盒" />
        </Form.Item>
        <div className="lottery-form-grid">
          <Form.Item name="type" label="奖品类型" rules={[{ required: true, message: "请选择实际奖品类型" }]}><Select placeholder="请选择实际奖品类型" options={PRIZE_TYPES} /></Form.Item>
          <Form.Item name="sort_order" label="转盘顺序"><InputNumber min={0} max={999} precision={0} style={{ width: "100%" }} /></Form.Item>
        </div>
        <div className="lottery-form-grid">
          <Form.Item
            name="probability_percent"
            label="配置概率 / 抽取权重（%）"
            rules={[{ required: true, message: "请输入概率" }]}
            extra={published ? "请使用列表上方“调整概率”，一次保存全部概率；本次资料编辑不会改动概率。" : Number(probabilityPercent) > 0 && Number(probabilityPercent) < 1
              ? `当前是 ${Number(probabilityPercent).toFixed(4)}%。如果计划设置 88%，请直接输入 88。`
              : "直接填写百分数，例如 1 表示 1%，88 表示 88%；最多保留 4 位小数。"}
          >
            <InputNumber disabled={published} min={0} max={100} precision={4} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="stock_total" label="库存总数" rules={[{ required: true, message: "请输入库存总数" }]} extra={`已中奖 ${Number(prize?.stock_awarded || 0)} 件；保存时以服务器最新已中奖数量校验，售罄奖品不再参与抽取。`}>
            <InputNumber min={Number(prize?.stock_awarded || 0)} max={10_000_000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </div>
        <Form.Item name="description" label="奖品说明" rules={[{ max: 500 }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        <LotteryImageField form={form} kind="prize" label="奖品图片" />
        <Form.Item name="enabled" label="参与抽奖" valuePropName="checked"><Switch disabled={published} checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
      </Form>
    </Drawer>
  );
}

function ProbabilityEditor({ campaign, rows, onClose, onSaved }) {
  const { message } = AntdApp.useApp();
  // Freeze both the version and the enabled-prize set for optimistic concurrency.
  const [snapshot] = useState(() => ({
    campaignId: campaign.id,
    configVersion: campaign.config_version,
    prizes: rows.filter((row) => row.enabled !== false),
  }));
  const [values, setValues] = useState(() => Object.fromEntries(snapshot.prizes.map((row) => [row.id, (Number(row.probability_ppm || 0) / 10000).toFixed(4)])));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const probabilities = snapshot.prizes.map((row) => ({ prize_id: row.id, probability_ppm: probabilityPercentToPpm(values[row.id]) }));
  const inputsValid = probabilities.every((row) => row.probability_ppm !== null);
  const totalPpm = inputsValid ? probabilities.reduce((sum, row) => sum + row.probability_ppm, 0) : null;
  const validation = lotteryPrizeConfig(snapshot.prizes.map((row) => ({ ...row, probability_ppm: probabilityPercentToPpm(values[row.id]) })));
  const configReady = snapshot.prizes.length >= 1 && snapshot.prizes.length <= 12 && validation.legacyCount === 0;
  const canSave = inputsValid && validation.ready;
  const changed = probabilities.some((row) => row.probability_ppm !== Number(snapshot.prizes.find((prize) => prize.id === row.prize_id)?.probability_ppm || 0));

  const submit = async () => {
    if (!canSave || !changed || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await updateAdminLotteryProbabilities(snapshot.campaignId, {
        config_version: snapshot.configVersion,
        probabilities,
      });
      message.success("概率已整批保存并生效，仅影响后续抽奖，已有中奖记录不变。");
      onSaved();
    } catch (error) {
      message.error(error?.message || "概率保存失败，请刷新活动后重试。");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      width={700}
      title={`调整概率 · 活动 #${campaign.id}`}
      okText="确认并立即生效"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !canSave || !changed }}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      onCancel={onClose}
      onOk={submit}
    >
      <div className="lottery-probability-editor">
        <Text strong className="lottery-campaign-name">{campaign.title}</Text>
        <Alert
          type="info"
          showIcon
          message={campaign.status === "published" ? "活动无需暂停，全部概率一次保存后生效" : "全部概率一次保存，总和必须为 100%"}
          description="所有成功抽奖必中。仅有库存且配置概率大于 0 的奖品按权重抽取；售罄项退出后，其余有效奖品按相对权重参与。全部售罄则暂停抽奖、不扣次数。已有抽奖结果不变。"
        />
        <Table
          rowKey="id"
          dataSource={snapshot.prizes}
          pagination={false}
          size="small"
          scroll={{ x: 520 }}
          columns={[
            { title: "启用奖品", render: (_, row) => <div className="lottery-cell-stack"><Text strong>{row.name}</Text><Text type={row.type === "no_win" ? "danger" : "secondary"}>{row.type === "no_win" ? "历史未中奖项：请先停用或手动改为实际奖品" : `奖品 #${row.id} · 剩余库存 ${Math.max(0, Number(row.stock_total || 0) - Number(row.stock_awarded || 0))}`}</Text></div> },
            { title: "原配置概率", width: 110, render: (_, row) => `${(Number(row.probability_ppm || 0) / 10000).toFixed(4)}%` },
            { title: "新配置概率（%）", width: 170, render: (_, row) => (
              <InputNumber
                aria-label={`${row.name}的新概率（百分比）`}
                stringMode
                min="0"
                max="100"
                step="0.0001"
                value={values[row.id]}
                disabled={saving}
                status={probabilityPercentToPpm(values[row.id]) === null ? "error" : undefined}
                style={{ width: "100%" }}
                onChange={(value) => setValues((current) => ({ ...current, [row.id]: value }))}
              />
            ) },
          ]}
        />
        <Alert
          type={canSave ? "success" : "warning"}
          showIcon
          message={inputsValid ? `调整后概率合计：${(totalPpm / 10000).toFixed(4)}%` : "每项概率必须为 0–100 的数值，最多 4 位小数"}
          description={!configReady ? "启用奖品须为 1–12 项，不允许启用历史未中奖项；请先暂停活动，停用或手动调整旧项。" : !validation.stockReady ? "至少需要一个配置概率大于 0 且仍有库存的实际奖品，请补充库存或调整配置。" : canSave ? "已满足 100%，确认后立即对后续抽奖生效。" : inputsValid ? "请调整各项，使配置合计正好为 100%；不会自动改写任何配置概率。" : undefined}
        />
      </div>
    </Modal>
  );
}

function PrizesPanel({ campaign, rows, loading, onReload, onChanged }) {
  const { message } = AntdApp.useApp();
  const [editing, setEditing] = useState(undefined);
  const [probabilityOpen, setProbabilityOpen] = useState(false);
  const archived = !!campaign.deleted_at || campaign.status === "deleted";
  const editingLocked = archived || campaign.status === "published";
  const totalPpm = rows.filter((item) => item.enabled !== false).reduce((sum, item) => sum + Number(item.probability_ppm || 0), 0);
  const totalPercent = totalPpm / 10000;
  const activeRows = rows.filter((item) => item.enabled !== false);
  const prizeConfig = lotteryPrizeConfig(rows);
  const noWinCount = prizeConfig.legacyCount;
  const ready = prizeConfig.ready;
  const configIssues = [];
  if (totalPpm !== 1_000_000) {
    const gap = 100 - totalPercent;
    configIssues.push(gap > 0
      ? `启用项还差 ${gap.toFixed(4)}% 才到 100%。`
      : `启用项已超出 ${Math.abs(gap).toFixed(4)}%。`);
  }
  if (totalPercent > 0 && totalPercent <= 2) {
    configIssues.push("当前数值看起来可能按小数录入：0.88 表示 0.88%，如需 88% 应输入 88。");
  }
  if (noWinCount) configIssues.push(`仍启用了 ${noWinCount} 个历史“未中奖”项，请先暂停活动，再停用或手动改为实际奖品，并核对各奖品配置概率。系统不会自动修改历史类型或概率。`);
  if (activeRows.length < 1 || activeRows.length > 12) configIssues.push(`启用实际奖品必须为 1–12 个（当前 ${activeRows.length} 个）。`);
  if (!prizeConfig.stockReady) configIssues.push("至少一项实际奖品须有剩余库存且配置概率大于 0；全部售罄时暂停抽奖，不扣客户次数。");

  const toggle = async (row, enabled) => {
    try {
      await changeAdminLotteryPrizeStatus(row.id, enabled);
      message.success(enabled ? "奖品已启用。" : "奖品已停用，历史中奖记录不受影响。 ");
      onReload();
      onChanged();
    } catch (error) {
      message.error(error?.message || "奖品状态更新失败。");
    }
  };

  return (
    <div className="lottery-admin-panel">
      <div className="lottery-admin-panel__head">
        <div>
          <Title level={4}>奖品与概率</Title>
          <Paragraph type="secondary">所有成功抽奖必中。启用项配置概率合计 100%；服务端只从有库存且概率大于 0 的实际奖品中按相对权重抽取，全部可抽奖品售罄时暂停抽奖且不扣次数。</Paragraph>
        </div>
        <Space wrap>
          {!archived ? <Button type={campaign.status === "published" ? "primary" : "default"} icon={<SettingOutlined />} disabled={!activeRows.length || loading} onClick={() => setProbabilityOpen(true)}>调整概率</Button> : null}
          <Button type={campaign.status === "published" ? "default" : "primary"} icon={<PlusOutlined />} disabled={editingLocked || loading} onClick={() => setEditing(prizeEditSnapshot(null, campaign))}>新增奖品</Button>
        </Space>
      </div>
      {!archived && editingLocked ? <Alert type="info" showIcon message="已发布活动可直接编辑奖品、调整概率" description="点击奖品右侧“编辑”，可直接修改名称、图片、说明、类型、顺序和库存；概率使用“调整概率”整批保存。新增或启停奖品仍需先暂停活动，历史中奖信息保持不变。" /> : null}
      <Alert
        type={ready ? "success" : "warning"}
        showIcon
        message={`当前启用配置概率合计 ${totalPercent.toFixed(4)}%`}
        description={ready ? (archived ? "归档的最终概率配置，仅供查看。" : campaign.status === "published" ? "当前概率配置完整，客户可正常参与抽奖。" : "配置完整，可以发布活动。") : (
          <div className="lottery-config-issues">
            {configIssues.map((issue) => <Text key={issue} type="secondary">{issue}</Text>)}
          </div>
        )}
        action={<Progress type="circle" size={48} percent={Math.min(100, Number(totalPercent.toFixed(2)))} status={ready ? "success" : "normal"} format={() => `${totalPercent.toFixed(1)}%`} />}
      />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1020 }}
        locale={{ emptyText: <Empty description="还没有配置奖品" /> }}
        columns={[
          {
            title: "奖品",
            width: 250,
            render: (_, row) => (
              <Space>
                <div className="lottery-prize-thumb">{imageOf(row) ? <Image src={imageOf(row)} width={48} height={48} preview={false} /> : <GiftOutlined />}</div>
                <div className="lottery-cell-stack"><Text strong>{row.name}</Text>{row.type === "no_win" ? <Tag color={row.enabled === false ? "default" : "warning"}>{row.enabled === false ? "历史未中奖 · 已停用" : "历史未中奖 · 请停用或手动调整"}</Tag> : <Text type="secondary">{PRIZE_TYPES.find((item) => item.value === row.type)?.label || row.type}</Text>}</div>
              </Space>
            ),
          },
          { title: "配置概率", dataIndex: "probability_ppm", width: 130, render: (value) => <Text strong>{(Number(value || 0) / 10000).toFixed(4)}%</Text> },
          { title: "库存", width: 160, render: (_, row) => row.type === "no_win" ? "不计库存" : `${row.stock_awarded || 0} / ${row.stock_total || 0}` },
          { title: "顺序", dataIndex: "sort_order", width: 80 },
          { title: "状态", width: 100, render: (_, row) => <Switch size="small" disabled={editingLocked || (row.type === "no_win" && row.enabled === false)} checked={row.enabled !== false} onChange={(value) => toggle(row, value)} /> },
          { title: "操作", width: 110, fixed: "right", render: (_, row) => <Button size="small" disabled={archived || loading} icon={<EditOutlined />} onClick={() => setEditing(prizeEditSnapshot(row, campaign))}>编辑</Button> },
        ]}
      />
      <PrizeEditor
        campaignId={campaign.id}
        prize={editing?.prize || undefined}
        configVersion={editing?.configVersion}
        published={editing?.published}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        onSaved={() => { setEditing(undefined); onReload(); onChanged(); }}
      />
      {probabilityOpen ? <ProbabilityEditor campaign={campaign} rows={rows} onClose={() => setProbabilityOpen(false)} onSaved={() => { setProbabilityOpen(false); onReload(); onChanged(); }} /> : null}
    </div>
  );
}

function StaffPanel({ campaign }) {
  const { message } = AntdApp.useApp();
  const archived = !!campaign.deleted_at || campaign.status === "deleted";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [userOptions, setUserOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [departmentSelection, setDepartmentSelection] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [bulkConfirmation, setBulkConfirmation] = useState(null);
  const [dirty, setDirty] = useState(false);
  const savingRef = useRef(false);
  const requestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const activeCampaignRef = useRef(campaign.id);
  activeCampaignRef.current = campaign.id;
  const controlsLocked = archived || saving || loading || !loaded || !!bulkConfirmation;
  const availableIds = selectableStaffIds(rows);
  const selection = normalizeStaffSelection(rows, selectedKeys);
  const disabledAuthorizedCount = rows.filter((row) => row.user_disabled && row.enabled !== false).length;

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current && activeCampaignRef.current === campaign.id;
    setLoading(true);
    setLoaded(false);
    setLoadError("");
    try {
      const data = await listAdminLotteryStaff(campaign.id);
      if (!isCurrent()) return;
      setRows(itemsOf(data));
      setSelectedKeys([]);
      setDepartmentSelection([]);
      setBulkConfirmation(null);
      setPagination((current) => ({ ...current, current: 1 }));
      setDirty(false);
      setLoaded(true);
    } catch (error) {
      if (isCurrent()) {
        setLoadError(error?.message || "员工授权加载失败，请重新加载后再修改。");
        message.error(error?.message || "员工授权加载失败。");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [campaign.id, message]);

  useEffect(() => {
    mountedRef.current = true;
    setRows([]);
    setSelectedKeys([]);
    setDepartmentSelection([]);
    setBulkConfirmation(null);
    setPagination({ current: 1, pageSize: 10 });
    setDirty(false);
    setUserOptions([]);
    load();
    return () => { mountedRef.current = false; requestRef.current += 1; searchRequestRef.current += 1; };
  }, [load]);

  useEffect(() => {
    setSelectedKeys((current) => normalizeStaffSelection(rows, current));
    setPagination((current) => ({ ...current, current: Math.min(current.current, Math.max(1, Math.ceil(rows.length / current.pageSize))) }));
  }, [rows]);

  useEffect(() => {
    if (archived) return;
    let alive = true;
    setDirectoryLoading(true);
    adminListUsers()
      .then((data) => {
        if (alive) setDirectoryUsers(itemsOf(data).filter((user) => !user.disabled));
      })
      .catch((error) => {
        if (alive) message.error(error?.message || "部门员工目录加载失败。");
      })
      .finally(() => {
        if (alive) setDirectoryLoading(false);
      });
    return () => { alive = false; };
  }, [archived, message]);

  const authorizedRowsById = useMemo(
    () => new Map(rows.map((row) => [String(row.user_id), row])),
    [rows],
  );
  const selectedDirectoryUsers = useMemo(() => {
    const selectedIds = new Set(departmentSelection.map((id) => String(id)));
    return directoryUsers.filter((user) => selectedIds.has(String(user.id)));
  }, [departmentSelection, directoryUsers]);
  const pendingDirectoryUsers = useMemo(
    () => selectedDirectoryUsers.filter((user) => {
      const row = authorizedRowsById.get(String(user.id));
      return !row || (!row.user_disabled && row.enabled === false);
    }),
    [authorizedRowsById, selectedDirectoryUsers],
  );
  const newDirectoryUserCount = pendingDirectoryUsers.filter((user) => !authorizedRowsById.has(String(user.id))).length;
  const reenabledDirectoryUserCount = pendingDirectoryUsers.length - newDirectoryUserCount;

  const searchUsers = async (keyword) => {
    const requestId = ++searchRequestRef.current;
    setSearching(true);
    try {
      const data = await adminSearchUsers({ keyword, page: 1, page_size: 20, include_disabled: false });
      if (!mountedRef.current || requestId !== searchRequestRef.current) return;
      const users = itemsOf(data).filter((user) => !user.disabled);
      setUserOptions(users.map((user) => ({
        value: user.id,
        label: `${user.real_name || user.display_name || user.username}${user.department ? ` · ${user.department}` : ""}`,
        user,
      })));
    } catch (error) {
      if (mountedRef.current && requestId === searchRequestRef.current) message.error(error?.message || "员工搜索失败。");
    } finally {
      if (mountedRef.current && requestId === searchRequestRef.current) setSearching(false);
    }
  };

  const updateDraft = (updater) => {
    if (controlsLocked || savingRef.current) return;
    setRows(updater);
    setDirty(true);
  };

  const addUsers = (users) => {
    if (controlsLocked || savingRef.current) return;
    const result = addStaffUsers(rows, users);
    if (!result.addedCount && !result.reenabledCount) {
      message.info("这些员工已获得授权，无需重复添加。");
      return;
    }
    updateDraft(result.rows);
    message.success([result.addedCount ? `新增授权 ${result.addedCount} 人` : "", result.reenabledCount ? `重新启用 ${result.reenabledCount} 人` : ""].filter(Boolean).join("；") + "。保存权限后生效。");
    setDepartmentSelection([]);
  };

  const addUser = (userId) => {
    const option = userOptions.find((item) => String(item.value) === String(userId));
    if (option) addUsers([option.user]);
  };

  const patchRow = (userId, enabled) => updateDraft((prev) => prev.map((item) => {
    if (String(item.user_id) !== String(userId) || (item.user_disabled && enabled)) return item;
    return { ...item, enabled };
  }));

  const applyBulk = () => {
    if (!bulkConfirmation || archived || loading || savingRef.current || bulkConfirmation.campaignId !== campaign.id) return;
    if (typeof bulkConfirmation.enabled !== "boolean") return;
    const targetIds = normalizeStaffSelection(rows, bulkConfirmation.ids);
    setRows((current) => applyStaffEnabled(current, targetIds, bulkConfirmation.enabled));
    setDirty(true);
    setBulkConfirmation(null);
    message.success(`已更新所选 ${targetIds.length} 人的草稿；未勾选员工不变，保存权限后生效。`);
  };

  const save = async () => {
    if (savingRef.current || archived || loading || !loaded || bulkConfirmation) return;
    if (disabledAuthorizedCount) {
      message.warning("请先停用或移出账号已禁用员工的活动授权，再保存权限。");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await saveAdminLotteryStaff(campaign.id, rows.map(staffPermissionPayload));
      if (!mountedRef.current || activeCampaignRef.current !== campaign.id) return;
      message.success("员工授权已保存并记录。 ");
      await load();
    } catch (error) {
      if (mountedRef.current) message.error(error?.message || "员工授权保存失败。");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <div className="lottery-admin-panel">
      <div className="lottery-admin-panel__head">
        <div><Title level={4}>员工授权</Title><Paragraph type="secondary">按部门或姓名添加员工，即可授权生成客户链接。修改后点击“保存权限”生效。</Paragraph></div>
        <Space wrap>
          {loading ? <Tag>正在读取</Tag> : !loaded ? <Tag color="error">尚未读取成功</Tag> : dirty ? <Tag color="warning">有未保存的修改</Tag> : <Tag>已与服务器同步</Tag>}
          <Popconfirm disabled={!dirty} title="重新加载会放弃当前未保存的授权修改，确定继续？" onConfirm={load}>
            <Button disabled={saving || loading || !!bulkConfirmation} icon={<ReloadOutlined />} onClick={() => { if (!dirty) load(); }}>重新加载</Button>
          </Popconfirm>
          {!archived ? <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!loaded || loading || !!bulkConfirmation || !!disabledAuthorizedCount || !dirty} onClick={save}>保存权限</Button> : null}
        </Space>
      </div>
      {loadError ? <Alert type="error" showIcon message={loadError} description="为避免覆盖未能读取的服务器权限，已暂时锁定编辑。请重新加载成功后再操作。" /> : null}
      {disabledAuthorizedCount ? <Alert className="lottery-form-tip" type="warning" showIcon message={`有 ${disabledAuthorizedCount} 名员工账号已禁用，不能继续启用活动授权`} description="请先停用或移出这些员工，再保存权限。已生成的客户链接、抽奖和领奖历史不会删除。" action={!archived ? <Button disabled={controlsLocked} onClick={() => updateDraft((prev) => prev.map((row) => row.user_disabled ? { ...row, enabled: false } : row))}>全部改为停用</Button> : null} /> : null}
      {!archived ? <div className="lottery-staff-picker">
        <div className="lottery-staff-picker__head">
          <div className="lottery-staff-picker__copy">
            <Text strong>按部门添加员工</Text>
            <Text type="secondary">勾选部门包含下级部门，也可展开选择个别员工。</Text>
          </div>
          {selectedDirectoryUsers.length ? (
            <Space size={6} wrap>
              <Tag bordered={false} color="blue">已选 {selectedDirectoryUsers.length} 人</Tag>
              <Tag bordered={false} color={newDirectoryUserCount ? "gold" : "default"}>待新增 {newDirectoryUserCount} 人</Tag>
              {reenabledDirectoryUserCount ? <Tag bordered={false} color="green">待重新启用 {reenabledDirectoryUserCount} 人</Tag> : null}
            </Space>
          ) : null}
        </div>
        <div className="lottery-staff-picker__controls">
          <DepartmentUserTreeSelect
            users={directoryUsers}
            value={departmentSelection}
            onChange={setDepartmentSelection}
            disabled={directoryLoading || controlsLocked}
            placeholder="选择部门或展开选择员工"
          />
          <Button
            icon={<TeamOutlined />}
            loading={directoryLoading}
            disabled={!pendingDirectoryUsers.length || controlsLocked}
            onClick={() => addUsers(selectedDirectoryUsers)}
          >
            {pendingDirectoryUsers.length ? `${reenabledDirectoryUserCount ? "添加 / 重新启用" : "添加"} ${pendingDirectoryUsers.length} 人` : "添加所选员工"}
          </Button>
        </div>
        <Text className="lottery-staff-picker__hint" type="secondary">
          {directoryLoading
            ? "正在加载在职员工目录…"
            : `当前可选 ${directoryUsers.length} 名在职员工，已授权员工不会重复添加。`}
        </Text>
      </div> : null}
      {!archived ? <div className="lottery-staff-search">
        <Text type="secondary">按姓名单独添加</Text>
        <Select
          showSearch
          disabled={controlsLocked}
          filterOption={false}
          loading={searching}
          placeholder="输入姓名搜索并添加员工"
          style={{ width: "min(520px, 100%)" }}
          options={userOptions}
          onSearch={searchUsers}
          onFocus={() => { if (!userOptions.length) searchUsers(""); }}
          onSelect={addUser}
          value={undefined}
        />
      </div> : null}
      {!archived ? <div className="lottery-staff-bulk">
        <div><Text strong>已添加员工</Text><Text type="secondary">已勾选 {selection.length} 人，共 {rows.length} 人；可跨页批量启用或停用。</Text></div>
        <Space wrap>
          <Button disabled={controlsLocked || !availableIds.length} onClick={() => setSelectedKeys(availableIds)}>选择全部 {availableIds.length} 人（跨页）</Button>
          <Button disabled={controlsLocked || !selection.length} onClick={() => setSelectedKeys([])}>清空勾选</Button>
          <Button disabled={controlsLocked || !selection.length} onClick={() => setBulkConfirmation({ campaignId: campaign.id, ids: [...selection], enabled: true })}>批量启用</Button>
          <Button danger disabled={controlsLocked || !selection.length} onClick={() => setBulkConfirmation({ campaignId: campaign.id, ids: [...selection], enabled: false })}>批量停用</Button>
        </Space>
      </div> : null}
      <Table
        rowKey={(row) => String(row.user_id)}
        loading={loading}
        dataSource={rows}
        pagination={{ ...pagination, total: rows.length, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (total) => `共 ${total} 名员工` }}
        onChange={(next) => setPagination((current) => ({ current: next.pageSize !== current.pageSize ? 1 : next.current, pageSize: next.pageSize }))}
        rowSelection={archived ? undefined : {
          selectedRowKeys: selection,
          preserveSelectedRowKeys: true,
          onChange: (keys) => { if (!controlsLocked) setSelectedKeys(normalizeStaffSelection(rows, keys)); },
          getCheckboxProps: (row) => ({ disabled: controlsLocked || !!row.user_disabled }),
        }}
        scroll={{ x: 580 }}
        locale={{ emptyText: <Empty description="还没有授权员工，请按部门或姓名添加" /> }}
        columns={[
          { title: "员工", render: (_, row) => <div className="lottery-cell-stack"><Text strong>{row.user_name || row.display_name || row.username || `用户 #${row.user_id}`}</Text><Text type="secondary">{row.department || row.username || "—"}</Text>{row.user_disabled ? <Tag color="warning">账号已禁用</Tag> : null}</div> },
          { title: "授权状态", width: 120, render: (_, row) => <Switch aria-label={`${row.user_name || row.display_name || row.username || row.user_id}授权状态`} disabled={controlsLocked || (row.user_disabled && row.enabled === false)} checked={row.enabled !== false} checkedChildren="启用" unCheckedChildren="停用" onChange={(enabled) => patchRow(row.user_id, enabled)} /> },
          { title: "操作", width: 110, render: (_, row) => !archived ? <Popconfirm disabled={controlsLocked} title="将员工移出本次授权列表？" description="保存权限后停用授权，历史记录仍保留。" onConfirm={() => updateDraft((prev) => prev.filter((item) => String(item.user_id) !== String(row.user_id)))}><Button size="small" danger disabled={controlsLocked}>移出授权</Button></Popconfirm> : "—" },
        ]}
      />
      <Modal open={!!bulkConfirmation} title={`确认${bulkConfirmation?.enabled ? "启用" : "停用"} ${bulkConfirmation?.ids.length || 0} 名员工？`} okText="确认应用到草稿" cancelText="返回修改" onCancel={() => setBulkConfirmation(null)} onOk={applyBulk} destroyOnHidden>
        <Paragraph>仅{bulkConfirmation?.enabled ? "启用" : "停用"}已勾选员工的活动授权，包含其他页的勾选项。未勾选员工及历史客户链接、中奖记录保持不变。</Paragraph>
        <Text type="secondary">确认后请点击“保存权限”，使本次修改生效。</Text>
      </Modal>
    </div>
  );
}

function LinkShareModal({ row, onClose }) {
  return <LotteryShareModal row={row} open={!!row} onClose={onClose} />;
}

function AdminLinkRecordsDrawer({ row, onClose }) {
  const { message } = AntdApp.useApp();
  const [actions, setActions] = useState([]);
  const [draws, setDraws] = useState([]);
  const [drawLoading, setDrawLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [drawPage, setDrawPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const [actionPage, setActionPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const [linkDetail, setLinkDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRefresh, setDetailRefresh] = useState(0);

  useEffect(() => {
    if (!row?.id) return;
    let alive = true;
    setDetailLoading(true);
    setDetailError("");
    getEmployeeLotteryLink(row.id).then((data) => {
      if (alive) setLinkDetail(itemOf(data));
    }).catch((error) => {
      if (alive) { setLinkDetail(null); setDetailError(error?.message || "收货资料加载失败。"); }
    }).finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [row?.id, detailRefresh]);

  useEffect(() => {
    if (!row?.id) return;
    let alive = true;
    setDrawLoading(true);
    setDraws([]);
    loadLotteryPage((params) => listAdminLotteryDraws({ campaign_id: row.campaign_id, link_id: row.id, ...params }), drawPage, () => alive).then((result) => {
      if (!alive || !result) return;
      setDraws(result.items);
      setDrawPage(result.pagination);
    }).catch((error) => {
      if (alive) {
        setDraws([]);
        message.error(error?.message || "抽奖记录加载失败，请重新翻页或打开记录。");
      }
    }).finally(() => {
      if (alive) setDrawLoading(false);
    });
    return () => { alive = false; };
  }, [message, row?.id, row?.campaign_id, drawPage.current, drawPage.pageSize]);

  useEffect(() => {
    if (!row?.id) return;
    let alive = true;
    setActionLoading(true);
    setActions([]);
    loadLotteryPage((params) => listAdminLotteryLinkActions(row.id, params), actionPage, () => alive).then((result) => {
      if (!alive || !result) return;
      setActions(result.items);
      setActionPage(result.pagination);
    }).catch((error) => {
      if (alive) {
        setActions([]);
        message.error(error?.message || "链接操作记录加载失败，请重新翻页或打开记录。");
      }
    }).finally(() => {
      if (alive) setActionLoading(false);
    });
    return () => { alive = false; };
  }, [message, row?.id, actionPage.current, actionPage.pageSize]);

  return (
    <Drawer width={760} open={!!row} title={`${row?.customer_name || "客户"} · 完整记录`} onClose={onClose} destroyOnClose>
      <Descriptions bordered size="small" column={2} className="lottery-form-tip">
        <Descriptions.Item label="客户编号 / 链接">{row?.customer_code || "未填写编号"} · 链接 #{row?.id || "—"}</Descriptions.Item>
        <Descriptions.Item label="创建员工">{row?.created_by_name || `用户 #${row?.created_by_user_id || "—"}`}</Descriptions.Item>
        <Descriptions.Item label="已抽次数">{linkDetail?.chance_used ?? row?.chance_used ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="当前剩余次数">{linkDetail?.remaining_chances === undefined && row?.remaining_chances === undefined && linkDetail?.chance_total === undefined && row?.chance_total === undefined ? "—" : remainingOf(linkDetail || row)}</Descriptions.Item>
      </Descriptions>
      <div className="lottery-form-tip">
        <Space style={{ marginBottom: 8 }}><Text strong>兑奖方式 / 历史收货资料</Text><Button size="small" icon={<ReloadOutlined />} loading={detailLoading} onClick={() => setDetailRefresh((value) => value + 1)}>刷新资料</Button></Space>
        {detailLoading ? <Spin /> : detailError ? <Alert type="warning" showIcon message={detailError} /> : linkDetail?.receipt?.submitted ? <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="收件人">{linkDetail.receipt.recipient_name}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{linkDetail.receipt.recipient_phone}</Descriptions.Item>
          <Descriptions.Item label="收货地址"><Text style={{ overflowWrap: "anywhere" }}>{linkDetail.receipt.recipient_address}</Text></Descriptions.Item>
          <Descriptions.Item label="登记时间">{fmtTime(linkDetail.receipt.submitted_at)}</Descriptions.Item>
          <Descriptions.Item label="说明">历史已登记资料继续保留，现在改为客户联系销售兑奖。</Descriptions.Item>
        </Descriptions> : <Alert type="info" showIcon message="客户截图中奖信息，联系销售人员兑奖" description="不再要求客户填写收货资料。请销售人员核对客户链接和服务器中奖记录后办理兑奖。" />}
      </div>
      <Tabs
        items={[
          {
            key: "draws",
            label: `抽奖记录 ${drawPage.total}`,
            children: (
              <Table
                rowKey="id"
                loading={drawLoading}
                dataSource={draws}
                pagination={{ ...drawPage, ...LOTTERY_PAGE_OPTIONS, showTotal: (total) => `共 ${total} 次` }}
                onChange={(next) => setDrawPage((prev) => ({ ...prev, ...lotteryPageRequest(next.current, next.pageSize, prev.pageSize) }))}
                locale={{ emptyText: <Empty description="还没有抽奖记录" /> }}
                columns={[
                  { title: "序号", dataIndex: "draw_sequence", width: 80 },
                  { title: "结果", render: (_, item) => <Tag color={item.result_type === "win" ? "gold" : "default"}>{item.prize_name || "未中奖"}</Tag> },
                  { title: "配置版本", dataIndex: "config_version", width: 100 },
                  { title: "时间", dataIndex: "created_at", width: 170, render: fmtTime },
                ]}
              />
            ),
          },
          {
            key: "actions",
            label: `操作记录 ${actionPage.total}`,
            children: (
              <Table
                rowKey="id"
                loading={actionLoading}
                dataSource={actions}
                pagination={{ ...actionPage, ...LOTTERY_PAGE_OPTIONS, showTotal: (total) => `共 ${total} 条` }}
                onChange={(next) => setActionPage((prev) => ({ ...prev, ...lotteryPageRequest(next.current, next.pageSize, prev.pageSize) }))}
                locale={{ emptyText: <Empty description="暂无操作记录" /> }}
                columns={[
                  { title: "操作", dataIndex: "action", width: 100, render: (value) => ({ create: "创建", adjust: "调整次数", disable: "停用", enable: "启用" }[value] || value) },
                  { title: "次数变化", width: 130, render: (_, item) => `${item.before_chance_total ?? "—"} → ${item.after_chance_total ?? "—"}` },
                  { title: "原因", dataIndex: "reason", ellipsis: true, render: (value) => value || "—" },
                  { title: "操作人", dataIndex: "operator_id", width: 110, render: (value) => value ? `用户 #${value}` : "—" },
                  { title: "时间", dataIndex: "created_at", width: 170, render: fmtTime },
                ]}
              />
            ),
          },
        ]}
      />
    </Drawer>
  );
}

function LinksPanel({ campaign }) {
  const { message, modal } = AntdApp.useApp();
  const archived = !!campaign.deleted_at || campaign.status === "deleted";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const [shareRow, setShareRow] = useState(null);
  const [recordRow, setRecordRow] = useState(null);
  const submittedKeywordRef = useRef("");
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;

  const load = useCallback(async (nextPage = pageRef.current.current, pageSize = pageRef.current.pageSize, searchKeyword = submittedKeywordRef.current) => {
    if (!mountedRef.current) return;
    const requestId = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current;
    const requestedPage = lotteryPageRequest(nextPage, pageSize, pageRef.current.pageSize);
    submittedKeywordRef.current = searchKeyword;
    setPage((prev) => ({ ...prev, ...requestedPage }));
    setLoading(true);
    setRows([]);
    try {
      const result = await loadLotteryPage((params) => listAdminLotteryLinks({ campaign_id: campaign.id, keyword: searchKeyword, ...params }), requestedPage, isCurrent);
      if (!result || !isCurrent()) return;
      setRows(result.items);
      setPage(result.pagination);
    } catch (error) {
      if (isCurrent()) message.error(error?.message || "链接记录加载失败。");
    } finally { if (isCurrent()) setLoading(false); }
  }, [campaign.id, message]);

  useEffect(() => {
    mountedRef.current = true;
    setKeyword("");
    setShareRow(null);
    setRecordRow(null);
    load(1, page.pageSize, "");
    return () => { mountedRef.current = false; requestRef.current += 1; };
  }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (row, action, payload = {}) => {
    try {
      await actOnAdminLotteryLink(row.id, { action, ...payload });
      message.success("链接已更新并写入操作记录。 ");
      await load();
    } catch (error) { message.error(error?.message || "链接操作失败。"); }
  };

  const toggle = (row) => {
    const action = row.status === "disabled" ? "enable" : "disable";
    modal.confirm({ title: action === "disable" ? "确认停用该客户链接？" : "确认启用该客户链接？", content: action === "enable" ? "启用不会恢复已用机会；仅尚未抽过的链接可以抽奖一次。" : "停用后客户将不能抽奖，历史记录继续保留。", onOk: () => act(row, action, { reason: "管理员手动操作" }) });
  };

  return (
    <div className="lottery-admin-panel">
      <div className="lottery-admin-panel__head">
        <div><Title level={4}>客户专属链接</Title><Paragraph type="secondary">{archived ? "活动已删除，原链接已失效；保留归属员工、机会消耗和历史记录。" : "每条链接只能抽奖一次，不可追加。可查看归属员工、中奖结果和历史记录，必要时停用链接。"}</Paragraph></div>
        <Button icon={<ReloadOutlined />} onClick={() => load()}>刷新</Button>
      </div>
      <Input.Search allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} onSearch={(value) => load(1, page.pageSize, value.trim())} placeholder="搜索客户、编号或员工" style={{ width: 340, marginBottom: 16 }} />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1250 }}
        pagination={{ ...page, ...LOTTERY_PAGE_OPTIONS, showTotal: (total) => `共 ${total} 条` }}
        onChange={(next) => load(next.current, next.pageSize)}
        locale={{ emptyText: <Empty description="该活动还没有客户链接" /> }}
        columns={[
          { title: "客户", width: 180, render: (_, row) => <div className="lottery-cell-stack"><Text strong>{row.customer_name || "未命名"}</Text><Text type="secondary">{row.customer_code || "—"}</Text></div> },
          { title: "创建员工", width: 150, render: (_, row) => row.creator_display_name || row.creator_name || row.created_by_name || `用户 #${row.created_by_user_id || "—"}` },
          { title: "抽奖进度", width: 240, render: (_, row) => lotteryLinkProgressLabel(row) },
          { title: "中奖", dataIndex: "win_count", width: 80, render: (v) => `${v || 0} 次` },
          { title: "状态", dataIndex: "status", width: 110, render: (value, row) => {
            if (archived) return <Tag>活动已删除</Tag>;
            if (value === "disabled") return <Tag>已停用</Tag>;
            if (row.expires_at && dayjs(row.expires_at).isBefore(dayjs())) return <Tag color="warning">已过期</Tag>;
            if (remainingOf(row) <= 0) return <Tag color="gold">机会已用完</Tag>;
            return <Tag color="success">有效</Tag>;
          } },
          { title: "创建时间", dataIndex: "created_at", width: 170, render: fmtTime },
          { title: "最近抽奖", dataIndex: "last_draw_at", width: 170, render: fmtTime },
          {
            title: "操作", width: 250, fixed: "right", render: (_, row) => (
              <Space size={4}>
                {!archived ? <Button size="small" icon={<LinkOutlined />} disabled={row.status !== "active" || remainingOf(row) <= 0 || !!(row.expires_at && dayjs(row.expires_at).isBefore(dayjs()))} onClick={() => setShareRow(row)}>链接</Button> : null}
                <Button size="small" icon={<AuditOutlined />} onClick={() => setRecordRow(row)}>记录</Button>
                {!archived ? <Button size="small" danger={row.status !== "disabled"} onClick={() => toggle(row)}>{row.status === "disabled" ? "启用" : "停用"}</Button> : null}
              </Space>
            ),
          },
        ]}
      />
      <LinkShareModal row={shareRow} onClose={() => setShareRow(null)} />
      <AdminLinkRecordsDrawer key={recordRow?.id || "empty"} row={recordRow} onClose={() => setRecordRow(null)} />
    </div>
  );
}

function DrawsPanel({ campaign }) {
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;

  const load = useCallback(async (nextPage = pageRef.current.current, pageSize = pageRef.current.pageSize) => {
    if (!mountedRef.current) return;
    const requestId = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current;
    const requestedPage = lotteryPageRequest(nextPage, pageSize, pageRef.current.pageSize);
    setPage((prev) => ({ ...prev, ...requestedPage }));
    setLoading(true);
    setRows([]);
    try {
      const result = await loadLotteryPage((params) => listAdminLotteryDraws({ campaign_id: campaign.id, ...params }), requestedPage, isCurrent);
      if (!result || !isCurrent()) return;
      setRows(result.items);
      setPage(result.pagination);
    } catch (error) { if (isCurrent()) message.error(error?.message || "抽奖记录加载失败。"); }
    finally { if (isCurrent()) setLoading(false); }
  }, [campaign.id, message]);

  useEffect(() => {
    mountedRef.current = true;
    load(1, page.pageSize);
    return () => { mountedRef.current = false; requestRef.current += 1; };
  }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lottery-admin-panel">
      <div className="lottery-admin-panel__head"><div><Title level={4}>每次抽奖记录</Title><Paragraph type="secondary">服务端生成结果，保留当时的奖品、概率版本、次数与时间快照。</Paragraph></div><Button icon={<ReloadOutlined />} onClick={() => load()}>刷新</Button></div>
      <Table
        rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 1250 }} pagination={{ ...page, ...LOTTERY_PAGE_OPTIONS, showTotal: (total) => `共 ${total} 次` }} onChange={(next) => load(next.current, next.pageSize)} locale={{ emptyText: <Empty description="还没有抽奖记录" /> }}
        columns={[
          { title: "客户", width: 160, render: (_, row) => row.customer_name || row.link_customer_name || "—" },
          { title: "客户编号", width: 130, render: (_, row) => row.customer_code || row.link_customer_code || "—" },
          { title: "创建员工", width: 150, render: (_, row) => row.creator_display_name || row.created_by_name || (row.created_by_user_id ? `用户 #${row.created_by_user_id}` : "—") },
          { title: "抽奖序号", dataIndex: "draw_sequence", width: 100 },
          { title: "结果", width: 210, render: (_, row) => <Tag color={row.result_type === "win" ? "gold" : "default"}>{row.prize_name_snapshot || row.prize_name || "未中奖"}</Tag> },
          { title: "配置版本", dataIndex: "config_version", width: 100 },
          { title: "抽奖时间", dataIndex: "created_at", width: 170, render: fmtTime },
          { title: "领奖状态", dataIndex: "claim_status", width: 100, render: (value) => value ? claimTag(value) : "—" },
        ]}
      />
    </div>
  );
}

function ClaimsPanel({ campaign }) {
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [missingClaimCount, setMissingClaimCount] = useState(0);
  const [page, setPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const [editing, setEditing] = useState(null);
  const [recordRow, setRecordRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const [form] = Form.useForm();
  const selectedStatus = Form.useWatch("status", form);
  const receiptReady = hasClaimReceipt(editing);
  const editableStatuses = claimEditableStatuses(editing?.status, receiptReady);
  const editable = editableStatuses.length > 0 && editing?.revision != null;
  const pageRef = useRef(page);
  pageRef.current = page;

  const load = useCallback(async (nextPage = pageRef.current.current, pageSize = pageRef.current.pageSize) => {
    if (!mountedRef.current) return;
    const requestId = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current;
    const requestedPage = lotteryPageRequest(nextPage, pageSize, pageRef.current.pageSize);
    setPage((prev) => ({ ...prev, ...requestedPage }));
    setLoading(true);
    setRows([]);
    try {
      const result = await loadLotteryPage((params) => listAdminLotteryClaims({ campaign_id: campaign.id, ...params }), requestedPage, isCurrent);
      if (!result || !isCurrent()) return;
      setRows(result.items);
      setMissingClaimCount(Number(result.data?.missing_claim_count || 0));
      setPage(result.pagination);
    } catch (error) {
      if (isCurrent()) message.error(error?.message || "领奖记录加载失败。");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [campaign.id, message]);

  useEffect(() => {
    mountedRef.current = true;
    load(1, page.pageSize);
    return () => { mountedRef.current = false; requestRef.current += 1; };
  }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const target = editing;
    if (!target || !editable || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const values = await form.validateFields();
      if (!mountedRef.current || !claimEditableStatuses(target.status, hasClaimReceipt(target)).includes(values.status)) return;
      await changeAdminLotteryClaimStatus(target.id, { ...values, expected_revision: target.revision });
      if (!mountedRef.current) return;
      message.success("领奖进度已更新。 ");
      setEditing(null);
      await load();
    } catch (error) {
      if (error?.errorFields || !mountedRef.current) return;
      if (error?.status === 409) {
        setEditing(null);
        message.warning("这条领奖记录已被其他操作更新，请查看刷新后的状态并重新打开，未覆盖他人的处理结果。");
        await load();
        return;
      }
      message.error(error?.message || "领奖进度更新失败。");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <div className="lottery-admin-panel">
      <div className="lottery-admin-panel__head"><div><Title level={4}>领奖处理</Title><Paragraph type="secondary">客户截图中奖信息联系销售人员兑奖，无需填写收货资料。请核对服务器中奖记录，实际兑奖后标记已发放；结案记录只读留档。</Paragraph></div><Button icon={<ReloadOutlined />} disabled={saving} onClick={() => load()}>刷新</Button></div>
      {missingClaimCount > 0 ? <Alert className="lottery-form-tip" type="warning" showIcon message={`有 ${missingClaimCount} 条历史中奖记录待管理员补录领奖登记`} description="请先核对该活动抽奖记录并联系系统管理员补录；不需要客户重新抽奖，也不会代填收货地址。" /> : null}
      <Table
        rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 1660 }} pagination={{ ...page, ...LOTTERY_PAGE_OPTIONS, showTotal: (total) => `共 ${total} 条` }} onChange={(next) => load(next.current, next.pageSize)} locale={{ emptyText: <Empty description="还没有待处理的中奖记录" /> }}
        columns={[
          { title: "奖品", width: 190, render: (_, row) => <Text strong>{row.prize_name_snapshot || row.prize_name || "—"}</Text> },
          { title: "客户 / 编号", width: 190, render: (_, row) => <div className="lottery-cell-stack"><Text>{row.customer_name || "—"}</Text><Text type="secondary">{row.customer_code || "未填写编号"} · 链接 #{row.invite_link_id}</Text></div> },
          { title: "创建员工", width: 160, render: (_, row) => <div className="lottery-cell-stack"><Text>{row.created_by_name || "—"}</Text><Text type="secondary">员工 #{row.created_by_user_id || "—"}</Text></div> },
          { title: "兑奖方式 / 历史联系资料", width: 190, render: (_, row) => hasClaimReceipt(row) ? <div className="lottery-cell-stack"><Text>{row.recipient_name}</Text><Text>{row.recipient_phone}</Text></div> : <Tag>联系销售兑奖</Tag> },
          { title: "历史收货地址", width: 250, ellipsis: true, render: (_, row) => hasClaimReceipt(row) ? row.recipient_address : "无需填写，由销售人员办理兑奖" },
          { title: "处理备注", width: 220, ellipsis: true, render: (_, row) => row.operator_remark || row.remark || "—" },
          { title: "状态", dataIndex: "status", width: 100, render: claimTag },
          { title: "登记时间", dataIndex: "created_at", width: 170, render: fmtTime },
          { title: "操作", fixed: "right", width: 180, render: (_, row) => <Space size={4}><Button size="small" disabled={saving} onClick={() => { form.setFieldsValue({ status: row.status, remark: row.operator_remark || row.remark || "" }); setEditing(row); }}>{claimEditableStatuses(row.status).length ? "处理" : "查看"}</Button><Button size="small" disabled={!row.invite_link_id} onClick={() => setRecordRow(claimLinkRecord(row))}>链接记录</Button></Space> },
        ]}
      />
      <Modal open={!!editing} title={editable ? "更新领奖处理进度" : "领奖处理记录"} okText="确认保存" onOk={save} onCancel={() => { if (!savingRef.current) setEditing(null); }} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving} footer={editable ? undefined : <Button onClick={() => setEditing(null)}>关闭</Button>} destroyOnHidden>
        <Descriptions bordered size="small" column={1} className="lottery-form-tip">
          <Descriptions.Item label="奖品">{editing?.prize_name_snapshot || editing?.prize_name || "—"}</Descriptions.Item>
          <Descriptions.Item label="客户">{editing?.customer_name || "—"} · {editing?.customer_code || "未填写编号"}</Descriptions.Item>
          <Descriptions.Item label="创建员工">{editing?.created_by_name || "—"}（#{editing?.created_by_user_id || "—"}）</Descriptions.Item>
          <Descriptions.Item label="客户链接">#{editing?.invite_link_id || "—"} <Button type="link" size="small" disabled={!editing?.invite_link_id} onClick={() => setRecordRow(claimLinkRecord(editing))}>查看抽奖与操作记录</Button></Descriptions.Item>
          <Descriptions.Item label="当前状态">{claimTag(editing?.status)}</Descriptions.Item>
          <Descriptions.Item label="收件人">{receiptReady ? editing.recipient_name : "尚未登记"}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{receiptReady ? editing.recipient_phone : "尚未登记"}</Descriptions.Item>
          <Descriptions.Item label="收货地址"><Text style={{ overflowWrap: "anywhere" }}>{receiptReady ? editing.recipient_address : "尚未登记"}</Text></Descriptions.Item>
        </Descriptions>
        <Alert className="lottery-form-tip" type="info" showIcon message="客户凭中奖截图联系销售人员兑奖" description="以此客户链接的服务器中奖记录为准，核对奖品及数量，实际完成兑奖后再标记已发放。无需补填地址。" />
        {!editable ? <Alert className="lottery-form-tip" type="info" showIcon message={editableStatuses.length ? "记录缺少版本信息，请关闭后刷新列表再处理。" : "此记录已结案，只能查看，不能回退状态或修改备注。"} /> : ["fulfilled", "cancelled"].includes(selectedStatus) ? <Alert className="lottery-form-tip" type="warning" showIcon message="保存后即结案，状态和备注不可再修改，请确认实际处理结果。" /> : null}
        <Form form={form} layout="vertical" disabled={saving || !editable}>
          <Form.Item name="status" label="处理状态" rules={[{ required: true }]}><Select options={(editableStatuses.length ? editableStatuses : [editing?.status].filter(Boolean)).map((value) => ({ value, label: CLAIM_STATUS[value]?.label || value }))} /></Form.Item>
          <Form.Item name="remark" label="处理备注" rules={[{ max: 500 }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：已核对中奖记录，由销售张先生完成兑奖" /></Form.Item>
        </Form>
      </Modal>
      <AdminLinkRecordsDrawer key={recordRow?.id || "empty"} row={recordRow} onClose={() => setRecordRow(null)} />
    </div>
  );
}

function AuditPanel({ campaign }) {
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState({ current: 1, pageSize: 10, total: 0 });
  const [detail, setDetail] = useState(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;

  const load = useCallback(async (nextPage = pageRef.current.current, pageSize = pageRef.current.pageSize) => {
    if (!mountedRef.current) return;
    const requestId = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current;
    const requestedPage = lotteryPageRequest(nextPage, pageSize, pageRef.current.pageSize);
    setPage((prev) => ({ ...prev, ...requestedPage }));
    setLoading(true);
    setRows([]);
    try {
      const result = await loadLotteryPage((params) => listAdminLotteryAuditLogs({ campaign_id: campaign.id, ...params }), requestedPage, isCurrent);
      if (!result || !isCurrent()) return;
      setRows(result.items);
      setPage(result.pagination);
    } catch (error) { if (isCurrent()) message.error(error?.message || "审计记录加载失败。"); }
    finally { if (isCurrent()) setLoading(false); }
  }, [campaign.id, message]);

  useEffect(() => {
    mountedRef.current = true;
    setDetail(null);
    load(1, page.pageSize);
    return () => { mountedRef.current = false; requestRef.current += 1; };
  }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const entityLabel = { campaign: "活动", prize: "奖品", staff: "员工权限", claim: "领奖" };
  const actionLabel = { create: "创建", update: "更新", status: "状态变更", enable: "启用", disable: "停用", delete: "删除", replace: "整批更新", probabilities: "调整概率", update_probabilities: "调整概率" };

  return (
    <div className="lottery-admin-panel">
      <div className="lottery-admin-panel__head"><div><Title level={4}>配置审计</Title><Paragraph type="secondary">活动、奖品、员工权限和领奖状态的管理操作都会保留前后快照。</Paragraph></div><Button icon={<ReloadOutlined />} onClick={() => load()}>刷新</Button></div>
      <Table
        rowKey="id" loading={loading} dataSource={rows} pagination={{ ...page, ...LOTTERY_PAGE_OPTIONS, showTotal: (total) => `共 ${total} 条` }} onChange={(next) => load(next.current, next.pageSize)} locale={{ emptyText: <Empty description="暂无配置变更记录" /> }}
        columns={[
          { title: "对象", dataIndex: "entity_type", width: 120, render: (value) => entityLabel[value] || value },
          { title: "对象 ID", dataIndex: "entity_id", width: 100, render: (value) => value || "—" },
          { title: "操作", dataIndex: "action", width: 120, render: (value) => <Tag>{actionLabel[value] || value}</Tag> },
          { title: "操作人", dataIndex: "operator_id", width: 110, render: (value) => value ? `用户 #${value}` : "—" },
          { title: "操作时间", dataIndex: "created_at", width: 180, render: fmtTime },
          { title: "详情", width: 90, render: (_, row) => <Button size="small" onClick={() => setDetail(row)}>查看</Button> },
        ]}
      />
      <Drawer width={680} open={!!detail} title="配置变更快照" onClose={() => setDetail(null)} destroyOnClose>
        <Descriptions bordered size="small" column={2} className="lottery-form-tip">
          <Descriptions.Item label="对象">{entityLabel[detail?.entity_type] || detail?.entity_type || "—"}</Descriptions.Item>
          <Descriptions.Item label="操作">{actionLabel[detail?.action] || detail?.action || "—"}</Descriptions.Item>
          <Descriptions.Item label="操作人">{detail?.operator_id ? `用户 #${detail.operator_id}` : "—"}</Descriptions.Item>
          <Descriptions.Item label="时间">{fmtTime(detail?.created_at)}</Descriptions.Item>
        </Descriptions>
        <Title level={5}>变更前</Title>
        <pre className="lottery-audit-json">{JSON.stringify(detail?.before ?? null, null, 2)}</pre>
        <Title level={5}>变更后</Title>
        <pre className="lottery-audit-json">{JSON.stringify(detail?.after ?? null, null, 2)}</pre>
      </Drawer>
    </div>
  );
}

export default function LotteryAdminPage() {
  const { message, modal } = AntdApp.useApp();
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState();
  const [campaign, setCampaign] = useState(null);
  const [prizes, setPrizes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [listError, setListError] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCampaign, setEditorCampaign] = useState(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const selectedCampaignRef = useRef(campaignId);
  const mutationRef = useRef(false);
  selectedCampaignRef.current = campaignId;

  const loadCampaigns = useCallback(async (preferredId) => {
    const request = ++listRequestRef.current;
    setListLoading(true);
    setListError("");
    try {
      const next = await loadAllLotteryCampaigns((params) => listAdminLotteryCampaigns({ ...params, include_deleted: includeDeleted }), () => request === listRequestRef.current);
      if (!next || request !== listRequestRef.current) return;
      setCampaigns(next);
      setCampaignId((current) => preferredCampaignId(next, current, preferredId));
    } catch (error) {
      if (request === listRequestRef.current) setListError(error?.message || "抽奖活动加载失败。");
    } finally {
      if (request === listRequestRef.current) setListLoading(false);
    }
  }, [includeDeleted]);

  const loadCurrent = useCallback(async () => {
    // A delayed callback from a previous campaign must not supersede the selected one.
    if (String(campaignId) !== String(selectedCampaignRef.current)) return;
    const request = ++detailRequestRef.current;
    const isCurrent = () => request === detailRequestRef.current && String(campaignId) === String(selectedCampaignRef.current);
    setLoadError("");
    if (!campaignId) { setCampaign(null); setPrizes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await getAdminLotteryCampaign(campaignId);
      if (!isCurrent()) return;
      const next = itemOf(data);
      setCampaign(next);
      setPrizes(itemsOf(next?.prizes));
    } catch (error) {
      if (!isCurrent()) return;
      setCampaign(null);
      setPrizes([]);
      setLoadError(error?.message || "活动详情加载失败。");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => { loadCurrent(); }, [loadCurrent]);
  useEffect(() => () => { listRequestRef.current += 1; detailRequestRef.current += 1; }, []);

  const selectCampaign = (id) => {
    detailRequestRef.current += 1;
    selectedCampaignRef.current = id;
    setCampaignId(id);
    setCampaign(null);
    setPrizes([]);
    setLoadError("");
    setLoading(!!id);
    setEditorOpen(false);
    setEditorCampaign(null);
  };

  const changeStatus = async (status) => {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setMutationPending(true);
    try {
      await changeAdminLotteryCampaignStatus(campaign.id, status);
      message.success(status === "published" ? "活动已发布，员工现在可以生成客户链接。" : status === "paused" ? "活动已暂停。" : "活动已结束。 ");
      await Promise.all([loadCampaigns(), loadCurrent()]);
    } catch (error) {
      message.error(error?.message || "活动状态更新失败。");
    } finally {
      mutationRef.current = false;
      setMutationPending(false);
    }
  };

  const confirmDelete = () => {
    const target = campaign;
    modal.confirm({
      title: `确认删除活动 #${target.id}？`,
      content: (
        <div className="lottery-delete-confirm">
          <Text strong className="lottery-campaign-name">{target.title}</Text>
          <Paragraph>删除后停止该活动的抽奖和员工建链，已发给客户的专属链接将失效。</Paragraph>
          <Paragraph type="secondary">已有 {target.link_count || 0} 条链接、{target.draw_count || 0} 次抽奖记录不会被清除。可开启“显示已删除活动”查看历史并继续处理领奖；删除后不能重新发布。</Paragraph>
        </div>
      ),
      okText: "确认删除并停止活动",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        if (mutationRef.current) throw new Error("请等待当前操作完成。");
        mutationRef.current = true;
        setMutationPending(true);
        try {
          const result = await deleteAdminLotteryCampaign(target.id);
          if (String(selectedCampaignRef.current) === String(target.id)) {
            setCampaign({ ...target, ...itemOf(result) });
          }
          message.success(`活动 #${target.id} 已删除，历史记录已保留。`);
          await loadCampaigns();
          if (includeDeleted) await loadCurrent();
        } catch (error) {
          message.error(error?.message || "删除活动失败。");
          throw error;
        } finally {
          mutationRef.current = false;
          setMutationPending(false);
        }
      },
    });
  };

  const probabilityPpm = prizes.filter((item) => item.enabled !== false).reduce((sum, item) => sum + Number(item.probability_ppm || 0), 0);
  const currentCampaign = campaign && String(campaign.id) === String(campaignId) ? campaign : null;
  const archived = !!currentCampaign?.deleted_at || currentCampaign?.status === "deleted";
  const visibleCampaign = currentCampaign && (includeDeleted || !archived) ? currentCampaign : null;

  return (
    <div className="lottery-admin-page">
      <header className="lottery-admin-hero">
        <div>
          <span className="lottery-admin-eyebrow">DOUBLE 11 · CUSTOMER LOTTERY</span>
          <Title level={2}>活动抽奖</Title>
          <Paragraph>配置奖品与概率、授权员工建链，并追踪每一条客户链接、抽奖结果和领奖进度。</Paragraph>
        </div>
        <div className="lottery-campaign-switcher">
          <div className="lottery-campaign-switcher__controls">
            <Select
              aria-label="按活动编号或名称选择活动"
              showSearch
              value={campaignId}
              loading={listLoading}
              disabled={mutationPending}
              placeholder="搜索活动名称或编号"
              className="lottery-campaign-select"
              filterOption={(input, option) => option.searchText.toLowerCase().includes(input.toLowerCase())}
              options={campaigns.map((item) => {
                const status = item.deleted_at ? "deleted" : item.status;
                return {
                  value: item.id,
                  label: `#${item.id} · ${item.title} · ${CAMPAIGN_STATUS[status]?.label || status}`,
                  searchText: `${item.id} ${item.title} ${item.slug || ""} ${CAMPAIGN_STATUS[status]?.label || status} ${fmtTime(item.start_at)} ${fmtTime(item.end_at)}`,
                  campaign: item,
                };
              })}
              optionRender={({ data }) => (
                <div className="lottery-campaign-option">
                  <div><Tag color="blue">#{data.campaign.id}</Tag>{statusTag(data.campaign.deleted_at ? "deleted" : data.campaign.status)}</div>
                  <Text strong>{data.campaign.title}</Text>
                  <Text type="secondary">{fmtTime(data.campaign.start_at)} 至 {fmtTime(data.campaign.end_at)}</Text>
                </div>
              )}
              onChange={selectCampaign}
            />
            <Button type="primary" disabled={mutationPending} icon={<PlusOutlined />} onClick={() => { setEditorCampaign(null); setEditorOpen(true); }}>新建活动</Button>
          </div>
          <label className="lottery-campaign-switcher__archive"><Switch size="small" checked={includeDeleted} disabled={mutationPending} onChange={(checked) => { listRequestRef.current += 1; setIncludeDeleted(checked); }} />显示已删除活动</label>
        </div>
      </header>

      {listError ? <Alert type="error" showIcon message={listError} action={<Button onClick={() => loadCampaigns()}>重试</Button>} /> : null}
      {loadError ? <Alert type="error" showIcon message={loadError} action={<Button onClick={loadCurrent}>重试</Button>} /> : null}
      {!visibleCampaign && (loading || listLoading) ? <div className="lottery-admin-loading"><Spin tip="正在加载活动…"><div /></Spin></div> : null}
      {!visibleCampaign && !loading && !listLoading && !listError && !loadError ? (
        <Empty className="lottery-admin-empty" description={includeDeleted ? "还没有抽奖活动" : "暂无未删除的活动，可新建活动或开启历史归档"}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditorCampaign(null); setEditorOpen(true); }}>创建第一个活动</Button>
        </Empty>
      ) : null}

      {visibleCampaign ? (
        <Spin spinning={loading || mutationPending}>
          <div className="lottery-current-campaign">
          <CampaignOverview
            campaign={visibleCampaign}
            probabilityPpm={probabilityPpm}
            prizeRows={prizes}
            onEdit={() => { setEditorCampaign(campaign); setEditorOpen(true); }}
            onRefresh={loadCurrent}
            onStatus={changeStatus}
            onDelete={confirmDelete}
          />
          {archived ? <Alert type="warning" showIcon message={`活动 #${campaign.id} 已删除，客户链接已失效`} description={`删除时间：${fmtTime(campaign.deleted_at)}。配置只读，历史抽奖与链接记录保留，仍可继续处理已中奖的领奖事项。`} /> : null}
          <div className="lottery-campaign-context"><Tag color="blue">当前活动 #{campaign.id}</Tag><Text strong>{campaign.title}</Text><Text type="secondary">以下奖品、授权、链接与记录仅属于此活动</Text></div>
          <Tabs
            key={`${campaign.id}-${archived ? "archived" : "active"}`}
            className="lottery-admin-tabs"
            destroyOnHidden
            items={[
              { key: "prizes", label: <span><GiftOutlined /> 奖品与概率</span>, children: <PrizesPanel campaign={campaign} rows={prizes} loading={loading} onReload={loadCurrent} onChanged={() => loadCampaigns()} /> },
              { key: "staff", label: <span><TeamOutlined /> 员工授权</span>, children: <StaffPanel campaign={campaign} /> },
              { key: "links", label: <span><LinkOutlined /> 客户链接</span>, children: <LinksPanel campaign={campaign} /> },
              { key: "draws", label: <span><AuditOutlined /> 抽奖记录</span>, children: <DrawsPanel campaign={campaign} /> },
              { key: "claims", label: <span><TrophyOutlined /> 领奖处理</span>, children: <ClaimsPanel campaign={campaign} /> },
              { key: "audit", label: <span><AuditOutlined /> 配置审计</span>, children: <AuditPanel campaign={campaign} /> },
            ]}
          />
          </div>
        </Spin>
      ) : null}

      <CampaignEditor
        open={editorOpen}
        campaign={editorCampaign}
        onClose={() => setEditorOpen(false)}
        onSaved={(saved) => {
          setEditorOpen(false);
          if (editorCampaign?.id && String(selectedCampaignRef.current) !== String(editorCampaign.id)) {
            // An edit completing after a switch must not pull the user back.
            loadCampaigns();
            return;
          }
          if (saved?.id && String(saved.id) !== String(campaignId)) selectCampaign(saved.id);
          loadCampaigns(saved?.id || campaignId);
          if (saved?.id && String(saved.id) === String(campaignId)) loadCurrent();
        }}
      />
    </div>
  );
}
