"""Public share landing pages stay forwardable without employee credentials."""
import ast
from copy import deepcopy
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
from types import SimpleNamespace

from fastapi import Request
from fastapi.responses import HTMLResponse
import pytest

from app.lottery_share_page import render_lottery_share_page


CODE = "customer-code_1"
ORIGIN = "https://example.test"
INDEX = '<html><head><title>怀仁商学院</title><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>'


def metadata(**overrides):
    return {
        "title": "客户专属好礼",
        "description": "一份心意，一次好运。",
        "url": f"{ORIGIN}/share/lottery/{CODE}?card=2",
        "lottery_url": f"{ORIGIN}/lottery/{CODE}",
        "image": f"{ORIGIN}/api/public/lottery/{CODE}/share-image.jpg?v=8",
        **overrides,
    }


def render(meta=None, **kwargs):
    return render_lottery_share_page(metadata() if meta is None else meta, CODE, ORIGIN, index_html=INDEX, **kwargs)


def test_valid_share_directly_loads_the_app_without_a_redirect_or_invitation():
    page, status = render()
    assert status == 200
    assert '<title>客户专属好礼</title>' in page
    assert f'property="og:url" content="{ORIGIN}/share/lottery/{CODE}?card=2"' in page
    assert f'rel="canonical" href="{ORIGIN}/share/lottery/{CODE}?card=2"' in page
    assert '<div id="root"></div>' in page and 'src="/assets/app.js"' in page
    assert page.count('<title>') == 1 and '<title>怀仁商学院</title>' not in page
    assert '进入抽奖页面' not in page and '发送给朋友' not in page
    assert 'http-equiv' not in page and 'location.' not in page
    assert '<a ' not in page and '<form' not in page


def test_public_html_has_no_employee_material_or_mutating_requests():
    data = metadata(ticket="private-preview-credential", customer_name="private-customer-name", expires_at="2099-01-01")
    before = deepcopy(data)
    page, status = render(data)
    assert status == 200 and data == before
    for forbidden in ("private-preview-credential", "private-customer-name", "2099-01-01", "ticket", "localStorage", "sessionStorage", "fetch(", "XMLHttpRequest", "share-session", "share-preview", "/draw", "chance_total", "剩余"):
        assert forbidden not in page
    assert 'showOptionMenu' in page and 'hideOptionMenu' not in page
    assert 'hideMenuItems' not in page and 'wx.config' not in page


def test_public_app_shell_never_contains_sales_instructions():
    page, status = render()
    assert status == 200
    for forbidden in ('微信转发指引', '销售转发', '不用先进入抽奖页', '进入抽奖页面', 'share-guide', '<article class="invitation">'):
        assert forbidden not in page
    assert 'window.location' not in page and '/draw' not in page


def test_html_escapes_title_description_and_image_attributes():
    title = '<img src=x onerror=alert(1)> "专属"'
    description = '<script>alert("unsafe")</script> & 朋友'
    image = 'https://images.example.test/card.png?caption="onerror="boom"&v=2'
    page, status = render(metadata(title=title, description=description, image=image))
    assert status == 200
    assert html.escape(title) in page and html.escape(description) in page
    assert html.escape(image, quote=True) in page
    assert '<img src=x' not in page and '<script>alert(' not in page
    assert page.count('<script>') == 1
    script = re.search(r'<script>(.*?)</script>', page, re.S).group(1)
    assert 'unsafe' not in script and 'boom' not in script


@pytest.mark.parametrize('field,value', [
    ('url', 'javascript:alert(1)'),
    ('url', f'http://example.test/share/lottery/{CODE}'),
    ('url', f'https://evil.test/share/lottery/{CODE}'),
    ('url', f'https://example.test:444/share/lottery/{CODE}'),
    ('url', f'https://user:secret@example.test/share/lottery/{CODE}'),
    ('url', f'{ORIGIN}/share/lottery/someone-else'),
    ('url', f'{ORIGIN}/share/lottery/{CODE}#ticket=private'),
    ('url', f'{ORIGIN}/share/lottery/{CODE}?ticket=private'),
    ('url', f'{ORIGIN}/share/lottery/{CODE}?%74icket=private'),
    ('url', f'{ORIGIN}/share/lottery/{CODE}?card=1&card=2'),
    ('url', f'{ORIGIN}/share/lottery/{CODE}?card=0'),
    ('url', f'{ORIGIN}/share/lottery/{CODE}?card=not-a-version'),
    ('url', f'{ORIGIN}/share/lottery/{CODE}?redirect=https://evil.test'),
    ('lottery_url', f'https://evil.test/lottery/{CODE}'),
    ('lottery_url', f'{ORIGIN}/lottery/another-code'),
    ('lottery_url', f'{ORIGIN}/lottery/{CODE}?ticket=private'),
    ('lottery_url', f'{ORIGIN}/lottery/{CODE}#private'),
    ('lottery_url', f'{ORIGIN}/lottery/{CODE}\n'),
    ('lottery_url', f'{ORIGIN}/lottery/{CODE}%0a'),
    ('lottery_url', f'https://example.test\\@evil.test/lottery/{CODE}'),
    ('lottery_url', f'//example.test/lottery/{CODE}'),
])
def test_invalid_destination_cannot_become_an_action_or_metadata(field, value):
    page, status = render(metadata(**{field: value}))
    assert status == 404
    assert '活动邀请已失效' in page
    assert '<a ' not in page and '<script>' not in page
    assert '进入抽奖页面' not in page and 'property="og:url"' not in page
    assert value not in page


@pytest.mark.parametrize('image', [
    'javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//images.example.test/card.jpg',
    'https://user:password@images.example.test/card.jpg',
    'https://images.example.test/card.jpg#private',
    'https://images.example.test/card.jpg?access_token=private',
    'https://images.example.test/card.jpg?SeSsIoN=private',
    'https://images.example.test/card.jpg%0d%0a',
])
def test_invalid_image_uses_decorative_fallback_without_blocking_invitation(image):
    page, status = render(metadata(image=image))
    assert status == 200 and '<div id="root"></div>' in page
    assert 'property="og:image"' not in page and '<img ' not in page
    assert image not in page


def test_public_external_image_and_matching_default_port_are_supported():
    page, status = render(metadata(image='https://cdn.example.test/card.jpg?v=2',
                                   url=f'https://example.test:443/share/lottery/{CODE}'))
    assert status == 200
    assert 'property="og:image" content="https://cdn.example.test/card.jpg?v=2"' in page
    assert 'name="referrer" content="no-referrer"' in page


def test_existing_live_url_alias_is_supported_for_lottery_meta_only():
    data = metadata()
    data['live_url'] = data.pop('lottery_url')
    page, status = render(data)
    assert status == 200 and '<div id="root"></div>' in page


@pytest.mark.parametrize('meta', [None, {}, [], 'unexpected'])
def test_missing_or_invalid_metadata_is_unavailable_without_action(meta):
    page, status = render_lottery_share_page(meta, CODE, ORIGIN)
    assert status == 404 and '<a ' not in page


@pytest.mark.parametrize('code', ['../escape', 'code/another', 'code%2fother', 'x' * 65])
def test_malformed_code_is_not_reflected(code):
    page, status = render_lottery_share_page(metadata(), code, ORIGIN)
    assert status == 404 and code not in page


def test_transient_failure_does_not_render_cached_valid_action():
    page, status = render(temporarily_unavailable=True)
    assert status == 503 and '活动暂时无法加载' in page
    assert '<a ' not in page and '进入抽奖页面' not in page


@pytest.mark.parametrize('late_bridge', [False, True])
def test_native_menu_script_only_shows_the_menu(late_bridge):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is needed for the isolated native-menu script')
    page, _ = render()
    source = re.search(r'<script>(.*?)</script>', page, re.S).group(1)
    runner = r'''
const assert=require("node:assert/strict"),vm=require("node:vm");
let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>input+=chunk);
process.stdin.on("end",()=>{
  const {source,late}=JSON.parse(input),calls=[],listeners={};
  const window={},document={addEventListener:(name,fn)=>listeners[name]=fn};
  const bridge={call:name=>calls.push(name)};
  if(!late)window.WeixinJSBridge=bridge;
  const reject=()=>{throw new Error("invitation must not execute requests")};
  vm.runInNewContext(source,{window,document,fetch:reject,XMLHttpRequest:reject});
  if(late){assert.deepEqual(calls,[]);window.WeixinJSBridge=bridge;listeners.WeixinJSBridgeReady();}
  assert.deepEqual(calls,["showOptionMenu"]);
});'''
    result = subprocess.run([node, '-e', runner], input=json.dumps({'source': source, 'late': late_bridge}),
                            text=True, capture_output=True, timeout=15, check=False)
    assert result.returncode == 0, result.stderr


def _route_namespace(lookup, frontend_dist):
    path = Path(__file__).parents[1] / 'app' / 'main.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    route = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'lottery_share_entry')
    route.decorator_list = []

    class Context:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *_args):
            return False

    namespace = {
        'Request': Request, 'HTMLResponse': HTMLResponse, 'session_scope': Context,
        'get_public_lottery_meta': lookup, 'render_lottery_share_page': render_lottery_share_page,
        'settings': SimpleNamespace(resolved_wecom_frontend_base_url=ORIGIN),
        'FRONTEND_HTML_HEADERS': {'Cache-Control': 'no-store'},
        'logger': SimpleNamespace(warning=lambda *_args: None),
        'frontend_dist': frontend_dist,
    }
    exec(compile(ast.Module(body=[route], type_ignores=[]), str(path), 'exec'), namespace)
    return namespace


@pytest.mark.parametrize('outcome,expected_status', [('valid', 200), ('deleted', 404), ('failure', 503)])
def test_route_preserves_unavailable_status_and_no_cache(outcome, expected_status, tmp_path):
    async def lookup(_session, public_code, _request):
        assert public_code == CODE
        if outcome == 'failure':
            raise RuntimeError('private-database-diagnostic')
        return metadata() if outcome == 'valid' else None

    (tmp_path / 'index.html').write_text(INDEX, encoding='utf-8')
    namespace = _route_namespace(lookup, tmp_path)
    request = Request({'type': 'http', 'method': 'GET', 'scheme': 'https', 'server': ('example.test', 443),
                       'path': f'/share/lottery/{CODE}', 'headers': []})
    coroutine = namespace['lottery_share_entry'](CODE, request)
    with pytest.raises(StopIteration) as result:
        coroutine.send(None)
    response = result.value.value
    assert response.status_code == expected_status
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.headers['Referrer-Policy'] == 'no-referrer'
    assert b'private-database-diagnostic' not in response.body
    if expected_status == 200:
        assert b'src="/assets/app.js"' in response.body and b'id="root"' in response.body


def test_missing_frontend_build_is_unavailable_without_interstitial():
    page, status = render_lottery_share_page(metadata(), CODE, ORIGIN)
    assert status == 503 and '活动暂时无法加载' in page
    assert '进入抽奖页面' not in page and '发送给朋友' not in page


def test_live_share_still_uses_its_existing_redirect_renderer():
    path = Path(__file__).parents[1] / 'app' / 'main.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    route = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'live_share_entry')
    names = {node.func.id for node in ast.walk(route) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
    assert '_render_live_share_html' in names and 'render_lottery_share_page' not in names
    renderer = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == '_render_live_share_html')
    namespace = {'html': html, 'json': json}
    exec(compile(ast.Module(body=[renderer], type_ignores=[]), str(path), 'exec'), namespace)
    page = namespace['_render_live_share_html']({'title': '直播', 'live_url': f'{ORIGIN}/live/live-code'})
    assert 'http-equiv="refresh"' in page and 'window.location.replace(' in page
