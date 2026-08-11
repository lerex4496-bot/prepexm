# StudyMate — Runbook

Everything you need to run, rebuild and extend this project, plus how the AI
skills fit in. Written to be read top-to-bottom once, then used as reference.

---

## 1. What this project is

A private exam-prep app for two students:

- **CTET** (Hindi medium) — next sitting September 2026
- **NEET** (Gujarati medium) — next cycle ~May 2027

The rule the whole system is built around:

```
SOURCE → EXTRACT → VALIDATE → HUMAN REVIEW → APPROVED → APP
```

Nothing reaches a student from a parser, an OCR pass, a font converter or an
LLM without a human approving it. That gate is enforced in SQL, not by
convention.

---

## 2. Folder map

```
prep/
├── apps/
│   ├── mobile/                 Expo React Native app (the student-facing app)
│   │   ├── app/                screens (expo-router: file = route)
│   │   ├── src/                theme · i18n · ui · db · exam · plan · tutor
│   │   ├── assets/content/     studymate.db  ← the APPROVED content bundle
│   │   ├── assets/fonts/       Mukta + Mukta Vaani (Devanagari/Gujarati/Latin)
│   │   └── plugins/            withAbiFilters.js (APK size)
│   └── api/                    FastAPI: review tool + tutor + corpus
│       ├── app/                models · ingest · export · llm · corpus · main
│       ├── .env                API KEYS — gitignored, never commit
│       └── .env.example        blank template (safe to commit)
├── content/
│   ├── raw/ctet/               downloaded CTET papers + answer keys
│   ├── raw/ncert/              NCERT chapter PDFs (the tutor's corpus)
│   ├── parsed/                 assembled question JSON
│   └── manifests/              ctet.json · ncert.json (+ csv)
├── tools/                      the pipeline (Python CLI scripts)
├── dist/                       built APKs
└── docker-compose.yml          Postgres 16 on port 55432
```

---

## 3. Daily startup — three services

Run each in its own terminal. **Order matters**: Postgres first.

### a) Postgres (the authoring database)

```bash
cd c:/Users/LENOVO/Desktop/prep
docker compose up -d
```
Needs Docker Desktop running. Data survives restarts in the `studymate_pgdata`
volume. Verify: `docker ps` shows `studymate-db … (healthy)`.

### b) API — review tool + tutor

```bash
cd c:/Users/LENOVO/Desktop/prep/apps/api
python -m uvicorn app.main:app --host 127.0.0.1 --port 8008
```
Open **http://127.0.0.1:8008** → the Content Review tool.

### c) Metro — for live app development

```bash
cd c:/Users/LENOVO/Desktop/prep/apps/mobile
npx expo start
```

> **If the phone cannot connect**, your laptop's IP has almost certainly
> changed (it has already done so once). Find it and pin it:
> ```bash
> ipconfig | grep -A4 "Wi-Fi" | grep IPv4
> REACT_NATIVE_PACKAGER_HOSTNAME=<that-ip> npx expo start
> ```
> Then open `exp://<that-ip>:8081` in Expo Go. Pinning matters because a
> WSL/Hyper-V virtual adapter can otherwise be advertised, which the phone
> can never reach.

---

## 4. The content pipeline — in order

Each step is idempotent; re-running is safe and skips existing work.

| # | Command | What it does |
|---|---|---|
| 1 | `python tools/ctet_fetch.py --sessions feb-2026 dec-2024 july-2024` | Downloads official CTET papers from ctet.nic.in (via Google Drive) |
| 2 | `python tools/ctet_corpus.py` | Parses papers, joins the official answer key, writes `content/parsed/*.json` |
| 3 | `cd apps/api && python -m app.ingest` | Loads parsed JSON into Postgres as `pending` |
| 4 | *(browser)* http://127.0.0.1:8008 | **You** approve/reject/edit — the gate |
| 5 | `cd apps/api && python -m app.export` | Exports **approved only** → `apps/mobile/assets/content/studymate.db` |

**Step 5 ships whole papers only.** A partially-approved paper would present as
a complete exam while silently missing questions. Use `--allow-partial` for a
development bundle; it stamps itself `PARTIAL-DEV-BUILD` and the app shows an
amber warning.

### Review tool keyboard shortcuts
`Enter` approve · `E` edit · `R` reject · `J`/`K` next/previous.
Queue is sorted lowest-confidence first. *Bulk approve clean* skips anything
flagged. Approval refuses questions that disagree with the official key,
have empty options, or fewer than four — override needs an explicit note.

### NCERT corpus (powers the tutor)

```bash
python tools/ncert_manifest.py                    # verify book URLs
python tools/ncert_chapters.py --exam CTET --subjects Science Mathematics EVS --min-class 3
cd apps/api && python -m app.corpus_ingest --probe   # check extractability first
cd apps/api && python -m app.corpus_ingest           # ingest
```

> `<code>ps.pdf` is **prelims** (cover, foreword, contents) — *not* the book.
> Real content is `<code><NN>.pdf`, e.g. `fecu102.pdf` = Class 6 Science ch. 2.

---

## 5. Building the APK

```bash
cd c:/Users/LENOVO/Desktop/prep/apps/mobile
npx eas-cli login                                   # once
npx eas-cli build -p android --profile preview      # ~20 min, returns a URL
npx eas-cli build:list --platform android --limit 1 # check status
```

Profiles in `eas.json`: **preview** = APK for the students · **development** =
dev client (needs Metro) · **production** = AAB for Play Store.

### Shipping changes WITHOUT a rebuild

`runtimeVersion` is tied to `appVersion`, so while the version is unchanged:

```bash
npx eas-cli update --branch preview --message "corrected questions"
```

JS **and the content bundle** go over the air. So after approving more
questions: re-run export, then `eas update`. No reinstall.
Bump `version` in `app.json` only when native code changes — that forces a new APK.

---

## 6. Keys and configuration

`apps/api/.env` (gitignored):
```
SARVAM_API_KEY=...
SARVAM_MODEL=sarvam-105b-conversations
LLM_PROVIDER=sarvam
LLM_PROVIDER_INDIC=sarvam
```

- Use **`sarvam-105b-conversations`**, not `sarvam-105b`. The latter is a
  reasoning model: 9.8s and 1,882 tokens versus 2.6s and 47 tokens for the same
  answer. `sarvam-m` and `sarvam-30b` are both deprecated.
- Adding a provider is one entry in `PROVIDERS` in `apps/api/app/llm.py` —
  anything OpenAI-compatible works (NVIDIA NIM, OmniRoute, OpenRouter).

In the app: **Settings → Tutor server** → `http://<laptop-ip>:8008` → *Check*.
The tutor is the **only** networked feature; everything else works offline.

---

## 7. Skills — how to actually use them

### The one rule

`SKILL.md` is a portable format. **The location is not.** Every tool reads its
own directory, and each expects a **flat** layout:

```
<tool skills dir>/<skill-name>/SKILL.md
```

Copying a source tree wholesale does not work — it buries SKILL.md too deep to
load and drags the source tool's runtime state along with it.

| Tool | Skills directory | Works? |
|---|---|---|
| Claude Code (CLI **and** VS Code extension) | `~/.claude/skills/` | yes |
| Claude Desktop | its own skills setting | yes |
| Codex | `~/.codex/skills/` | yes |
| Antigravity / Gemini | `.gemini/antigravity-ide/…` | yes (already there) |
| Cursor / Windsurf | uses rules files, not SKILL.md | no |
| ChatGPT web | no filesystem | no |

### Use the installer, not `cp`

```bash
cd c:/Users/LENOVO/Desktop/prep
python tools/install_skills.py --list                       # trusted repos
python tools/install_skills.py --search postgres
python tools/install_skills.py --show anthropics_skills/skill-creator
python tools/install_skills.py --install expo_skills/eas-workflows --tools claude codex
python tools/install_skills.py --installed                  # what is where
```

**Restart the tool afterwards** — skills load at session start.

### Two cautions

1. **A skill is instructions that change how the agent behaves.** Installing an
   unvetted one is closer to running untrusted code than adding a library. The
   installer defaults to vendor-official repos (`anthropics_skills`,
   `expo_skills`, `openai_skills`, `neondatabase`, `vercel-labs`, `supabase`,
   `microsoft`, `NVIDIA`, `trailofbits`). `--all-repos` opens the rest.
2. **Never install in bulk.** Every skill's name and description loads into
   context every session. The 41 repos hold 10,435 skills; installing them all
   is what broke Codex.

### Not every repo is a skill pack

Of the 41 repos in `.gemini/antigravity-ide/scratch/skills_manager/repos/`,
about a dozen are **runnable software**, not skills — you install and run these
normally, and the `SKILL.md` files they ship are just instructions for driving
their own CLI:

```
diegosouzapw_OmniRoute      npm i -g omniroute && omniroute    AI gateway, 291 providers
hesamsheikh_octogent        npm                                orchestrates Claude terminals
FoundationAgents_OpenManus  python + docker                    agent framework
alirezamika_autoscraper     pip install autoscraper            scraping library
vxcontrol_pentagi           docker compose                     pentesting AI
Wan-Video_Wan2.1            python                             video generation
```

**OmniRoute** is worth knowing: it exposes many providers behind one
OpenAI-compatible endpoint, so it can be added to `PROVIDERS` in `llm.py` as a
fallback, or pointed at from any tool that lets you set a base URL.

### Currently installed

```
~/.claude/skills/   eas-update-insights · eas-workflows · neon-postgres · skill-creator
~/.codex/skills/    the same four, plus Codex's own 12
```

---

## 8. Things that have already bitten us

Kept because each one cost time and would recur silently.

| Symptom | Cause | Fix |
|---|---|---|
| App installs with an empty question bank | `.db` is not in Metro's default `assetExts` — the bundle builds **cleanly** without it | `metro.config.js` adds `db` |
| Phone: "Failed to download remote update" | Laptop IP changed (`.2` → `.8`) | `REACT_NATIVE_PACKAGER_HOSTNAME` |
| `eas.json is not valid` | `//` comment keys — EAS validates strictly | no comments in `eas.json` |
| Every candidate marked wrong on some questions | `Z=ALL` in the CBSE key means **all options accepted** | decoded in `ctet_key_parse.py` |
| Paper II parsed 210 of 150 questions | The booklet contains **both** subject streams | one booklet → two papers |
| 180 questions had another language's answers | Joined against `*-02-Hindi` while parsing the English stream | use `*-01-English` |
| Approved content changed underneath a human's approval | Re-ingest preserved stale approvals | re-ingest invalidates when the answer changes |
| Hindi extracts as `ÁŸêŸÁ‹ÁπÃ` | Legacy Chanakya/Yogesh fonts, pre-Unicode | March 2026 papers use Unicode; older ones need conversion |
| APK 112 MB | Four ABIs; x86 + x86_64 = 47 MB no phone can run | `plugins/withAbiFilters.js` |

---

## 9. Still open

- **Rotate the Sarvam key** — it was pasted in chat.
- **~81 questions pending review** → clears the `PARTIAL-DEV-BUILD` warning.
- **Host the API** so the tutor works away from your Wi-Fi. Needs FastAPI +
  Postgres hosting (Fly.io, Render, or a VPS; Neon for the database).
  Note: `eas-hosting` does **not** do this — it serves Expo web/API routes only.
- **Legacy Hindi backfill** for pre-March-2026 papers — benchmark to ≥99%
  question-level accuracy before shipping any of it.
- **Syllabus tagging** — every question still has an empty `topic_id`, which is
  what blocks the concept tree and real mastery tracking.
