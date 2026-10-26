export function customerCardPayload(share, expectedPublicCode) {
  const invalid = () => { throw new Error('客户卡片链接不正确，请重新生成分享入口。'); };
  const value = share?.url;
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(value)) invalid();
  const link = new URL(value);
  const match = link.pathname.match(/^\/share\/lottery\/([A-Za-z0-9_-]{1,64})$/);
  const query = [...link.searchParams.entries()];
  if (!['https:', 'http:'].includes(link.protocol) || !match || link.username || link.password || link.hash
    || (expectedPublicCode !== undefined && match[1] !== expectedPublicCode)
    || query.length > 1 || query.some(([key, version]) => key !== 'card' || !/^[1-9][0-9]{0,9}$/.test(version))) invalid();
  return { title: share.title || '客户专属抽奖', desc: share.description || '', link: link.href, imgUrl: share.image || '' };
}

export function shareBrowserKind(userAgent = '') {
  return /MicroMessenger/i.test(userAgent) && !/wxwork/i.test(userAgent) ? 'wechat' : 'browser';
}

export function singleDrawShareRemaining(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1) {
    throw new Error('未能确认单次抽奖规则，请刷新后再发送。');
  }
  return value;
}

export function prepareCardSdk(wx, sdk, share, kind, timeout = 12000) {
  const payload = customerCardPayload(share);
  if (kind !== 'wechat') return Promise.reject(new Error('请使用普通微信分享客户链接。'));
  if (!sdk?.enabled || !wx?.config) return Promise.reject(new Error('当前平台的分享签名未就绪。'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(wx);
    };
    const fail = (error) => finish(new Error(`分享配置失败：${error?.errMsg || error?.err_msg || '请检查对应平台的 JS 接口安全域名'}`));
    const ready = () => {
      if (settled) return;
      const show = () => {
        if (settled) return;
        wx.showOptionMenu?.();
        wx.showMenuItems?.({ menuList: ['menuItem:share:appMessage'] });
        wx.hideMenuItems?.({ menuList: ['menuItem:share:timeline', 'menuItem:share:qq', 'menuItem:share:weiboApp'] });
        finish();
      };
      if (wx.updateAppMessageShareData) {
        wx.updateAppMessageShareData({ ...payload, success: show, fail });
        // Older clients still need this registration. Its success callback means
        // a share action, not configuration, and must not be treated as a send receipt.
        wx.onMenuShareAppMessage?.({ ...payload });
      } else if (wx.onMenuShareAppMessage) {
        wx.onMenuShareAppMessage({ ...payload, fail });
        show();
      } else finish(new Error('当前客户端没有网页卡片分享能力，请更新微信。'));
    };
    const timer = setTimeout(() => finish(new Error('分享初始化超时，请重试并检查网络或 JS 接口安全域名。')), timeout);
    try {
      wx.ready(ready);
      wx.error?.(fail);
      wx.config({ debug: false, appId: sdk.app_id, timestamp: sdk.timestamp,
        nonceStr: sdk.nonce_str, signature: sdk.signature,
        jsApiList: [...new Set([...(sdk.js_api_list || []), 'showOptionMenu', 'showMenuItems', 'hideMenuItems', 'onMenuShareAppMessage', 'updateAppMessageShareData'])] });
    } catch (error) { finish(error); }
  });
}
