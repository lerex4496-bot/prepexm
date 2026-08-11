"""
Reading a web page she pastes in.

THIS IS THE ONE UNGROUNDED PATH, AND IT SAYS SO
-----------------------------------------------
Everything else the tutor answers from is either an official NCERT textbook or
a document she uploaded herself. A link is neither. It could be a coaching
blog, a forum answer, or a page that is simply wrong, and no amount of fluent
prose will make that visible to her.

So web answers are badged `FROM THE WEB · not verified`, kept in their own
citation kind, and never merged into the NCERT source list. The badge is the
feature. Without it this is just a chatbot with extra steps.

SSRF
----
A URL supplied by a client and fetched by a server is a request to reach
anything the server can reach — including `localhost`, the Postgres container,
and cloud metadata endpoints on 169.254.169.254 that hand out credentials. The
guard here resolves the host first and refuses private, loopback, link-local
and reserved addresses, and re-checks after each redirect, because a public
hostname is free to redirect to 127.0.0.1.
"""

from __future__ import annotations

import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

MAX_BYTES = 2 * 1024 * 1024
TIMEOUT_S = 15
MAX_REDIRECTS = 3

#: A browser-ish agent. Some sites refuse the default urllib string outright,
#: and a refusal here reads to the student as "the link is broken".
_UA = "Mozilla/5.0 (compatible; StudyMate/1.0; +https://example.invalid/studymate)"


class FetchRejected(ValueError):
    """The URL will not be fetched, with a reason worth showing."""


def _assert_public(host: str) -> None:
    """Resolve a hostname and refuse anything that is not a public address."""
    if not host:
        raise FetchRejected("no host in that URL")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise FetchRejected(f"could not resolve {host}") from e

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            # Deliberately specific: this is a security refusal, and a vague
            # message would send someone debugging their network instead.
            raise FetchRejected(
                f"{host} resolves to {ip}, which is a private or internal address. "
                f"Only public web pages can be read."
            )


def _check_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise FetchRejected("only http and https links can be read")
    _assert_public(parsed.hostname or "")
    return url


def fetch(url: str) -> tuple[str, str]:
    """
    Return (page_title, plain_text) for a public web page.

    Redirects are followed manually so every hop can be re-checked: a public
    hostname is perfectly free to 302 to 127.0.0.1, and urllib would follow it
    without a word.
    """
    current = _check_url(url.strip())

    for _ in range(MAX_REDIRECTS + 1):
        req = urllib.request.Request(current, headers={"User-Agent": _UA})
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(req, timeout=TIMEOUT_S) as resp:
                status = resp.status
                if status in (301, 302, 303, 307, 308):
                    nxt = resp.headers.get("Location")
                    if not nxt:
                        raise FetchRejected("redirect with no destination")
                    current = _check_url(urllib.parse.urljoin(current, nxt))
                    continue

                ctype = (resp.headers.get("Content-Type") or "").lower()
                if "html" not in ctype and "text" not in ctype:
                    raise FetchRejected(f"that link is {ctype or 'not text'}, not a readable page")
                raw = resp.read(MAX_BYTES + 1)
        except urllib.error.HTTPError as e:
            raise FetchRejected(f"the page returned HTTP {e.code}") from e
        except FetchRejected:
            raise
        except Exception as e:
            raise FetchRejected(f"could not load that page ({type(e).__name__})") from e

        if len(raw) > MAX_BYTES:
            raw = raw[:MAX_BYTES]
        html = raw.decode("utf-8", errors="replace")
        return _title(html), _text(html)

    raise FetchRejected("too many redirects")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_DROP_RE = re.compile(r"<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>", re.I | re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")


def _title(html: str) -> str:
    m = _TITLE_RE.search(html)
    return _WS_RE.sub(" ", _TAG_RE.sub("", m.group(1))).strip()[:200] if m else "Web page"


def _text(html: str) -> str:
    """
    Plain text from HTML, without a parser dependency.

    Crude on purpose: script/style/nav are dropped, tags stripped, whitespace
    collapsed. The output feeds a language model that tolerates messy input,
    and adding a parser to shave a few stray characters is not worth another
    dependency in a service that holds API keys.
    """
    body = _DROP_RE.sub(" ", html)
    body = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</h[1-6]>", "\n", body, flags=re.I)
    body = _TAG_RE.sub(" ", body)
    body = (
        body.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    body = _WS_RE.sub(" ", body)
    lines = [ln.strip() for ln in body.split("\n")]
    return "\n".join(ln for ln in lines if len(ln) > 2).strip()
