# The 41 Repos — What Each One Is, How to Run It, When to Use It

Every repo cloned by Antigravity's skills manager into:

```
C:\Users\LENOVO\.gemini\antigravity-ide\scratch\skills_manager\repos\
```

Descriptions below are taken from each repo's own README, not from memory.

---

## First: the distinction that decides how you use anything here

There are **three kinds** of repo in that folder, and they are used in
completely different ways.

| Kind | What it is | How you use it |
|---|---|---|
| **SKILL PACK** | Folders of `SKILL.md` instructions | `install_skills.py --install` |
| **SOFTWARE** | A real program — server, library, model | `npm i` / `pip install` / `docker compose` |
| **TOOLING** | A CLI that manages skills | Install and run it, then it installs skills |

Mixing these up is what broke Codex: copying a *software* repo into a skills
directory does nothing useful, and copying 10,435 skills at once breaks the
tool that reads them.

**The universal rule for skill packs:** `SKILL.md` is a portable format, but the
location is not. Every tool reads a **flat** `<skills-dir>/<skill-name>/SKILL.md`.

```
~/.claude/skills/     Claude Code (CLI and VS Code extension), Claude Desktop
~/.codex/skills/      Codex
.gemini/antigravity-ide/…   Antigravity / Gemini
Cursor / Windsurf     ✗ no SKILL.md support — they use rules files
ChatGPT web           ✗ no filesystem
```

Install with, then **restart the tool** (skills load at session start):

```bash
cd c:/Users/LENOVO/Desktop/prep
python tools/install_skills.py --install <repo>/<skill> --tools claude codex
```

---

## ⭐ Vendor-official skill packs — start here

These are published by the vendor of the thing they describe. Best
signal-to-noise, and the default set in `install_skills.py`.

| Repo | Skills | What it is | Use when |
|---|---|---|---|
| **anthropics_skills** | 18 | Official Anthropic skills — `skill-creator`, `mcp-builder`, `pdf`, `docx`, `pptx`, `frontend-design`, `canvas-design`, `brand-guidelines` | Making your own skills, building MCP servers, generating documents |
| **openai_skills** | 44 | OpenAI's official Agent Skills | Codex work, OpenAI API integration |
| **expo_skills** | 23 | Official Expo — `eas-workflows`, `eas-update-insights`, `eas-app-stores`, `expo-data-fetching`, `expo-dev-client` | **Directly relevant to StudyMate** — every EAS skill is a paid service though |
| **microsoft_skills** | 194 | Skills, custom agents, `AGENTS.md` templates, MCP configs | .NET, Azure, TypeScript, VS Code work |
| **MicrosoftDocs_Agent-Skills** | 191 | Azure-specific curated skills | Anything Azure |
| **NVIDIA_skills** | 331 | NVIDIA-verified skills for Claude Code and Codex | CUDA, TAO, NIM, model fine-tuning |
| **huggingface_skills** | 26 | Dataset creation, model training, evaluation | ML pipelines, HF Hub |
| **neondatabase_agent-skills** | 17 | Serverless Postgres — connections, branching, migrations, pooling | **Hosting StudyMate's Postgres** |
| **supabase_agent-skills** | 2 | Supabase + Postgres best practices | Supabase backends |
| **vercel-labs_agent-skills** | 9 | `deploy-to-vercel`, `vercel-react-native-skills`, `web-design-guidelines` | Vercel deploys, React best practices |
| **trailofbits_skills** | 78 | Security skills from a serious security firm | Audits, crypto review, fuzzing |
| **software-mansion-labs_skills** | 23 | Production React Native patterns (the Reanimated people) | **Relevant to StudyMate's app** |

**Recommended first install:**
```bash
python tools/install_skills.py --install \
  anthropics_skills/skill-creator \
  expo_skills/eas-workflows \
  neondatabase_agent-skills/neon-postgres \
  --tools claude codex
```

---

## 📚 Community skill packs — useful, less vetted

| Repo | Skills | What it is |
|---|---|---|
| **TerminalSkills_skills** | 1018 | Open library following the agentskills.io spec |
| **CaseMark_skills** | 2091 | Legal, medical, finance, capital-markets workflows |
| **alexander-kastil_skills-collection** | 860 | Large general collection |
| **microsoft_skills** ↑ | — | *(listed above)* |
| **pedronauck_skills** | 141 | 132 curated skills for Claude Code |
| **MengTo_Skills** | 124 | For **designers** and builders (Design+Code author) |
| **K-Dense-AI_scientific-agent-skills** | 161 | Scientific research workflows |
| **NousResearch_hermes-agent** | 192 | Hermes agent skills + code |
| **Fandry96_k3-agentic-skills** | 82 | 82 skills + a local semantic search engine (Gemma) |
| **UnitOneAI_SecuritySkills** | 50 | Framework-grounded security reviews |
| **paperclipai_paperclip** | 52 | Agent-management app + skills |
| **mattpocock_skills** | 35 | From Matt Pocock (TypeScript educator) — TS-heavy |
| **AsyrafHussin_agent-skills** | 24 | Cross-tool: Claude Code, Cursor, Codex, Windsurf |
| **addyosmani_agent-skills** | 24 | From Addy Osmani (Google Chrome) — web performance |
| **Significant-Gravitas_AutoGPT** | 10 | AutoGPT platform, plus a few skills |
| **santifer_career-ops** | 8 | Multi-agent career/job-search workflows |
| **gotalab_skillport** | 3 | "SkillOps toolkit" — skill management |
| **santowilem_skills** | 1 | Single skill |

### ⚠️ Aggregators — highest volume, lowest provenance

| Repo | Skills | Note |
|---|---|---|
| **iradoweck_antigravity-awesome-skills** | **4556** | npm installer + scraped GitHub library. This is 44% of everything here and is **unvetted**. |
| **danielrosehill_Useful-AI-Agent-Skills** | 0 | A curated *list* (links only, no skills) |
| **heilcheng_awesome-agent-skills** | 0 | Another curated list |

**Why this matters:** a skill is *instructions that change how the agent
behaves*. Installing an unvetted one is closer to running untrusted code than
to adding a library. Read with `--show` before installing from these.

---

## 🖥️ SOFTWARE — install and run these, they are not skills

### OmniRoute — AI gateway ⭐ most useful to you
```bash
npm install -g omniroute
omniroute                      # starts gateway + dashboard
```
Puts 291 providers (90+ with free tiers) behind **one OpenAI-compatible
endpoint**, with auto-fallback and token compression. Also ships an MCP server
(`bin/mcp-server.mjs`) and 46 skills for driving its CLI.

**Where to use it:** any tool that lets you set a base URL — Claude Code
(`ANTHROPIC_BASE_URL`), Codex, Cursor, Cline, Antigravity. **And StudyMate**: it
is OpenAI-compatible, so it drops into `PROVIDERS` in `apps/api/app/llm.py`
beside Sarvam and NVIDIA, giving the tutor a fallback when one key dies.

### Octogent — multiple Claude Code terminals
```bash
# already installed at C:\Users\LENOVO\source\repos\octogent  → port 8787
```
Orchestrates many `claude` CLI sessions into scoped "tentacles" with a web
dashboard. **Requires the standalone `claude` CLI**, which is not installed on
this machine — that is why the server is down.

### OpenManus — agent framework
```bash
pip install -r requirements.txt     # or: docker compose up
```
Open-source general agent framework from FoundationAgents.

### AutoScraper — Python scraping library
```bash
pip install autoscraper
```
Learns scraping rules from an example rather than hand-written selectors.
Genuinely useful if you ever scrape more exam sites.

### PentAGI — autonomous pentesting
```bash
docker compose up
```
Security testing only. **Use exclusively on systems you own or are authorised
to test.**

### Wan 2.1 — video generation model
```bash
pip install -r requirements.txt     # needs a serious GPU
```

### Duix Avatar — digital avatar system (npm)
### Natively Cluely — desktop recording assistant (npm)

---

## 🔧 TOOLING — CLIs that manage skills

| Repo | Command | What it does |
|---|---|---|
| **vercel-labs_skills** | `npx skills` | CLI for the open agent-skills ecosystem |
| **iradoweck_antigravity-awesome-skills** | npm installer | Bulk skill installer — **don't bulk install** |
| **gotalab_skillport** | python | Skill packaging/ops |

We already have `tools/install_skills.py`, which does the same job with a
trusted-repo default and per-tool targeting.

---

## What I would actually do, in order

1. **OmniRoute** — `npm i -g omniroute`. Free-tier routing for your own coding,
   and a fallback provider for StudyMate's tutor.
2. **Three skills**: `anthropics_skills/skill-creator`,
   `expo_skills/eas-workflows`, `neondatabase_agent-skills/neon-postgres`.
   *(Already installed to Claude Code and Codex.)*
3. **`software-mansion-labs_skills`** — React Native patterns, directly
   applicable to StudyMate's app.
4. **Leave the 4,556-skill aggregator alone** until you need something specific,
   then `--show` it first.

---

## Quick reference

```bash
cd c:/Users/LENOVO/Desktop/prep

python tools/install_skills.py --list                    # trusted repos
python tools/install_skills.py --list --all-repos        # everything
python tools/install_skills.py --search postgres         # find by name
python tools/install_skills.py --show <repo>/<skill>     # READ BEFORE INSTALLING
python tools/install_skills.py --install <repo>/<skill> --tools claude codex gemini
python tools/install_skills.py --installed               # what is where
```

Then **restart the tool**. Skills load at session start, so nothing takes
effect in a session that is already running.
