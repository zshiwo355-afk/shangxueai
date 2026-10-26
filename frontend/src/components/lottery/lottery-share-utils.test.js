import test from 'node:test';
import assert from 'node:assert/strict';
import { customerCardPayload, prepareCardSdk, shareBrowserKind, singleDrawShareRemaining } from './lottery-share-utils.js';

const share = { title: '客户抽奖', description: '一次机会', url: 'https://example.com/share/lottery/abc?card=2', image: 'https://example.com/card.jpg' };
test('card always targets customer canonical URL, never employee ticket', () => {
  assert.deepEqual(customerCardPayload(share), { title: share.title, desc: share.description, link: share.url, imgUrl: share.image });
  for (const url of ['https://example.com/lottery-share#ticket=secret', 'https://example.com/share/lottery/abc?ticket=secret', 'javascript:alert(1)']) {
    assert.throws(() => customerCardPayload({ ...share, url }));
  }
});
test('QR sharing rejects credentials, unexpected paths and non-card query parameters', () => {
  for (const url of [
    'https://employee:secret@example.com/share/lottery/abc',
    'https://example.com/share/lottery/',
    'https://example.com/share/lottery/abc/draw',
    'https://example.com/share/lottery/abc%2fother',
    'https://example.com/share/lottery/abc?token=secret',
    'https://example.com/share/lottery/abc?Ticket=secret',
    'https://example.com/share/lottery/abc?%74icket=secret',
    'https://example.com/share/lottery/abc?card=3&card=4',
    'https://example.com/share/lottery/abc?card=0',
    'https://example.com/share/lottery/abc?card=hello',
    'https://example.com/share/lottery/abc?redirect=https://evil.test',
    'https://example.com/share/lottery/abc#ticket=secret',
    'https://example.com/share/lottery/abc\n',
    'https://example.com\\@evil.test/share/lottery/abc',
  ]) assert.throws(() => customerCardPayload({ ...share, url }), undefined, url);
});
test('QR destination must belong to the selected customer, not a previous modal', () => {
  assert.equal(customerCardPayload(share, 'abc').link, share.url);
  assert.throws(() => customerCardPayload(share, 'another-customer'), /客户卡片链接/);
  assert.throws(() => customerCardPayload(share, ''), /客户卡片链接/);
  assert.equal(customerCardPayload({ ...share, url: 'https://example.com/share/lottery/abc' }, 'abc').link,
    'https://example.com/share/lottery/abc');
});
test('only ordinary WeChat receives native share controls', () => {
  assert.equal(shareBrowserKind('MicroMessenger wxwork'), 'browser');
  assert.equal(shareBrowserKind('MicroMessenger'), 'wechat');
  assert.equal(shareBrowserKind('Chrome'), 'browser');
});
test('employee ordinary WeChat enables friend share with complete card', async () => {
  let ready; let card; let configured; let shown = false;
  const wx = { ready: cb => { ready = cb; }, error() {}, config: data => { configured = data; ready(); },
    updateAppMessageShareData: data => { card = data; data.success(); }, onMenuShareAppMessage() {},
    showOptionMenu: () => { shown = true; }, showMenuItems() {}, hideMenuItems() {} };
  await prepareCardSdk(wx, { enabled: true, app_id: 'test' }, share, 'wechat');
  assert.equal(card.link, share.url); assert.equal(card.imgUrl, share.image); assert.equal(shown, true);
  assert.ok(configured.jsApiList.includes('showOptionMenu'));
  assert.ok(!configured.jsApiList.includes('hideOptionMenu'));
});
test('older ordinary WeChat uses menu share registration', async () => {
  let ready; let card;
  const wx = { ready: cb => { ready = cb; }, error() {}, config: () => ready(), onMenuShareAppMessage: data => { card = data; } };
  await prepareCardSdk(wx, { enabled: true, app_id: 'test' }, share, 'wechat');
  assert.equal(card.link, share.url);
});
test('SDK errors are errors, not a successful share', async () => {
  let error;
  const wx = { ready() {}, error: cb => { error = cb; }, config: () => error({ errMsg: 'invalid signature' }) };
  await assert.rejects(prepareCardSdk(wx, { enabled: true }, share, 'wechat'), /invalid signature/);
});
test('WeCom cannot initialize lottery sharing even with old configuration', async () => {
  let invoked = false;
  await assert.rejects(prepareCardSdk({ config() { invoked = true; } }, { enabled: true }, share, 'wecom'), /普通微信/);
  assert.equal(invoked, false);
});
test('late share-registration success cannot reopen menus after timeout', async () => {
  let ready; let success; let shown = false;
  const wx = { ready: cb => { ready = cb; }, error() {}, config: () => ready(),
    updateAppMessageShareData: options => { success = options.success; }, showOptionMenu: () => { shown = true; } };
  await assert.rejects(prepareCardSdk(wx, { enabled: true }, share, 'wechat', 5), /超时/);
  success();
  assert.equal(shown, false);
});

test('share confirmation accepts only server-verified zero or one chance', () => {
  assert.equal(singleDrawShareRemaining(0), 0);
  assert.equal(singleDrawShareRemaining(1), 1);
  for (const value of [undefined, null, '1', 2, 1.1, -1, NaN]) {
    assert.throws(() => singleDrawShareRemaining(value), /单次抽奖/);
  }
});
