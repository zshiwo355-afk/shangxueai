"""Native link-card metadata must exist before the browser executes React."""
import ast
import html
import re
from pathlib import Path


def renderer():
    source = Path(__file__).parents[1] / 'app' / 'main.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {'_inject_live_meta', '_render_lottery_preview_html'}]
    namespace = {'html': html, 're': re}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)
    return namespace['_render_lottery_preview_html']


def test_native_preview_keeps_card_metadata_and_one_title():
    result = renderer()('<html><head><title>Generic app</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>', {
        'title': '客户专属 <抽奖>', 'description': '两次机会',
        'image': 'https://example.com/card.jpg', 'url': 'https://example.com/share/lottery/abc?card=2',
    })
    assert result.count('<title>') == 1
    assert '<title>客户专属 &lt;抽奖&gt;</title>' in result
    assert 'property="og:image" content="https://example.com/card.jpg"' in result
    assert 'property="og:url" content="https://example.com/share/lottery/abc?card=2"' in result
    assert '<script src="/app.js"></script>' in result
    assert 'no-referrer' in result
    assert 'ticket=' not in result


def test_native_preview_escapes_metadata():
    result = renderer()('<head></head>', {'title': '</title><script>bad()</script>', 'image': '\" onload=\"bad()'})
    assert '<script>bad()' not in result
    assert 'content="&quot; onload=&quot;bad()"' in result
