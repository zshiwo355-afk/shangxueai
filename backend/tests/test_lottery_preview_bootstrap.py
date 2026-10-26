"""The preview credential is removed before application bundles can load."""
import ast
import html
import json
from pathlib import Path
import re
import shutil
import subprocess

import pytest


def render_preview():
    source = Path(__file__).parents[1] / "app" / "main.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {"_inject_live_meta", "_render_lottery_preview_html"}]
    namespace = {"html": html, "re": re}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), namespace)
    return namespace["_render_lottery_preview_html"]


def bootstrap_script():
    result = render_preview()("<html><head><script type='module' src='/assets/app.js'></script></head></html>", None)
    return re.search(r'<script id="lottery-preview-bootstrap">(.*?)</script>', result, re.S).group(1)


def test_bootstrap_precedes_every_external_bundle_and_keeps_metadata():
    result = render_preview()("<html><head><title>App</title><script type='module' src='/assets/app.js'></script></head></html>", {
        "title": "专属好礼", "description": "一次抽奖", "url": "https://example.test/share/lottery/customer", "image": "https://example.test/card.jpg",
    })
    assert result.index('id="lottery-preview-bootstrap"') < result.index("src='/assets/app.js'")
    assert '<head><script id="lottery-preview-bootstrap">' in result
    assert result.count("<title>") == 1
    assert 'property="og:image" content="https://example.test/card.jpg"' in result
    assert "localStorage" not in result and "sessionStorage" not in result


@pytest.mark.parametrize("mode", ["consume", "release", "route-change", "pagehide", "history-error", "oversized", "wrong-route"])
def test_bootstrap_runtime_without_any_application_javascript(mode):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is needed to execute the isolated inline bootstrap")
    runner = r'''
const assert = require("node:assert/strict");
const vm = require("node:vm");
let input="";
process.stdin.setEncoding("utf8");
process.stdin.on("data", value=>input+=value);
process.stdin.on("end",()=>{
  const {source, mode}=JSON.parse(input);
  const events=new Map(), pageEvents=new Map(), calls=[];
  const add=(map,name,callback)=>{ if(!map.has(name))map.set(name,new Set()); map.get(name).add(callback); };
  const remove=(map,name,callback)=>map.get(name)?.delete(callback);
  const emit=(map,name)=>[...(map.get(name)||[])].forEach(callback=>callback());
  const credential=mode==="oversized"?"x".repeat(9000):"employee-preview-test-credential";
  const location={pathname:mode==="wrong-route"?"/lottery/customer":"/lottery-share/customer", search:"?from=singlemessage", hash:"#ticket="+credential};
  let replaced="";
  location.replace=clean=>{replaced=clean;location.hash="";};
  const window={location, WeixinJSBridge:{call:name=>calls.push(name)},
    history:{state:{},replaceState:(_state,_unused,clean)=>{if(mode==="history-error")throw new Error("blocked");replaced=clean;location.hash="";}},
    addEventListener:(name,cb)=>add(pageEvents,name,cb), removeEventListener:(name,cb)=>remove(pageEvents,name,cb)};
  const document={addEventListener:(name,cb)=>add(events,name,cb),removeEventListener:(name,cb)=>remove(events,name,cb)};
  vm.runInNewContext(source,{window,document,URLSearchParams});
  if(mode==="wrong-route"){
    assert.equal(window.__lotteryShareBootstrap,undefined);assert.equal(calls.length,0);return;
  }
  assert.equal(location.hash,"");
  assert.equal(replaced,"/lottery-share/customer?from=singlemessage");
  if(mode==="history-error"){
    assert.equal(window.__lotteryShareBootstrap,undefined);assert.equal(events.get("WeixinJSBridgeReady")?.size||0,0);return;
  }
  const guard=window.__lotteryShareBootstrap;
  assert.ok(guard);
  assert.equal(calls[0],"hideOptionMenu");
  if(mode==="consume"||mode==="oversized"){
    assert.equal(guard.take("/lottery-share/someone-else"),"");
    assert.equal(guard.take(location.pathname),mode==="oversized"?"":credential);
    assert.equal(guard.take(location.pathname),"");
    assert.equal(events.get("WeixinJSBridgeReady").size,1);
    emit(events,"WeixinJSBridgeReady");assert.equal(calls.length,2);
  }else if(mode==="release"){
    const oldListener=[...events.get("WeixinJSBridgeReady")][0];
    guard.release();oldListener();emit(events,"WeixinJSBridgeReady");
    assert.equal(window.__lotteryShareBootstrap,undefined);assert.equal(calls.length,1);
    assert.equal(guard.take(location.pathname),"");
  }else if(mode==="route-change"){
    location.pathname="/lottery/another-customer";
    emit(events,"WeixinJSBridgeReady");
    assert.equal(window.__lotteryShareBootstrap,undefined);assert.equal(calls.length,1);
  }else if(mode==="pagehide"){
    emit(pageEvents,"pagehide");emit(events,"WeixinJSBridgeReady");
    assert.equal(window.__lotteryShareBootstrap,undefined);assert.equal(calls.length,1);
  }
});
'''
    result = subprocess.run([node, "-e", runner], input=json.dumps({"source": bootstrap_script(), "mode": mode}),
                            text=True, capture_output=True, timeout=15, check=False)
    assert result.returncode == 0, result.stderr


def test_preview_consumes_memory_once_and_only_navigates_to_public_document():
    page = (Path(__file__).parents[2] / "frontend" / "src" / "components" / "lottery" / "LotterySharePreviewPage.jsx").read_text(encoding="utf-8")
    assert "useState(takeInitialTicket)" in page
    assert "window.__lotteryShareBootstrap?.take?.(window.location.pathname)" in page
    assert "useEffect(() => () => releasePreviewBootstrap(), [])" in page
    assert "showOptionMenu" not in page and "showMenuItems" not in page
    assert "prepareCardSdk" not in page and "copyText" not in page
    assert 'document.addEventListener("WeixinJSBridgeReady", hideShareMenu)' in page
    assert "window.location.replace(`/share/lottery/${encodeURIComponent(code)}`)" in page
    assert "window.location.replace(destination)" in page
    assert "if (!active || version !== versionRef.current) return" in page


def test_legacy_preview_validates_public_destination_before_navigation():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is needed to execute the frontend destination validation")
    lottery_dir = Path(__file__).parents[2] / "frontend" / "src" / "components" / "lottery"
    page = (lottery_dir / "LotterySharePreviewPage.jsx").read_text(encoding="utf-8")
    helper = page[page.index("function expiryMillis("):page.index("export default function")]
    runner = r'''
import assert from "node:assert/strict";
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const {source, moduleUrl} = JSON.parse(input);
const {customerCardPayload, singleDrawShareRemaining} = await import(moduleUrl);
const validate = Function("customerCardPayload", "singleDrawShareRemaining", source + "; return validatedPublicDestination;")(customerCardPayload, singleDrawShareRemaining);
const origin = "https://example.test";
const now = 1792731600000;
const data = {customer_name: "张先生", remaining_chances: 1, expires_at: now + 60000,
  share: {title: "客户抽奖", url: origin + "/share/lottery/customer?card=3"}};
assert.equal(validate(data, "customer", origin, now), data.share.url);
assert.equal(validate({...data, remaining_chances: 0}, "customer", origin, now), data.share.url);
assert.equal(validate(data, undefined, origin, now), data.share.url);
for (const remaining_chances of [2, -1, "1", null, undefined]) {
  assert.throws(() => validate({...data, remaining_chances}, "customer", origin, now));
}
for (const expires_at of [now, now - 1, null, "not-a-date"]) {
  assert.throws(() => validate({...data, expires_at}, "customer", origin, now), error => error.status === 410);
}
for (const customer_name of ["", " ", null, undefined]) {
  assert.throws(() => validate({...data, customer_name}, "customer", origin, now));
}
for (const url of ["https://outside.test/share/lottery/customer", origin + "/share/lottery/another",
  origin + "/share/lottery/customer/extra", origin + "/lottery/customer", origin + "/share/lottery/customer#ticket=secret",
  origin + "/share/lottery/customer?ticket=secret", "https://user:pass@example.test/share/lottery/customer"]) {
  assert.throws(() => validate({...data, share: {...data.share, url}}, "customer", origin, now));
}
'''
    result = subprocess.run([node, "--input-type=module", "-e", runner],
                            input=json.dumps({"source": helper, "moduleUrl": (lottery_dir / "lottery-share-utils.js").as_uri()}),
                            text=True, capture_output=True, timeout=15, check=False)
    assert result.returncode == 0, result.stderr
