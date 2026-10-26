"""Public lottery app shell with card metadata, never employee instructions."""
from __future__ import annotations

from collections.abc import Mapping
import html
import re
from urllib.parse import parse_qs, quote, unquote, urlsplit


_PRIVATE_QUERY_KEYS = frozenset({"ticket", "access_token", "token", "auth", "authorization", "session", "sessionid"})
_NATIVE_MENU_SCRIPT = """<script>(function(){
function show(){try{if(window.WeixinJSBridge)window.WeixinJSBridge.call("showOptionMenu");}catch(ignore){}}
show();document.addEventListener("WeixinJSBridgeReady",show);
})();</script>"""


def _http_url(value: object):
    """Accept absolute HTTP URLs without credentials, fragments or hidden controls."""
    if not isinstance(value, str) or not value or value != value.strip():
        return None
    decoded = unquote(value)
    if any(ord(char) <= 32 or ord(char) == 127 for char in decoded) or "\\" in decoded:
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
                or parsed.password or parsed.fragment or parsed.port == 0):
            return None
        if _PRIVATE_QUERY_KEYS.intersection(key.casefold() for key in parse_qs(parsed.query, keep_blank_values=True)):
            return None
    except ValueError:
        return None
    return parsed


def _origin(parsed) -> tuple[str, str, int]:
    return parsed.scheme, parsed.hostname.casefold(), parsed.port or (443 if parsed.scheme == "https" else 80)


def _validated_metadata(meta: Mapping[str, object] | None, public_code: str, expected_origin: str):
    if not isinstance(meta, Mapping) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", public_code):
        return None
    expected = _http_url(expected_origin)
    share = _http_url(meta.get("url"))
    draw_value = meta.get("lottery_url") or meta.get("live_url")
    draw = _http_url(draw_value)
    if not expected or expected.path not in {"", "/"} or expected.query or not share or not draw:
        return None
    code = quote(public_code, safe="")
    card_query = parse_qs(share.query, keep_blank_values=True)
    if (_origin(share) != _origin(expected) or _origin(draw) != _origin(expected)
            or share.path != f"/share/lottery/{code}" or draw.path != f"/lottery/{code}"
            or draw.query or set(card_query) - {"card"}
            or (card_query and (len(card_query["card"]) != 1 or not re.fullmatch(r"[1-9][0-9]{0,9}", card_query["card"][0])))):
        return None
    # External public image hosts are supported; invalid/protected URLs are not
    # reflected into HTML. Image failure does not make the invitation unusable.
    image_value = meta.get("image")
    image = image_value if _http_url(image_value) else ""
    title = meta.get("title")
    description = meta.get("description")
    return {
        "title": title.strip() if isinstance(title, str) and title.strip() else "客户专属抽奖邀请",
        "description": description.strip() if isinstance(description, str) and description.strip() else "好礼已备，邀您开启一次专属好运。",
        "image": image,
        "url": meta["url"],
        "draw_url": draw_value,
    }


def render_lottery_share_page(
    meta: Mapping[str, object] | None,
    public_code: str,
    expected_origin: str,
    *,
    temporarily_unavailable: bool = False,
    index_html: str | None = None,
) -> tuple[str, int]:
    """Serve the wheel at its share URL, without an invitation or redirect."""
    data = None if temporarily_unavailable else _validated_metadata(meta, public_code, expected_origin)
    if data and index_html:
        title = html.escape(data["title"])
        description = html.escape(data["description"])
        share_url = html.escape(data["url"], quote=True)
        tags = f'''<title>{title}</title>
<meta name="description" content="{description}" />
<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex,nofollow" />
<meta property="og:type" content="website" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{description}" />
<meta property="og:url" content="{share_url}" />
<meta itemprop="name" content="{title}" />
<meta itemprop="description" content="{description}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{title}" />
<meta name="twitter:description" content="{description}" />
<link rel="canonical" href="{share_url}" />'''
        if data["image"]:
            image_url = html.escape(data["image"], quote=True)
            tags += f'''
<meta property="og:image" content="{image_url}" />
<meta itemprop="image" content="{image_url}" />
<meta name="twitter:image" content="{image_url}" />
<link rel="image_src" href="{image_url}" />'''
        # Keep the built app intact, but supply crawler metadata before React.
        # Enabling the native menu has no draw or customer-data side effects.
        source = re.sub(r"<title\b[^>]*>.*?</title>", "", index_html, flags=re.I | re.S)
        source = source.replace("</head>", f"{tags}\n</head>", 1)
        source = source.replace("<head>", f"<head>\n{_NATIVE_MENU_SCRIPT}", 1)
        source = source.replace("</body>", '<noscript>请启用 JavaScript 后查看抽奖活动。</noscript>\n</body>', 1)
        return source, 200

    unavailable = temporarily_unavailable or bool(data)
    status = 503 if unavailable else 404
    title = "活动暂时无法加载" if unavailable else "活动邀请已失效"
    description = ("服务暂时繁忙，请稍后重试。" if unavailable
                   else "此活动已失效或暂不可访问，请联系销售人员确认。")
    return f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex,nofollow" />
<title>{title}</title></head>
<body style="margin:0;background:#f6f1e9;color:#3b2830;font-family:system-ui,sans-serif">
<main style="max-width:460px;margin:20vh auto;padding:24px;text-align:center">
<h1 style="font-size:22px">{title}</h1><p>{description}</p></main>
</body></html>''', status
