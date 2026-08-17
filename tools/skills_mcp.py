"""
Expose the whole Antigravity skills library over MCP, on demand.

THE PROBLEM THIS SOLVES
-----------------------
There are 6,059 skills in ~/.gemini/config/skills. INSTALLING them is not an
option and the number says why: their names and descriptions alone come to
1,884,172 characters — about 471,000 tokens — and every installed skill's
frontmatter is loaded at session start. That is roughly 2.4x a 200k context
window spent before a single project file is read. The agent would not be more
capable; it would be unable to start.

So the library is served instead of installed. Nothing is in context until it
is asked for: the agent searches, gets back a handful of names and one-line
descriptions, and pulls the full text of only the skill it actually needs.
6,059 skills for a few hundred tokens.

WHY HAND-ROLLED JSON-RPC AND NOT THE MCP SDK
--------------------------------------------
The `mcp` package is installed here, but this server has to behave identically
under Claude Code, Copilot's agent mode and Codex, each of which pins its own
SDK version. MCP over stdio is newline-delimited JSON-RPC 2.0 and the surface
used here is three methods. Depending on nobody's SDK is fewer moving parts
than depending on three.

THE INDEX IS CACHED, AND IT MATTERS
-----------------------------------
Reading frontmatter from 6,059 files takes seconds. An MCP client that waits
seconds for a tool call looks broken, and some give up and mark the server
failed. So the index is built once into a JSON file and reused; it rebuilds
when the library's directory count changes.

SECURITY NOTE, DELIBERATELY NOT BURIED
--------------------------------------
A skill is INSTRUCTIONS THAT CHANGE HOW AN AGENT BEHAVES — closer to running
untrusted code than to importing a library. This library is flat, so the repo
each skill came from did not survive the flattening and most have no
provenance. `get_skill` therefore returns the text for a human or agent to
READ, and says so; it never installs anything, and this server has no write
path at all.

Register (works for every project):
    claude mcp add -s user skills -- python <abs path to this file>
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# stdout is the PROTOCOL CHANNEL. Anything else printed there corrupts the
# JSON-RPC stream and the client drops the connection, so every human-readable
# message in this file goes to stderr.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HOME = Path.home()
LIBRARY = Path(os.environ.get("SKILLS_LIBRARY", HOME / ".gemini" / "config" / "skills"))
# The 41-repo checkout, where provenance survives. Searched too, and preferred
# in results because "this came from expo_skills" is worth knowing.
REPOS = HOME / ".gemini" / "antigravity-ide" / "scratch" / "skills_manager" / "repos"
CACHE = HOME / ".claude" / "skills-index.json"

PROTOCOL_VERSION = "2024-11-05"

FRONTMATTER = re.compile(r"^---\s*(.*?)^---", re.S | re.M)
NAME_RE = re.compile(r"^name:\s*(.+)$", re.M)
DESC_RE = re.compile(r"^description:\s*(.+(?:\n[ \t]+.+)*)", re.M)
REPO_RE = re.compile(r"^repository:\s*[\"']?([^\"'\n]+)", re.M)


def _meta(skill_md: Path) -> tuple[str, str, str]:
    """(name, description, repository) from a SKILL.md, cheaply.

    Only the head of the file is read: frontmatter is at the top, and some of
    these skills carry hundreds of kilobytes of reference material after it.
    """
    try:
        head = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
    except OSError:
        return skill_md.parent.name, "", ""
    block = FRONTMATTER.search(head)
    fm = block.group(1) if block else head[:600]
    name = (NAME_RE.search(fm).group(1).strip() if NAME_RE.search(fm) else skill_md.parent.name)
    desc = DESC_RE.search(fm)
    text = re.sub(r"\s+", " ", desc.group(1)).strip().strip("\"'>|") if desc else ""
    repo = REPO_RE.search(fm)
    return name.strip("\"'"), text, (repo.group(1).strip() if repo else "")


def build_index() -> list[dict]:
    entries: list[dict] = []
    seen: set[str] = set()

    # Repo tree first so a skill with provenance wins over the flat copy.
    if REPOS.exists():
        for repo in sorted(p for p in REPOS.iterdir() if p.is_dir()):
            for md in repo.rglob("SKILL.md"):
                if "node_modules" in md.parts:
                    continue
                name, desc, _ = _meta(md)
                key = md.parent.name.lower()
                if key in seen:
                    continue
                seen.add(key)
                entries.append(
                    {"id": md.parent.name, "name": name, "description": desc,
                     "source": repo.name, "path": str(md.parent)}
                )

    if LIBRARY.exists():
        for d in sorted(LIBRARY.iterdir()):
            md = d / "SKILL.md"
            if not md.is_file() or d.name.lower() in seen:
                continue
            seen.add(d.name.lower())
            name, desc, repo = _meta(md)
            entries.append(
                {"id": d.name, "name": name, "description": desc,
                 "source": repo or "library (no provenance)", "path": str(d)}
            )
    return entries


def library_fingerprint() -> int:
    n = 0
    for root in (LIBRARY, REPOS):
        if root.exists():
            n += sum(1 for _ in root.iterdir())
    return n


_INDEX: list[dict] | None = None


def index() -> list[dict]:
    global _INDEX
    if _INDEX is not None:
        return _INDEX
    fp = library_fingerprint()
    if CACHE.exists():
        try:
            blob = json.loads(CACHE.read_text(encoding="utf-8"))
            if blob.get("fingerprint") == fp:
                _INDEX = blob["skills"]
                return _INDEX
        except (OSError, ValueError, KeyError):
            pass
    print(f"[skills] indexing {LIBRARY} ...", file=sys.stderr)
    _INDEX = build_index()
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(
            json.dumps({"fingerprint": fp, "skills": _INDEX}, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass
    print(f"[skills] indexed {len(_INDEX)} skills", file=sys.stderr)
    return _INDEX


def search(query: str, limit: int = 25) -> list[dict]:
    """Rank by where the match lands: exact id, then id substring, then words.

    Deliberately not fuzzy. With 6,059 entries a loose matcher returns a wall
    of near-misses, and the agent then has to spend context deciding which of
    forty results is real — which is the cost this server exists to avoid.
    """
    q = query.lower().strip()
    if not q:
        return []
    terms = [t for t in re.split(r"[^a-z0-9+#.]+", q) if t]
    out: list[tuple[int, dict]] = []
    for e in index():
        sid = e["id"].lower()
        hay = f"{sid} {e['name']} {e['description']}".lower()
        if sid == q:
            score = 0
        elif q in sid:
            score = 1
        elif terms and all(t in hay for t in terms):
            score = 2 if any(t in sid for t in terms) else 3
        elif q in hay:
            score = 4
        else:
            continue
        out.append((score, e))
    out.sort(key=lambda p: (p[0], len(p[1]["id"])))
    return [e for _s, e in out[:limit]]


def get_skill(skill_id: str) -> str:
    wanted = skill_id.strip().lower()
    for e in index():
        if e["id"].lower() == wanted or e["name"].lower() == wanted:
            md = Path(e["path"]) / "SKILL.md"
            try:
                body = md.read_text(encoding="utf-8", errors="replace")
            except OSError as err:
                return f"could not read {md}: {err}"
            extras = sorted(
                p.name for p in Path(e["path"]).iterdir() if p.name != "SKILL.md"
            )
            note = (
                f"source: {e['source']}\n"
                f"path:   {e['path']}\n"
                + (f"bundled: {', '.join(extras)}\n" if extras else "")
                + "\nNOTE: a skill is instructions that change agent behaviour. "
                "Read it before acting on it, especially from a source with no provenance.\n"
                + "-" * 60
                + "\n"
            )
            # Very long skills are truncated: the point is to inform a decision,
            # not to move a 200KB reference file into the context window.
            if len(body) > 40000:
                body = body[:40000] + "\n\n[truncated — read the full file at the path above]"
            return note + body
    return f"no skill with id {skill_id!r}. Use search_skills first."


TOOLS = [
    {
        "name": "search_skills",
        "description": (
            "Search 6,000+ agent skills (UI/UX, security, AI engineering, cloud, testing, "
            "languages, frameworks) by keyword. Returns ids and one-line descriptions. "
            "Call this first, then get_skill for the full text of one."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "keywords, e.g. 'threat model' or 'accessibility'"},
                "limit": {"type": "integer", "description": "max results (default 25)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_skill",
        "description": "Return the full SKILL.md for one skill id, with its source and bundled files.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "skill id from search_skills"}},
            "required": ["id"],
        },
    },
    {
        "name": "skills_stats",
        "description": "How many skills are available and where they come from. Use to verify the server works.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def call_tool(name: str, args: dict) -> str:
    if name == "search_skills":
        hits = search(str(args.get("query", "")), int(args.get("limit") or 25))
        if not hits:
            return "no matches. Try a broader keyword."
        lines = [f"{len(hits)} match(es):", ""]
        for e in hits:
            lines.append(f"- {e['id']}  [{e['source']}]")
            if e["description"]:
                lines.append(f"    {e['description'][:220]}")
        lines.append("")
        lines.append("Use get_skill with an id for the full text.")
        return "\n".join(lines)
    if name == "get_skill":
        return get_skill(str(args.get("id", "")))
    if name == "skills_stats":
        entries = index()
        by: dict[str, int] = {}
        for e in entries:
            by[e["source"]] = by.get(e["source"], 0) + 1
        top = sorted(by.items(), key=lambda kv: -kv[1])[:12]
        return "\n".join(
            [f"{len(entries)} skills indexed", f"library: {LIBRARY}", "", "top sources:"]
            + [f"  {n:5}  {s}" for s, n in top]
        )
    return f"unknown tool {name!r}"


def respond(msg_id, result=None, error=None) -> None:
    out = {"jsonrpc": "2.0", "id": msg_id}
    if error is not None:
        out["error"] = error
    else:
        out["result"] = result
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue

        method = msg.get("method")
        msg_id = msg.get("id")

        # Notifications carry no id and MUST NOT be answered.
        if msg_id is None:
            continue

        if method == "initialize":
            respond(msg_id, {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "skills", "version": "1.0.0"},
            })
        elif method == "tools/list":
            respond(msg_id, {"tools": TOOLS})
        elif method == "tools/call":
            params = msg.get("params") or {}
            try:
                text = call_tool(params.get("name", ""), params.get("arguments") or {})
                respond(msg_id, {"content": [{"type": "text", "text": text}]})
            except Exception as e:  # noqa: BLE001 - a crash would kill the server
                respond(msg_id, {
                    "content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}],
                    "isError": True,
                })
        elif method in ("ping",):
            respond(msg_id, {})
        else:
            respond(msg_id, error={"code": -32601, "message": f"method not found: {method}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
