# babeltype

DMC-inspired style meter for Discord — rewards speed and rhythm with confetti, screenshake, and rank-up drama.

## Features

- **Style Meter** — D → C → B → A → S → DEVIL rank system. Score builds from speed, rhythm consistency, and combo streaks. Decays when idle.
- **Combo Counter** — Every keystroke builds combo. Backspace softly punishes (-3 combo, -6 style). Inactivity resets it. Milestones at 5, 10, 20, 35, 50, 75, 100 give style bursts and multiplier boosts.
- **WPM Tracker** — Rolling 4-second window, live in the HUD.
- **Multiplier System** — Stacks from tricks and milestones (up to 5.0×), decays toward 1.0× over time.
- **Trick Detection** — Burst (6+ keys avg <90ms), Speed Demon (180+ WPM sustained 3s), Flow State (high rhythm consistency).
- **Challenges** — Typing prompts appear at B rank and above. Two modes:
  - **Phrases** — Short JJK/DMC references. Wrong key = instant fail.
  - **Quotes** — 1500 quotes from MonkeyType (short ≤100 chars, medium 100–300 chars). Wrong key = red flash + small penalty (forgiving). Timer scales with length. Bigger rewards for longer quotes.
- **Confetti Particles** — Burst from the caret as you type. Density scales with rank. GPU-composited, shared animation loop, 50 particle cap.
- **Screen Shake** — Chat area shakes at B rank and above. Intensity scales with rank.
- **Session Summary** — When you stop, shows your modal rank, peak rank, high combo, and peak WPM.
- **Clean Send Rewards** — Sending without backspace gives bonus style and confetti. Streaks at 3, 5, 10 consecutive clean sends.
- **Bar Glow** — Message bar glows at S and DEVIL rank.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Challenge Mode | Phrases / Quotes Short / Quotes Medium / Quotes Mixed / Off | Phrases |
| Enable Confetti | Toggle particle effects | On |
| Enable Screen Shake | Toggle shake effect | On |
| Shake Intensity | Max shake strength (1–8) | 1 |
| Confetti Density | Particles per keystroke (1–5) | 1 |
| Combo Timeout | Seconds before combo resets (1–8) | 3 |

## Ranks

| Rank | Min Score | Color |
|------|-----------|-------|
| D | 0 | Grey |
| C | 18 | Silver |
| B | 38 | Blue |
| A | 58 | Green |
| S | 78 | Gold |
| DEVIL | 92 | Red |

## Installation

1. Clone/copy the `babeltype` folder into your Vencord `src/userplugins/` directory
2. Run `pnpm build` (or `pnpm watch` for dev)
3. Enable "babeltype" in Vencord plugin settings
4. Start typing
