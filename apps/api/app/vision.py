"""
Reading a photographed question.

WHAT THIS IS FOR
----------------
She is working from a printed book or a coaching handout, hits a question she
cannot do, and photographs it. The alternative is typing out four options in
Hindi on a phone keyboard, which nobody does — so without this the tutor simply
is not reachable from the situation where it is most needed.

WHY IT ONLY TRANSCRIBES
-----------------------
The vision model's job stops at turning pixels into text. It does not answer,
explain or judge. What it produces re-enters the SAME grounded path as a typed
question: retrieve from NCERT, answer only from extracts, cite, refuse when
uncovered.

That split matters. A vision model asked to "answer this question from the
photo" would answer from its own knowledge, and the photo would have laundered
an ungrounded answer into looking like it came from her book. Transcription is
a mechanical claim about what is on the page; an answer is not.

The transcript is always returned to the client so she can see what was read.
OCR gets Devanagari conjuncts and mathematical notation wrong often enough that
a silently-wrong transcription answering a subtly different question is a real
failure — showing it makes that visible in one glance.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request

from sqlalchemy.orm import Session

from . import providers as reg_mod
from .llm import LLMError

#: Phone cameras produce multi-megabyte images; base64 inflates by a third.
MAX_IMAGE_BYTES = 8 * 1024 * 1024

_MIME = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"RIFF": "image/webp",
}

TRANSCRIBE_SYSTEM = """You transcribe exam questions from photographs.

Return ONLY what is printed in the image, as plain text:
- the question, exactly as written
- each option on its own line, with its original label

Rules:
- Transcribe. Do NOT answer, solve, explain or comment.
- Preserve the original language and script. If the question is in Hindi,
  transcribe Devanagari; do not translate it.
- If part of the image is unreadable, write [unclear] at that point rather than
  guessing what it probably said.
- If the image contains no exam question at all, reply with exactly: NO_QUESTION"""


class VisionRejected(ValueError):
    """The image cannot be read, with a reason worth showing."""


def sniff_mime(data: bytes) -> str:
    for magic, mime in _MIME.items():
        if data.startswith(magic):
            return mime
    raise VisionRejected("that file is not a JPEG, PNG or WebP image")


def transcribe(db: Session, data: bytes) -> tuple[str, str, int]:
    """
    Return (text, provider_label, elapsed_ms) for a photographed question.

    Raises VisionRejected for a bad image and LLMError for a provider failure —
    the caller shows those differently, because one is her problem to fix and
    the other is ours.
    """
    if not data:
        raise VisionRejected("empty image")
    if len(data) > MAX_IMAGE_BYTES:
        raise VisionRejected(
            f"image is {len(data) // (1024 * 1024)}MB; the limit is "
            f"{MAX_IMAGE_BYTES // (1024 * 1024)}MB"
        )
    mime = sniff_mime(data)

    # VISION has no fallback in the registry, deliberately: a text model asked
    # to read an image would describe nothing, confidently.
    resolved = reg_mod.resolve(db, "VISION")

    payload = {
        "model": resolved.model,
        "messages": [
            {"role": "system", "content": TRANSCRIBE_SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Transcribe the exam question in this image."},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,{base64.b64encode(data).decode()}"
                        },
                    },
                ],
            },
        ],
        "max_tokens": resolved.max_tokens,
        "temperature": 0.0,
    }

    req = urllib.request.Request(
        f"{resolved.base_url}/chat/completions",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {resolved.api_key}",
        },
    )

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise LLMError(f"{resolved.name} HTTP {e.code}: {e.read().decode()[:200]}") from e
    except Exception as e:
        raise LLMError(f"{resolved.name} {type(e).__name__}: {e}") from e

    ms = int((time.time() - started) * 1000)
    try:
        content = (body["choices"][0]["message"].get("content") or "").strip()
    except (KeyError, IndexError) as e:
        raise LLMError(f"{resolved.name} returned an unexpected shape: {str(body)[:200]}") from e

    if not content:
        raise LLMError(f"{resolved.name} returned no text for this image")
    if content.strip().upper().startswith("NO_QUESTION"):
        raise VisionRejected(
            "no exam question could be found in that photo. Try a straighter, "
            "closer shot of just the question."
        )

    return content, f"{resolved.name}/{resolved.model}", ms
