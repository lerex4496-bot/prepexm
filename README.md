# StudyMate

A multilingual adaptive exam coach for **CTET** (Hindi medium) and **NEET** (Gujarati medium),
Android-first. One codebase, two exam experiences.

Plan of record: `C:\Users\LENOVO\.claude\plans\yes-this-is-a-calm-papert.md`

## Status — Slice 0 + Slice 1 complete

| Slice | Scope | State |
|---|---|---|
| 0 | Content contract frozen · design tokens · Mukta font routing · i18n runtime | done |
| 1 | Onboarding · Today · 4-tab nav · component library · trilingual fixtures | done |
| 2 | CTET exam path: pipeline, review tool, exam player, scoring, minimal AI | next |

No backend yet, by design — Slices 0/1 are Expo-only. FastAPI + Postgres arrive in Slice 2
when there is real content to serve and review.

## Run it

```bash
cd apps/mobile
npx expo start
```

Then open **Expo Go** on the phone (same Wi-Fi) and either scan the QR or enter the URL manually:

```
exp://<your-lan-ip>:8081
```

Checks:

```bash
npx tsc --noEmit                       # typecheck
npx expo export --platform android     # full production bundle
```

## Layout

```
apps/mobile/
├─ app/                     expo-router routes
│  ├─ _layout.tsx           font gate + theme + navigation shell
│  ├─ onboarding/           7-step intake
│  ├─ (tabs)/               Today · Learn · Practice · Progress
│  └─ dev/gallery.tsx       design-system verification surface
├─ src/
│  ├─ theme/                colours, layout, typography, ThemeProvider
│  ├─ i18n/                 script detection, strings (en/hi/gu), useT
│  ├─ ui/                   component library
│  ├─ content/              contract.ts (FROZEN) + fixtures
│  └─ store/                profile (zustand + AsyncStorage)
└─ assets/fonts/            Mukta + Mukta Vaani, 5 weights each
```

## Two things that constrain everything else

**1. Fonts route per script, not per screen.**
Mukta covers `deva` + `latn`. Mukta Vaani covers `gujr` + `latn`. Neither covers all three.
So `src/ui/Text.tsx` splits mixed-script strings into runs and renders each in the family that
actually covers it. Without this, Android silently substitutes a system font for the uncovered
run — no tofu, so it looks fine in a screenshot while quietly ceasing to be one typeface.
`src/i18n/script.ts` holds the logic; it is unit-tested for run-splitting and roundtrip safety.

**2. Line height is script-dependent.**
Devanagari and Gujarati carry marks above and below the baseline. A Latin-tuned multiplier clips
them. Every token in `src/theme/typography.ts` carries both a Latin and an Indic multiplier, and
`display`/`h1` step down one size for Indic because those strings run 15–30% longer.

## Non-negotiables carried from the plan

- Official PYQs and AI-generated mocks are separated in **data**, not just UI. `sourceType` and
  `reviewStatus` live on every content row; only `approved` content ever ships.
- Plan rationales are `{code, params}`, never LLM prose — otherwise "why am I seeing this" can
  never be rendered in Gujarati.
- Exam readiness stays hidden until ≥2 full mocks and ≥25% syllabus coverage, then shows a band
  with its basis. Never a bare number.
- Colour is never the sole indicator. Question-palette states carry distinct glyphs; status
  colours always ship icon + label.
- Never hardcode a hex. Go through `useTheme().colors`.
