# Space Cadet

![Expo SDK 58](https://img.shields.io/badge/Expo_SDK-58-000020?style=flat-square&logo=expo&logoColor=white)
![React Native 0.88](https://img.shields.io/badge/React_Native-0.88-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Daily games 16 of 20](https://img.shields.io/badge/daily_games-16_of_20-4C8DFF?style=flat-square)
![Private](https://img.shields.io/badge/repository-private-555555?style=flat-square)

A cognitive training app for future pilots and astronauts. Six competences, trained a few minutes a day:

| Competence | Colour | Trains |
|---|---|---|
| ![Spatial Orientation](https://img.shields.io/badge/Spatial_Orientation-4C8DFF?style=for-the-badge) | `#4C8DFF` blue | mental rotation, headings, routes |
| ![Attention](https://img.shields.io/badge/Attention-D81E5B?style=for-the-badge) | `#D81E5B` crimson | reaction, selective attention, visual scanning |
| ![Memory](https://img.shields.io/badge/Memory-B8FF3D?style=for-the-badge) | `#B8FF3D` lime | spans, n-back, visual memory |
| ![Mental Math](https://img.shields.io/badge/Mental_Math-C46BFF?style=for-the-badge) | `#C46BFF` violet | fast calculation, running totals, estimation |
| ![Logic](https://img.shields.io/badge/Logic-5EEBEB?style=for-the-badge) | `#5EEBEB` cyan | deduction, rules, circuits |
| ![Multitasking](https://img.shields.io/badge/Multitasking-FFAD1F?style=for-the-badge) | `#FFAD1F` orange | several systems at once |

> **Status:** early development, private repository. Statistics are stored locally for testing; accounts and a
> backend (Supabase) come later.

---

## What's in the app

- **Home** — the Cadet Score, the three training cards (Daily Training, Daily Missions, Full Clearance), today's
  progress, streak, ranking and the week at a glance.
- **Daily Training** — one game per competence each day, the same for everyone (seeded from the date). Each daily
  game scores 0–1000 and updates that competence's score. *In progress: every game but the four Logic ones has
  its daily version (16 of 20), shown on a test screen; Logic is next.*
- **Daily Missions** — several "systems" (modules) on one screen at the same time, like a cockpit. Generated each
  day from the date, Short (2–3 min) or Regular (5–7 min), with systems introduced one by one.
- **Full Clearance** — every game with free settings, plus **Mission Mode** (fly an archive mission or compose one
  from any modules).
- **Statistics** — a live radar of the six competences (shader-rendered), period comparison, totals, rankings and
  an activity grid.

### Games (Full Clearance)

| # | Game | Competence | Daily version |
|---|---|---|---|
| 01 | Cube Rotation | ![Spatial](https://img.shields.io/badge/Spatial-4C8DFF?style=flat-square) | ✓ 5 sets, slow to hidden |
| 02 | Reaction Time | ![Attention](https://img.shields.io/badge/Attention-D81E5B?style=flat-square) | ✓ 10 rounds, easy to hard |
| 03 | Memory Sequences | ![Memory](https://img.shields.io/badge/Memory-B8FF3D?style=flat-square) | ✓ 9 sequences, 4 to 9 long |
| 04 | Selective Attention | ![Attention](https://img.shields.io/badge/Attention-D81E5B?style=flat-square) | ✓ 10 trials, easy to hard |
| 05 | N-back | ![Memory](https://img.shields.io/badge/Memory-B8FF3D?style=flat-square) | ✓ 3 blocks, 2-back then harder |
| 06 | Heading and Beacon | ![Spatial](https://img.shields.io/badge/Spatial-4C8DFF?style=flat-square) | ✓ 10 rounds in 3 stages |
| 07 | Flash Math | ![Mental Math](https://img.shields.io/badge/Mental_Math-C46BFF?style=flat-square) | ✓ 25 questions in 2 minutes |
| 08 | Running Total | ![Mental Math](https://img.shields.io/badge/Mental_Math-C46BFF?style=flat-square) | ✓ 5 series, slow to fast |
| 09 | Visual Memory | ![Memory](https://img.shields.io/badge/Memory-B8FF3D?style=flat-square) | ✓ 3 ladders, 3 cells up |
| 10 | Turn Count | ![Spatial](https://img.shields.io/badge/Spatial-4C8DFF?style=flat-square) | ✓ 5 routes, slow to fast |
| 11 | Target Drift | ![Multitasking](https://img.shields.io/badge/Multitasking-FFAD1F?style=flat-square) | ✓ 90 seconds, easy to hard |
| 12 | Anomaly Detection | ![Attention](https://img.shields.io/badge/Attention-D81E5B?style=flat-square) | ✓ 90 seconds, slow to fast |
| 13 | Airways | ![Multitasking](https://img.shields.io/badge/Multitasking-FFAD1F?style=flat-square) | ✓ 90 seconds, slow to fast |
| 14 | Estimation | ![Mental Math](https://img.shields.io/badge/Mental_Math-C46BFF?style=flat-square) | ✓ 12 estimates, every kind |
| 15 | Visual Scan | ![Attention](https://img.shields.io/badge/Attention-D81E5B?style=flat-square) | ✓ 3 grids, 3 × 3 to 5 × 5 |
| 16 | Switchboard | ![Logic](https://img.shields.io/badge/Logic-5EEBEB?style=flat-square) | *next* |
| 17 | Landing Order | ![Logic](https://img.shields.io/badge/Logic-5EEBEB?style=flat-square) | *next* |
| 18 | Pattern Matrix | ![Logic](https://img.shields.io/badge/Logic-5EEBEB?style=flat-square) | *next* |
| 19 | Circuits | ![Logic](https://img.shields.io/badge/Logic-5EEBEB?style=flat-square) | *next* |
| 20 | Cube Nets | ![Spatial](https://img.shields.io/badge/Spatial-4C8DFF?style=flat-square) | ✓ 8 puzzles, easy to hard |

The list lives in `src/data/exercises.js`; daily versions are registered in `src/daily/registry.js`.

Each game folder is split in two: `logic.js` (pure JavaScript: content generators, scoring, daily progression,
result assembly — no React, loadable in plain Node) and the screen file(s) (`<Name>Game.js`, plus a separate
`Daily…` component for Cube Rotation), which import `./logic`. Generators never call `Math.random`: they receive a
seed (the day's seed, or `randomSeed()` for a free session), so any session can be rebuilt from its seed, and both
modes share the same scoring functions (`roundPoints`, `gridPoints`, `estimatePoints`…).

`node scripts/check-game-separation.mjs` verifies that split (`--details` to see what fails, `--all` to include
the games without a daily version, `--help`). `npm run test:games` runs the logic tests of the games that have
them — see [`scripts/games/README.md`](scripts/games/README.md).

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
  games/<game>/           one folder per game: logic.js (pure logic) + the screens (Full Clearance, daily)
  daily/                  daily training: game registry, rotation, test screen with history
  missions/               mission flight screen, Daily Mission sheet, Mission Mode, layout, generator
    modules/              the mission modules
  stats/                  statistics formulas, record formats, local storage — see STATS.md
  components/             shared UI: setup shell, nav bar, glow cards, radar and chart shaders
  theme/spaceCadet.js     design tokens: colours, competence palette, labels
  utils/                  seeded randomness, trusted server time, voice, audio, haptics
  hooks/, data/           screen transitions, the exercise list
  assets/                 fonts, animated icons, logo, sounds
scripts/                  checks runnable with plain Node (no install): check-game-separation.mjs, games/ tests
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

Expo SDK 58 · React Native 0.88 · Reanimated 4 · Gesture Handler · React Native Skia · expo-gl (GLSL shaders) ·
react-native-svg · expo-speech / expo-audio · AsyncStorage.

## Credits

- The statistics radar shader (`src/components/RadarOrb.js`) is adapted from the *Orb* component of
  [React Bits](https://reactbits.dev) (MIT + Commons Clause).
- Fonts and animated icons are freely available assets from their respective authors.

## License

© 2026 — All rights reserved. This repository is private; no part of it may be copied, modified or distributed
without the author's permission.
