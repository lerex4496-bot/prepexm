"""
Install Agent Skills into each AI tool's own skills directory.

WHY THIS EXISTS
---------------
`SKILL.md` is a portable format, but the LOCATION is not. Every tool reads from
its own directory, and each expects a FLAT layout:

    <tool skills dir>/<skill-name>/SKILL.md

Copying a source tree wholesale does not work. It buries SKILL.md files several
levels deep where nothing finds them, and drags the source tool's runtime state
(conversations, caches, config) along with it — which is how ~/.codex/skills
ended up with 10,447 entries and none of them loadable.

This copies ONE skill at a time, flat, with its supporting files, into any
target tool.

WHY NOT INSTALL EVERYTHING
--------------------------
Two reasons, both real:

  * Every installed skill's name and description is loaded into the model's
    context on every session. Thousands of them crowd out the actual work.
  * A skill is INSTRUCTIONS THAT CHANGE HOW THE AGENT BEHAVES. Installing an
    unvetted one is closer to running untrusted code than to adding a library.
    Prefer vendor-official repos, and read before you install.

Usage:
    python tools/install_skills.py --list                     # what is available
    python tools/install_skills.py --search eas               # find by name
    python tools/install_skills.py --show expo_skills/eas-hosting
    python tools/install_skills.py --install expo_skills/eas-hosting --tools claude codex
    python tools/install_skills.py --installed                # what is installed where
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

HOME = Path.home()

# TWO SOURCES, BECAUSE ANTIGRAVITY KEEPS TWO
# ------------------------------------------
# `repos` is the checkout tree: 41 upstream repositories, each with its skills
# nested wherever that project happens to put them. Provenance is legible here
# — you can see that a skill came from expo_skills rather than an aggregator —
# which is what TRUSTED below is for.
#
# `config/skills` is the flat installed library, and it is much larger: 6,059
# skills, one directory each. No repo attribution survives the flattening, so a
# skill found only here is of unknown origin and has to be read before use.
SOURCE = HOME / ".gemini" / "antigravity-ide" / "scratch" / "skills_manager" / "repos"
LIBRARY = HOME / ".gemini" / "config" / "skills"

# WHY THIS TOOL WILL NOT INSTALL THE WHOLE LIBRARY
# -----------------------------------------------
# Measured, not assumed: the name and description of all 6,059 skills come to
# 1,884,172 characters — roughly 471,000 tokens. Every installed skill's
# frontmatter is loaded at session start, so installing the library would cost
# about 2.4x the entire context window before a single file of the project was
# read. The agent would not be more capable; it would be unable to start.
#
# Ten well-chosen skills cost a few hundred tokens and are actually consulted.
LIBRARY_SIZE_NOTE = "6,059 skills ~= 471,000 tokens of frontmatter; install what you need"

# Each tool reads its own directory. Cursor/Windsurf use rules files rather
# than SKILL.md and so cannot be targeted here.
TOOLS: dict[str, Path] = {
    "claude": HOME / ".claude" / "skills",
    "codex": HOME / ".codex" / "skills",
    "gemini": HOME / ".gemini" / "skills",
}

# Repos published by the vendor of the thing they describe. Not a safety
# guarantee, but a far better starting point than a random aggregator.
TRUSTED = {
    "anthropics_skills",
    "expo_skills",
    "openai_skills",
    "microsoft_skills",
    "MicrosoftDocs_Agent-Skills",
    "NVIDIA_skills",
    "huggingface_skills",
    "supabase_agent-skills",
    "neondatabase_agent-skills",
    "vercel-labs_agent-skills",
    "vercel-labs_skills",
    "trailofbits_skills",
}


def find_skills(repo_filter: str | None = None, include_library: bool = True) -> list[tuple[str, str, Path]]:
    """Return (repo, skill_name, skill_dir) for every SKILL.md found.

    The flat library is searched too, under the pseudo-repo name "library", and
    only for skills the repo tree does not already provide — a skill with real
    provenance is always preferable to the same skill with none.
    """
    out: list[tuple[str, str, Path]] = []
    seen: set[str] = set()

    if SOURCE.exists():
        repos = sorted(p for p in SOURCE.iterdir() if p.is_dir())
        for repo in repos:
            if repo_filter and repo_filter.lower() not in repo.name.lower():
                continue
            for skill_md in repo.rglob("SKILL.md"):
                if "node_modules" in skill_md.parts:
                    continue
                out.append((repo.name, skill_md.parent.name, skill_md.parent))
                seen.add(skill_md.parent.name.lower())

    if include_library and LIBRARY.exists():
        if not repo_filter or repo_filter.lower() in "library":
            for d in sorted(LIBRARY.iterdir()):
                if not (d / "SKILL.md").is_file() or d.name.lower() in seen:
                    continue
                out.append(("library", d.name, d))
    return out


def read_meta(skill_dir: Path) -> tuple[str, str]:
    """Pull name and description out of the SKILL.md frontmatter."""
    md = skill_dir / "SKILL.md"
    name = skill_dir.name
    desc = ""
    try:
        for line in md.read_text(encoding="utf-8", errors="replace").splitlines()[:20]:
            low = line.lower()
            if low.startswith("name:"):
                name = line.split(":", 1)[1].strip()
            elif low.startswith("description:"):
                desc = line.split(":", 1)[1].strip()
            elif line.strip() == "---" and desc:
                break
    except OSError:
        pass
    return name, desc


def install(skill_dir: Path, tool: str, force: bool) -> tuple[bool, str]:
    dest_root = TOOLS[tool]
    dest = dest_root / skill_dir.name

    if dest.exists() and not force:
        return False, "already installed (use --force to overwrite)"

    dest_root.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)
    # copytree keeps scripts/references the skill ships with; skip VCS noise.
    shutil.copytree(skill_dir, dest, ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__"))
    return True, str(dest)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list skills from trusted repos")
    ap.add_argument("--all-repos", action="store_true", help="include untrusted repos in listings")
    ap.add_argument("--search", help="find skills by name substring")
    ap.add_argument("--show", help="print a skill's SKILL.md (repo/skill)")
    ap.add_argument("--install", nargs="*", help="install skills, each as repo/skill")
    ap.add_argument("--tools", nargs="*", default=["claude"], choices=list(TOOLS))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--installed", action="store_true", help="show what is installed per tool")
    args = ap.parse_args()

    if args.installed:
        for tool, path in TOOLS.items():
            skills = sorted(p.parent.name for p in path.rglob("SKILL.md")) if path.exists() else []
            print(f"{tool:8} {path}")
            print(f"         {len(skills)} skills" + (f": {', '.join(skills[:12])}" if skills else ""))
        return 0

    if not SOURCE.exists():
        print(f"source not found: {SOURCE}")
        return 1

    if args.list or args.search:
        skills = find_skills()
        if not args.all_repos:
            skills = [s for s in skills if s[0] in TRUSTED]
        if args.search:
            skills = [s for s in skills if args.search.lower() in s[1].lower()]
        by_repo: dict[str, list[tuple[str, Path]]] = {}
        for repo, name, path in skills:
            by_repo.setdefault(repo, []).append((name, path))
        for repo in sorted(by_repo):
            print(f"\n{repo}  ({len(by_repo[repo])})")
            for name, path in sorted(by_repo[repo])[:40]:
                _, desc = read_meta(path)
                print(f"  {repo}/{name}")
                if desc:
                    print(f"      {desc[:110]}")
        print(f"\n{len(skills)} skills shown"
              + ("" if args.all_repos else "  (trusted repos only; --all-repos for everything)"))
        return 0

    if args.show:
        repo, _, name = args.show.partition("/")
        match = [p for r, n, p in find_skills(repo) if n == name]
        if not match:
            print(f"not found: {args.show}")
            return 1
        print((match[0] / "SKILL.md").read_text(encoding="utf-8", errors="replace")[:4000])
        return 0

    if args.install:
        for spec in args.install:
            repo, _, name = spec.partition("/")
            match = [p for r, n, p in find_skills(repo) if n == name]
            if not match:
                print(f"  ! not found: {spec}")
                continue
            if repo not in TRUSTED:
                print(f"  ! {spec}: repo is not in the trusted list — review it first with --show")
            for tool in args.tools:
                ok, info = install(match[0], tool, args.force)
                print(f"  {'installed' if ok else 'skipped  '} {spec:44} -> {tool:7} {info}")
        print("\nRestart the tool — skills are loaded at session start.")
        return 0

    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
