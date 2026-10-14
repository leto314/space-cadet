# Space Cadet

A cognitive training app for future pilots and astronauts. Six competences, trained a few minutes a day:

| Competence | Colour | |
|---|---|---|
| Spatial Orientation | `#4C8DFF` blue | mental rotation, headings, routes |
| Attention | `#D81E5B` crimson | reaction, selective attention, visual scanning |
| Memory | `#B8FF3D` lime | spans, n-back, visual memory |
| Mental Math | `#C46BFF` violet | fast calculation, running totals, estimation |
| Logic | `#5EEBEB` cyan | deduction, rules, circuits |
| Multitasking | `#FFAD1F` orange | several systems at once |

> **Status:** early development, private repository. Statistics are stored locally for testing; accounts and a
> backend (Supabase) come later.

---

## What's in the app

- **Home** — the Cadet Score, the three training cards (Daily Training, Daily Missions, Full Clearance), today's
  progress, streak, ranking and the week at a glance.
- **Daily Training** — one game per competence each day, the same for everyone (seeded from the date). Each daily
  game scores 0–1000 and updates that competence's score. *In progress: three Spatial games so far, shown on a test
  screen.*
- **Daily Missions** — several "systems" (modules) on one screen at the same time, like a cockpit. Generated each
  day from the date, Short (2–3 min) or Regular (5–7 min), with systems introduced one by one.
- **Full Clearance** — every game with free settings, plus **Mission Mode** (fly an archive mission or compose one
  from any modules).
- **Statistics** — a live radar of the six competences (shader-rendered), period comparison, totals, rankings and
  an activity grid.

### Games (Full Clearance)

| # | Game | Competence | Daily version |
|---|---|---|---|
| 01 | Cube Rotation | Spatial | ✓ 5 sets, slow to hidden |
| 02 | Reaction Time | Attention | |
| 03 | Memory Sequences | Memory | |
| 04 | Selective Attention | Attention | |
| 05 | N-back | Memory | |
| 06 | Heading and Beacon | Spatial | ✓ 10 rounds in 3 stages |
| 07 | Flash Math | Mental Math | |
| 08 | Running Total | Mental Math | |
| 09 | Visual Memory | Memory | |
| 10 | Turn Count | Spatial | ✓ 5 routes, slow to fast |
| 11 | Target Drift | Multitasking | |
| 12 | Anomaly Detection | Attention | |
| 13 | Airways | Multitasking | |
| 14 | Estimation | Mental Math | |
| 15 | Visual Scan | Attention | |
| 16 | Switchboard | Logic | |
| 17 | Landing Order | Logic | |
| 18 | Pattern Matrix | Logic | |
| 19 | Circuits | Logic | |
| 20 | Cube Nets | Spatial | |

The list lives in `src/data/exercises.js`; daily versions are registered in `src/daily/registry.js`.

### Mission modules

25 modules (tanks, altitude hold, target tracking, radio callsigns, access codes, logic gates, airways, cube
tracking, rotation match, quick estimate…), each declaring its competences, task type (continuous control /
respond to events / when you have time), voice use, load and blocks. They are placed on a 4 × 8 half-block grid by
`src/missions/layout.js` and picked by `src/missions/generator.js`.

---

## Getting started

Requirements: Node.js 20+ and the Expo Go app on a phone (or a browser for the web preview).

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go, or press `w` to open the web preview. Sound matters: several games and modules
speak their instructions.

---

## Project structure

```
App.js                    root: fonts, the three swipeable pages (Statistics, Home, Profile), overlays
src/
  screens/                Home, Statistics, the Full Clearance / Daily Training sheet
  games/<game>/           one folder per game (Full Clearance version, and daily version when it exists)
  daily/                  daily training: game registry, rotation, test screen with history
  missions/               mission flight screen, Daily Mission sheet, Mission Mode, layout, generator
    modules/              the mission modules
  stats/                  statistics formulas, record formats, local storage — see STATS.md
  components/             shared UI: setup shell, nav bar, glow cards, radar and chart shaders
  theme/spaceCadet.js     design tokens: colours, competence palette, labels
  utils/                  seeded randomness, trusted server time, voice, audio, haptics
  hooks/, data/           screen transitions, the exercise list
  assets/                 fonts, animated icons, logo, sounds
```

## Key ideas

- **Same content for everyone.** Daily content is generated from a seed derived from the date
  (`src/utils/random.js`). The date comes from server time, midnight in France, never from the phone's clock
  (`src/utils/trustedTime.js`), so nobody can play tomorrow's mission early.
- **Two separate scores.** The radar (0–1000 per competence) comes only from the daily training, through a moving
  average weighted by level. The Cadet Score accumulates the points of daily training and daily missions. Full
  details, formulas and record formats: [`src/stats/STATS.md`](src/stats/STATS.md).
- **Design language.** Pure black backgrounds, thin type (Gontserrat Light / Regular, Garet for numbers, Nunito for
  the large score), one colour per competence used as an accent only, no heavy borders or drop shadows, glow and
  motion used sparingly. The single source of truth for colours and labels is
  [`src/theme/spaceCadet.js`](src/theme/spaceCadet.js).

## Tech

Expo SDK 57 · React Native 0.86 · Reanimated 4 · Gesture Handler · React Native Skia · expo-gl (GLSL shaders) ·
react-native-svg · expo-speech / expo-audio · AsyncStorage.

## Credits

- The statistics radar shader (`src/components/RadarOrb.js`) is adapted from the *Orb* component of
  [React Bits](https://reactbits.dev) (MIT + Commons Clause).
- Fonts and animated icons are freely available assets from their respective authors.

## License

© 2026 — All rights reserved. This repository is private; no part of it may be copied, modified or distributed
without the author's permission.
