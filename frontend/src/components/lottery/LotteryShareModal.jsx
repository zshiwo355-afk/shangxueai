import { CopyOutlined, GiftOutlined, QrcodeOutlined, ReloadOutlined, SendOutlined, WechatOutlined } from '@ant-design/icons';
import { Alert, App, Button, Modal, QRCode, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { getLotteryDirectShareConfig } from '../../lib/api.lottery.share';
import { copyText } from '../../lib/clipboard';
import { customerCardPayload, shareBrowserKind, singleDrawShareRemaining } from './lottery-share-utils';
import './lottery-share-modal.css';

// Late responses must never replace the selected customer's confirmation.
let requestOwner = null;

function CardImage({ src }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed
    ? <img src={src} alt="活动卡片图片" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <div className="lottery-share-modal__image-fallback"><GiftOutlined /><span>客户专属好礼</span></div>;
}

export default function LotteryShareModal({ row, open, onClose }) {
  const { message } = App.useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const [qrVisible, setQrVisible] = useState(false);
  const [linkVisible, setLinkVisible] = useState(false);
  const epochRef = useRef(0);
  const visibleRef = useRef({ open, id: row?.id });
  const currentRef = useRef(() => false);
  const busyRef = useRef(null);
  const linkInputRef = useRef(null);
  visibleRef.current = { open, id: row?.id };
  const kind = shareBrowserKind(window.navigator?.userAgent || '');

  useEffect(() => {
    const epoch = ++epochRef.current;
    const owner = Symbol('lottery-share-modal');
    let active = true;
    const id = row?.id;
    const isCurrent = () => active && epoch === epochRef.current && requestOwner === owner
      && visibleRef.current.open && visibleRef.current.id === id;
    currentRef.current = isCurrent;
    busyRef.current = null;
    setData(null); setError(''); setBusy('');
    setQrVisible(false);
    setLinkVisible(false);
    if (!open || !id) { setLoading(false); return () => { active = false; }; }
    requestOwner = owner;
    setLoading(true);
    const load = async () => {
      let result;
      try {
        result = await getLotteryDirectShareConfig(id, window.location.href.split('#')[0]);
        if (!isCurrent()) return;
        if (!row?.public_code) throw new Error('未能核对客户专属链接，请刷新列表后重试。');
        const card = customerCardPayload(result?.share, row.public_code);
        if (new URL(card.link).origin !== window.location.origin) throw new Error('活动分享地址不正确，请重新加载。');
        const remaining = singleDrawShareRemaining(result?.remaining_chances);
        setData({ ...result, card, remaining, linkId: id });
        setLoading(false);
      } catch (err) {
        if (isCurrent()) { setError(err?.message || '客户卡片加载失败，请重试。'); setLoading(false); }
        return;
      }
    };
    load();
    return () => {
      active = false;
      if (requestOwner === owner) requestOwner = null;
    };
  }, [open, row?.id, revision, kind]);

  const usable = data && data.linkId === row?.id && open;
  const begin = action => {
    if (!usable || !currentRef.current() || busyRef.current) return null;
    const operation = { action, isCurrent: currentRef.current };
    busyRef.current = operation;
    setBusy(action);
    return operation;
  };
  const finish = operation => {
    if (busyRef.current !== operation) return;
    busyRef.current = null;
    if (operation.isCurrent()) setBusy('');
  };
  const openPreview = () => {
    const operation = begin('preview');
    if (!operation) return;
    try {
      // Native forwarding must start from a public URL, never an employee ticket.
      window.location.assign(data.card.link);
    } catch (err) {
      if (operation.isCurrent()) message.error(err?.message || '分享预览打开失败，请重试。');
    } finally { finish(operation); }
  };
  const copyCustomerLink = async () => {
    const operation = begin('copy');
    if (!operation) return;
    try {
      const copied = await copyText(data.card.link);
      if (!operation.isCurrent()) return;
      if (copied) message.success('备用网址已复制。分享给客户请优先用微信扫码后转发页面。');
      else {
        setLinkVisible(true);
        linkInputRef.current?.focus(); linkInputRef.current?.select();
        message.info('请手动复制下方备用网址；直接粘贴给客户仍是文字链接。');
      }
    } catch {
      if (operation.isCurrent()) {
        setLinkVisible(true);
        linkInputRef.current?.focus(); linkInputRef.current?.select();
        message.info('自动复制失败，请手动复制下方客户链接。');
      }
    } finally { finish(operation); }
  };
  return <Modal open={open} title="微信扫码分享" footer={null} onCancel={onClose} destroyOnHidden width={600} style={{ top: 32 }}>
    <div className="lottery-share-modal">
      {loading ? <div className="lottery-share-modal__loading"><Spin /><span>正在核对客户与剩余次数…</span></div> : null}
      {error ? <><Alert type="error" showIcon message="卡片暂时无法加载" description={error} />
        <Button block icon={<ReloadOutlined />} onClick={() => setRevision(value => value + 1)}>重新加载</Button></> : null}
      {usable ? <>
        <section className="lottery-share-modal__recipient" aria-label="发送前确认客户和抽奖次数">
          <div><span>专属客户</span><strong>{data.customer_name || row?.customer_name || '专属客户'}</strong></div>
          <div><span>当前剩余机会</span><strong>{data.remaining}<small> 次</small></strong></div>
        </section>
        <p className="lottery-share-modal__confirm">请转发给上方客户。每条链接仅可抽奖一次，重复转发不会增加机会。</p>
        {data.remaining === 0 ? <Alert type="warning" showIcon message="该客户已用完抽奖机会" description="发送后只能查看已有抽奖结果，不能继续抽奖。" /> : null}
        {kind === 'wechat' ? <section className="lottery-share-modal__wechat">
          <WechatOutlined />
          <h3>在微信里转发给客户</h3>
          <p>打开转盘后，点右上角「···」，选择「发送给朋友」。请勿点击抽奖按钮。</p>
          <Button type="primary" block size="large" icon={<SendOutlined />} disabled={!!busy && busy !== 'preview'} loading={busy === 'preview'} onClick={openPreview}>打开活动页面</Button>
          <span>仅打开或转发页面不会消耗抽奖机会</span>
        </section> : null}
        {kind !== 'wechat' || qrVisible ? <section className="lottery-share-modal__qr" aria-label="销售用手机微信扫码分享">
          <div className="lottery-share-modal__qr-code">
            <QRCode value={data.card.link} size={192} errorLevel="M" bgColor="#fff" color="#172e27" />
            <span><WechatOutlined /> 销售用手机微信扫一扫</span>
          </div>
          <div className="lottery-share-modal__qr-guide">
            <h3>扫码后，转发给客户</h3>
            <ol>
              <li><b>1</b><div><strong>微信扫码</strong><span>直接打开当前客户的转盘页面</span></div></li>
              <li><b>2</b><div><strong>点右上角「···」</strong><span>选择「发送给朋友」</span></div></li>
              <li><b>3</b><div><strong>核对客户并发送</strong><span>客户点击分享的页面即可进入抽奖</span></div></li>
            </ol>
            <p>扫码不会抽奖，请勿点击抽奖按钮。转发页面即可，不用把二维码图片发给客户。</p>
          </div>
        </section> : null}
        <article className="lottery-share-modal__card" aria-label="活动分享素材预览，不是已发送的微信卡片">
          <div className="lottery-share-modal__card-image"><CardImage src={data.card.imgUrl} /></div>
          <div className="lottery-share-modal__card-copy"><h3>{data.card.title}</h3><p>{data.card.desc || '打开卡片，查看客户专属抽奖活动。'}</p></div>
        </article>
        <div className="lottery-share-modal__secondary">
          <Button size="small" type="text" icon={<ReloadOutlined />} disabled={!!busy} onClick={() => setRevision(value => value + 1)}>重新核对次数</Button>
          {kind === 'wechat' ? <Button size="small" type="text" icon={<QrcodeOutlined />} disabled={!!busy} onClick={() => setQrVisible(value => !value)}>{qrVisible ? '收起二维码' : '用另一部手机扫码'}</Button> : null}
        </div>
        <details className="lottery-share-modal__backup" open={linkVisible} onToggle={event => setLinkVisible(event.currentTarget.open)}>
          <summary>备用：复制活动网址</summary>
          <label className="lottery-share-modal__link-label" htmlFor="lottery-modal-customer-link">当前客户专属网址</label>
          <textarea id="lottery-modal-customer-link" ref={linkInputRef} className="lottery-share-modal__link" rows={2}
            value={data.card.link} readOnly spellCheck={false} onFocus={event => event.target.select()} />
          <Button size="small" icon={<CopyOutlined />} disabled={!!busy && busy !== 'copy'} loading={busy === 'copy'} onClick={copyCustomerLink}>复制备用网址</Button>
          <p className="lottery-share-modal__hint">直接粘贴网址是文字链接；微信转发的标题和图片以微信内的实际预览为准。</p>
        </details>
      </> : null}
    </div>
  </Modal>;
}
