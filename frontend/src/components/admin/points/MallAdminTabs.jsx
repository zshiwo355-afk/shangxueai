import { GiftOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Alert, App as AntdApp, Button, Card, Checkbox, Descriptions, Drawer, Form, Input,
  InputNumber, Modal, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography, Upload,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminSearchUsers } from "../../../lib/api.admin";
import {
  createAdminMallProduct, fetchAdminMallGrants, fetchAdminMallProducts, fetchAdminMallRedemptions,
  fetchAdminMallSummary, grantMallPoints, updateAdminMallProduct, uploadAdminMallImage, verifyMallRedemption,
} from "../../../lib/api.mall";
import MaterialAssetPickerModal, { fetchMaterialAssetAsFile } from "../../common/MaterialAssetPickerModal";
import { grantRequest, productFormPayload, productUpdatePayload, validMallImageUrl, validMallPoints } from "./mall-admin-utils";
import "./mall-admin.css";

const { Text } = Typography;
const timeText = (value) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
const moneyText = (value) => `¥${Number(value || 0).toLocaleString("zh-CN")}`;
const initialPage = { page: 1, page_size: 10 };

function usePagedMall(loader, params) {
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    loader(params)
      .then((result) => { if (alive) setData({ items: result.items || [], total: result.total || 0 }); })
      .catch((err) => { if (alive) setError(err.message || "加载失败，请重试。"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loader, params, version]);
  return { data, loading, error, reload };
}

function pagination(params, total, setParams) {
  return {
    current: params.page, pageSize: params.page_size, total,
    showSizeChanger: true, pageSizeOptions: [10, 20, 50], showTotal: (count) => `共 ${count} 条`,
    onChange: (page, pageSize) => setParams((current) => ({ ...current, page: pageSize === current.page_size ? page : 1, page_size: pageSize })),
  };
}

function LoadError({ error, reload }) {
  return error ? <Alert className="mall-admin-alert" type="error" showIcon message={error} action={<Button size="small" onClick={reload}>重试</Button>} /> : null;
}

export function MallGrantsTab() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const userId = Form.useWatch("user_id", form);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [params, setParams] = useState(initialPage);
  const ledger = usePagedMall(fetchAdminMallGrants, params);
  const request = useRef(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(() => {
      adminSearchUsers({ keyword: search, page: 1, page_size: 20, include_disabled: false })
        .then((result) => {
          if (alive) setUsers((Array.isArray(result) ? result : result.items || []).filter((user) => !user.disabled));
        })
        .catch((err) => { if (alive) { setUsers([]); setSearchError(err.message || "员工搜索失败。"); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    let alive = true;
    setSummary(null);
    setSummaryError("");
    if (!userId) { setSummaryLoading(false); return undefined; }
    setSummaryLoading(true);
    fetchAdminMallSummary(userId)
      .then((result) => { if (alive) setSummary(result); })
      .catch((err) => { if (alive) setSummaryError(err.message || "商城积分加载失败。"); })
      .finally(() => { if (alive) setSummaryLoading(false); });
    return () => { alive = false; };
  }, [userId, summaryVersion]);

  const submit = async () => {
    if (submittingRef.current) return;
    let values;
    try { values = await form.validateFields(); } catch { return; }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      request.current = grantRequest(request.current, { user_id: values.user_id, points: values.points, remark: values.remark.trim() });
      await grantMallPoints(request.current.payload);
      request.current = null;
      message.success(`已发放 ${values.points} 商城积分。`);
      form.resetFields(["points", "remark"]);
      setSummaryVersion((value) => value + 1);
      ledger.reload();
    } catch (err) {
      message.error(err.message || "积分发放失败，请重试。");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="mall-admin">
      <Alert className="mall-admin-alert" showIcon type="info" message="商城积分由管理员发放，1 积分可兑换 20 元商品" description="与学习积分独立。兑换只扣可用余额，累计获得积分用于排行榜。" />
      <Card title="发放商城积分" className="mall-admin-grant-card">
        <Form form={form} layout="vertical" initialValues={{ points: 1 }} disabled={submitting} onValuesChange={() => { request.current = null; }} onFinish={submit}>
          <div className="mall-admin-grant-grid">
            <Form.Item name="user_id" label="选择员工" rules={[{ required: true, message: "请选择已有员工" }]}>
              <Select showSearch allowClear filterOption={false} loading={searching} onSearch={setSearch} placeholder="输入姓名或工号搜索"
                options={users.map((user) => ({ value: user.id, label: `${user.real_name || user.display_name || user.username} · ${user.department || "未分部门"} · ${user.username}` }))}
                notFoundContent={searching ? <Spin size="small" /> : "没有匹配的员工"} />
            </Form.Item>
            <Form.Item name="points" label="发放积分" rules={[{ required: true, message: "请输入正整数积分" }, { validator: (_, value) => Number.isSafeInteger(value) && value > 0 ? Promise.resolve() : Promise.reject(new Error("积分必须为正整数")) }]}>
              <InputNumber min={1} max={1000000000} precision={0} style={{ width: "100%" }} addonAfter="积分" />
            </Form.Item>
          </div>
          {searchError ? <Alert className="mall-admin-alert" type="error" showIcon message={searchError} /> : null}
          {userId ? <Spin spinning={summaryLoading}>
            <LoadError error={summaryError} reload={() => setSummaryVersion((value) => value + 1)} />
            {summary ? <div className="mall-admin-summary">
              <Statistic title="累计获得" value={summary.total_points} suffix="分" />
              <Statistic title="可用余额" value={summary.balance_points} suffix="分" />
              <Statistic title="已兑换" value={summary.redeemed_points} suffix="分" />
            </div> : null}
          </Spin> : null}
          <Form.Item name="remark" label="发放原因" rules={[{ required: true, whitespace: true, message: "请填写发放原因" }, { max: 500 }]}>
            <Input.TextArea rows={2} maxLength={500} showCount placeholder="例如：10 月业务贡献奖励" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={submitting} disabled={!!userId && (summaryLoading || !!summaryError)}>确认发放</Button>
        </Form>
      </Card>
      <div className="mall-admin-toolbar">
        <Text strong>发放记录</Text>
        <Space wrap>
          <Input.Search allowClear placeholder="搜索姓名或工号" onSearch={(keyword) => setParams((current) => ({ ...current, keyword, page: 1 }))} style={{ width: 240 }} />
          <Button icon={<ReloadOutlined />} onClick={ledger.reload} loading={ledger.loading}>刷新</Button>
        </Space>
      </div>
      <LoadError error={ledger.error} reload={ledger.reload} />
      <Table rowKey="id" dataSource={ledger.data.items} loading={ledger.loading} scroll={{ x: 850 }} locale={{ emptyText: "暂无商城积分发放记录" }}
        pagination={pagination(params, ledger.data.total, setParams)} columns={[
          { title: "发放时间", dataIndex: "created_at", width: 175, render: timeText },
          { title: "员工", dataIndex: "user_name", width: 120 },
          { title: "部门", dataIndex: "department", width: 150, render: (value) => value || "—" },
          { title: "发放积分", dataIndex: "points", width: 100, render: (value) => <Text type="success" strong>+{value}</Text> },
          { title: "原因", dataIndex: "remark", width: 250 },
          { title: "操作人", dataIndex: "operator_name", width: 120 },
        ]} />
    </div>
  );
}

function ProductEditor({ product, onClose, onSaved, onRefresh }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const savingRef = useRef(false);
  const request = useRef(null);
  const imageUrl = Form.useWatch("image_url", form);
  const pointsCost = Form.useWatch("points_cost", form);

  const uploadImage = async (file) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error("仅支持 JPG、PNG、WEBP 图片。");
    if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10MB。");
    const result = await uploadAdminMallImage(file);
    if (!result.image_url) throw new Error("上传完成，但没有获得图片地址。");
    form.setFieldsValue({ image_url: result.image_url });
    request.current = null;
    message.success("商品图片已上传。");
  };

  const save = async () => {
    if (savingRef.current || uploading) return;
    let values;
    try { values = await form.validateFields(); } catch { return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = productFormPayload(values);
      if (product?.id) {
        await updateAdminMallProduct(product.id, productUpdatePayload(product, payload));
      } else {
        const fingerprint = JSON.stringify(payload);
        if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, payload: { ...payload, request_id: crypto.randomUUID() } };
        await createAdminMallProduct(request.current.payload);
      }
      message.success(product?.id ? "商品已更新。" : "商品已添加。");
      onSaved();
    } catch (err) {
      if (product?.id && err.status === 409) setVersionConflict(true);
      message.error(err.message || "商品保存失败，请重试。");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Drawer open title={product?.id ? "编辑商品" : "新增商品"} width={560} onClose={saving || uploading ? undefined : onClose} closable={!saving && !uploading} maskClosable={!saving && !uploading}
      extra={<Button type="primary" onClick={save} loading={saving} disabled={uploading || versionConflict}>保存商品</Button>}>
      {versionConflict ? <Alert className="mall-admin-alert" type="warning" showIcon message="商品信息已变动，请刷新后重新编辑" description="当前编辑版本已过期。请刷新核对商品的最新信息，再决定是否修改。" action={<Button size="small" onClick={() => { onClose(); onRefresh(); }}>关闭并刷新</Button>} /> : null}
      <Form form={form} layout="vertical" disabled={saving || uploading} initialValues={{ name: "", description: "", image_url: "", stock: 1, enabled: true, ...product, points_cost: product?.points_cost ?? 1 }} onValuesChange={() => { request.current = null; }}>
        <Form.Item name="name" label="商品名称" rules={[{ required: true, whitespace: true, message: "请输入商品名称" }, { max: 120 }]}><Input maxLength={120} placeholder="例如：保温杯" /></Form.Item>
        <Form.Item name="description" label="商品说明" rules={[{ max: 2000 }]}><Input.TextArea rows={3} maxLength={2000} showCount placeholder="规格、领取说明等" /></Form.Item>
        <Form.Item name="image_url" label="商品图片" rules={[{ validator: (_, value) => validMallImageUrl((value || "").trim()) ? Promise.resolve() : Promise.reject(new Error("请使用 HTTPS 图片地址或上传图片")) }]}>
          <Input placeholder="HTTPS 图片地址，也可从下方上传或选素材" />
        </Form.Item>
        <div className="mall-admin-image-picker">
          {imageUrl && validMallImageUrl(imageUrl) ? <img className="mall-admin-image-preview" src={imageUrl} alt="商品图片预览" /> : <div className="mall-admin-image-preview mall-admin-image-empty"><GiftOutlined /></div>}
          <Space wrap>
            <Upload accept="image/jpeg,image/png,image/webp" showUploadList={false} disabled={saving || uploading} beforeUpload={async (file) => {
              setUploading(true);
              try { await uploadImage(file); } catch (err) { message.error(err.message); } finally { setUploading(false); }
              return Upload.LIST_IGNORE;
            }}><Button icon={<UploadOutlined />} loading={uploading} disabled={saving}>上传图片</Button></Upload>
            <Button onClick={() => setPickerOpen(true)} disabled={saving || uploading}>从素材库选择</Button>
            {imageUrl ? <Button type="text" danger disabled={saving || uploading} onClick={() => { form.setFieldValue("image_url", ""); request.current = null; }}>清除图片</Button> : null}
          </Space>
        </div>
        <Text type="secondary">支持 JPG、PNG、WEBP，单张不超过 10MB。</Text>
        <div className="mall-admin-product-grid">
          <Form.Item name="points_cost" label="兑换积分" extra={validMallPoints(pointsCost) ? `商城显示金额：${moneyText(pointsCost * 20)}（1 积分 = 20 元）` : "请输入正整数积分，1 积分 = 20 元"}
            rules={[{ required: true, message: "请输入兑换积分" }, { validator: (_, value) => validMallPoints(value) ? Promise.resolve() : Promise.reject(new Error("兑换积分必须为 1 至 100000000 的整数")) }]}>
            <InputNumber min={1} max={100000000} step={1} precision={0} style={{ width: "100%" }} suffix="积分" />
          </Form.Item>
          <Form.Item name="stock" label="可兑换库存" rules={[{ required: true, message: "请输入库存" }, { validator: (_, value) => Number.isSafeInteger(value) && value >= 0 ? Promise.resolve() : Promise.reject(new Error("库存必须为非负整数")) }]}>
            <InputNumber min={0} max={1000000000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </div>
        <Form.Item name="enabled" label="上架状态" valuePropName="checked"><Switch checkedChildren="已上架" unCheckedChildren="已下架" /></Form.Item>
      </Form>
      <MaterialAssetPickerModal open={pickerOpen} title="选择商品图片" assetType="image" acceptExtensions={["jpg", "jpeg", "png", "webp"]} onCancel={() => { if (!uploading) setPickerOpen(false); }}
        onPick={async (asset) => {
          setUploading(true);
          try { await uploadImage(await fetchMaterialAssetAsFile(asset)); setPickerOpen(false); } finally { setUploading(false); }
        }} />
    </Drawer>
  );
}

export function MallProductsTab() {
  const [params, setParams] = useState(initialPage);
  const products = usePagedMall(fetchAdminMallProducts, params);
  const [editing, setEditing] = useState(null);
  return (
    <div className="mall-admin">
      <div className="mall-admin-toolbar">
        <div><Text strong>兑换商品</Text><div><Text type="secondary">按积分设置兑换价格，员工商城按 1 积分 = 20 元显示金额。兑换后到前台领取。</Text></div></div>
        <Space wrap><Button icon={<ReloadOutlined />} onClick={products.reload} loading={products.loading}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>新增商品</Button></Space>
      </div>
      <LoadError error={products.error} reload={products.reload} />
      <Table rowKey="id" loading={products.loading} dataSource={products.data.items} scroll={{ x: 800 }} locale={{ emptyText: "尚未添加兑换商品" }}
        pagination={pagination(params, products.data.total, setParams)} columns={[
          { title: "商品", dataIndex: "name", width: 300, render: (name, row) => <div className="mall-admin-product-cell">{row.image_url ? <img src={row.image_url} alt="" /> : <GiftOutlined />}<div><Text strong>{name}</Text><div className="mall-admin-product-description">{row.description || "—"}</div></div></div> },
          { title: "兑换积分 / 展示金额", dataIndex: "points_cost", width: 160, render: (value, row) => <><Text strong>{value} 积分</Text><div><Text type="secondary">{moneyText(row.price_yuan)}</Text></div></> },
          { title: "可兑换库存", dataIndex: "stock", width: 115, render: (value) => value > 0 ? value : <Tag color="orange">已兑完</Tag> },
          { title: "状态", dataIndex: "enabled", width: 100, render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "已上架" : "已下架"}</Tag> },
          { title: "操作", key: "actions", width: 100, fixed: "right", render: (_, product) => <Button size="small" onClick={() => setEditing(product)}>编辑</Button> },
        ]} />
      {editing ? <ProductEditor product={editing} onClose={() => setEditing(null)} onRefresh={products.reload} onSaved={() => { setEditing(null); products.reload(); }} /> : null}
    </div>
  );
}

export function MallRedemptionsTab() {
  const { message } = AntdApp.useApp();
  const [params, setParams] = useState(initialPage);
  const records = usePagedMall(fetchAdminMallRedemptions, params);
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false);
  const verify = async () => {
    if (!selected || !confirmed || verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    try {
      await verifyMallRedemption(selected.id);
      message.success("已核销，商品领取完成。");
      setSelected(null);
      records.reload();
    } catch (err) {
      message.error(err.message || "领取核销失败，请重试。");
      records.reload();
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };
  return (
    <div className="mall-admin">
      <Alert className="mall-admin-alert" type="info" showIcon message="员工凭领取码到前台领实物。请核对姓名与商品，交付后再确认核销。" />
      <div className="mall-admin-toolbar">
        <Space wrap>
          <Input.Search allowClear placeholder="搜索姓名或领取码" onSearch={(keyword) => setParams((current) => ({ ...current, keyword, page: 1 }))} style={{ width: 260 }} />
          <Select value={params.status || ""} style={{ width: 130 }} onChange={(status) => setParams((current) => ({ ...current, status, page: 1 }))} options={[{ value: "", label: "全部状态" }, { value: "pending", label: "待领取" }, { value: "redeemed", label: "已领取" }]} />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={records.reload} loading={records.loading}>刷新</Button>
      </div>
      <LoadError error={records.error} reload={records.reload} />
      <Table rowKey="id" loading={records.loading} dataSource={records.data.items} scroll={{ x: 1130 }} locale={{ emptyText: "暂无兑换记录" }}
        pagination={pagination(params, records.data.total, setParams)} columns={[
          { title: "兑换时间", dataIndex: "created_at", width: 175, render: timeText },
          { title: "员工", dataIndex: "user_name", width: 130, render: (name, row) => <>{name}<div><Text type="secondary">{row.department || "—"}</Text></div></> },
          { title: "领取码", dataIndex: "code", width: 170, render: (code) => <Text code copyable>{code}</Text> },
          { title: "商品", dataIndex: "product_name", width: 190 },
          { title: "金额 / 扣除积分", dataIndex: "price_yuan", width: 150, render: (value, row) => <>{moneyText(value)}<div><Text type="secondary">{row.points_cost} 积分</Text></div></> },
          { title: "领取状态", dataIndex: "status", width: 180, render: (status, row) => <><Tag color={status === "redeemed" ? "green" : "gold"}>{status === "redeemed" ? "已领取" : "待领取"}</Tag>{status === "redeemed" ? <div><Text type="secondary">{row.redeemed_by_name || "管理员"}<br />{timeText(row.redeemed_at)}</Text></div> : null}</> },
          { title: "操作", key: "actions", width: 120, fixed: "right", render: (_, row) => <Button size="small" type={row.status === "pending" ? "primary" : "default"} disabled={row.status !== "pending"} onClick={() => { setSelected(row); setConfirmed(false); }}>核销领取</Button> },
        ]} />
      <Modal open={!!selected} title="确认前台领取" okText="确认已交付并核销" cancelText="取消" onCancel={() => { if (!verifying) setSelected(null); }} onOk={verify}
        confirmLoading={verifying} okButtonProps={{ disabled: !confirmed }} closable={!verifying} maskClosable={!verifying} cancelButtonProps={{ disabled: verifying }}>
        {selected ? <>
          <Descriptions column={1} size="small" className="mall-admin-verify-details" items={[
            { key: "user", label: "领取员工", children: `${selected.user_name} · ${selected.department || "未分部门"}` },
            { key: "code", label: "领取码", children: <Text strong code>{selected.code}</Text> },
            { key: "product", label: "商品", children: selected.product_name },
            { key: "points", label: "已扣积分", children: `${selected.points_cost} 积分` },
          ]} />
          <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={verifying}>已核对领取人和领取码，实物已交付</Checkbox>
        </> : null}
      </Modal>
    </div>
  );
}
