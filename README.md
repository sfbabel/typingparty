# TypingParty

A [Vencord](https://vencord.dev/) plugin that turns Discord typing into a DMC-inspired style meter — rewarding speed and rhythm with confetti, screenshake, rank-up drama, and a secret ultimate rank.

## Features

- **Style meter** — gain style points through typing speed and rhythm consistency. Points drain over time; higher ranks drain faster.
- **Combo system** — every keystroke builds your combo. Inactivity breaks it. Milestones at 10x/25x/50x/100x give bonus style + popups.
- **Rolling WPM** — 2-second sliding window, recalculated 10x/sec so it responds instantly.
- **Confetti** — particles burst from your caret as you type. Density scales with rank. GPU-composited via a single shared `requestAnimationFrame` loop.
- **Screen shake** — chat area shakes at B rank and above. Intensity scales with rank and user setting.
- **Flow state** — 6+ consistent keystrokes at high rhythm consistency triggers a "flow state" bonus.
- **Send celebration** — sending a message with no backspaces triggers a confetti burst and popup ("clean", combo count, or "flawless").
- **Backspace forgiveness** — small penalty (6 style, combo -3) instead of a full combo break.
- **Session summary** — after you stop typing, shows your modal (most common) rank, peak rank, high combo, and peak WPM.
- **Bar glow** — the message bar gets a subtle glow at S rank and above.

## Ranks

| Rank  | Style Score | Vibe |
|-------|------------|------|
| D     | 0          | Just warming up |
| C     | 18         | Getting there |
| B     | 38         | Respectable |
| A     | 58         | Serious |
| S     | 78         | Elite |
| DEVIL | 92         | Brutal drain — you glimpse it, you don't live in it |

DEVIL has 12 pts/100ms active drain, requiring ~160+ WPM to sustain.

## The Honored One

Hit **300 WPM** and something special happens:

- A banner appears: **"✦ honored one ✦"**
- 1 second later, music starts playing (SoundCloud embed, configurable)
- Confetti and shake are suppressed — replaced by a **golden stagelight** that slowly fades in from above, like Gojo's awakening
- At **1:16** into the track — Gojo says "Murasaki" — the entire screen flashes purple
- At **1:50** — Discord "crashes" with a fake BSOD: `:( stop code: HONORED_ONE_ACHIEVED`
- You must **maintain 300 WPM** or it instantly ends. No grace period.

The audio playback works via Electron main-process injection (`native.ts`), bypassing Chromium's autoplay policy entirely.

## Installation

### Vesktop (recommended)

1. Clone this repo into your Vencord plugins directory:
   ```
   ~/.config/vesktop/sessionData/vencordFiles/
   ```
   Or, if building from source:
2. Clone [Vencord](https://github.com/Vendicated/Vencord)
3. Copy `index.tsx` and `native.ts` into `src/plugins/typingparty/`
4. Run `pnpm build`
5. Copy the built files from `dist/` to `~/.config/vesktop/sessionData/vencordFiles/`
6. Restart Vesktop

### Files

- `index.tsx` — main plugin (renderer process): HUD, style meter, confetti, shake, Honored One visuals
- `native.ts` — Electron main process hook: forces audio playback in SoundCloud/YouTube iframes

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Confetti | On | Spawn confetti particles while typing |
| Enable Screen Shake | On | Shake the chat area based on rank |
| Shake Intensity | 1 | Screen shake cap (1 = subtle, 8 = full) |
| Confetti Density | 1 | Particles per keystroke |
| Combo Timeout | 3s | Seconds of inactivity before combo resets |
| Honored One Audio | SoundCloud link | Audio URL for the secret rank |

## Performance

- Single shared `requestAnimationFrame` loop for all particles
- `transform:translate()` for GPU-composited animation (no layout reflow)
- DOM elements cached at creation time; Discord elements lazily cached with staleness checks
- Confetti and shake auto-suppress above 400 WPM to prevent FPS drops
- Drain loop runs at 10Hz (not per-keystroke)

## License

GPL-3.0-or-later
