/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ── Ranks ────────────────────────────────────────────────────────────────────

export const RANKS = [
    { id: "d",     min: 0,  label: "D",     color: "#4e5058" },
    { id: "c",     min: 18, label: "C",     color: "#72767d" },
    { id: "b",     min: 38, label: "B",     color: "#4d96ff" },
    { id: "a",     min: 58, label: "A",     color: "#40c057" },
    { id: "s",     min: 78, label: "S",     color: "#ffd93d" },
    { id: "devil", min: 92, label: "DEVIL", color: "#ff6b6b" },
] as const;

export type RankId = typeof RANKS[number]["id"];

// Lower ranks drain gently so casual typists can still rank up
export const ACTIVE_DRAIN = [0.5, 0.6, 1.2, 2.2, 4.5, 12.0] as const;
export const IDLE_DRAIN   = [3.0, 3.5, 4.5, 6.0, 9.0, 20.0] as const;

// [comboThreshold, styleBonus]
export const COMBO_MILESTONES: [number, number][] = [
    [5, 4], [10, 7], [20, 12], [35, 16], [50, 20], [75, 25], [100, 30],
];

export const CONFETTI_COLORS = [
    "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
    "#ff6fff", "#845ef7", "#ff922b", "#20c997",
];

export const CHALLENGE_PHRASES = [
    "hollow purple", "domain expansion", "black flash",
    "unlimited void", "stand proud", "nah id win",
    "with this treasure i summon", "you are strong",
    "cursed technique", "reverse cursed", "six eyes",
    "malevolent shrine", "throughout heaven and earth",
    "chimera shadow garden", "smokin sick style",
    "jackpot", "now im motivated", "devil may cry",
    "dead weight", "this party is getting crazy",
    "babeltype", "combo breaker", "perfect send",
    "infinite potential", "resonance", "convergence",
    "the strongest", "im the real deal",
];

// ── Tuning constants ─────────────────────────────────────────────────────────

export const WPM_WINDOW_MS        = 4000;  // rolling WPM window
export const IDLE_THRESHOLD_MS    = 2000;  // time before drain switches to idle rate
export const MAX_RHYTHM_SAMPLES   = 8;
export const MAX_RANK_SAMPLES     = 600;

export const MAX_PARTICLES        = 50;
export const POPUP_MAX            = 4;
export const POPUP_DURATION_MS    = 1200;

export const MULTIPLIER_MAX       = 5.0;
export const MULTIPLIER_DECAY     = 0.015; // per drain tick (100ms)
export const BACKSPACE_STYLE_COST = 6;
export const BACKSPACE_COMBO_COST = 3;
export const COMBO_TIMEOUT_STYLE_COST = 20;

export const FLOW_THRESHOLD       = 0.75;  // rhythm consistency for flow state
export const FLOW_COOLDOWN_MS     = 10000;
export const FLOW_STYLE_BONUS     = 15;
export const FLOW_MULTI_BOOST     = 0.3;

export const BURST_MIN_INTERVALS  = 6;
export const BURST_AVG_THRESHOLD  = 90;    // ms
export const BURST_COOLDOWN_MS    = 8000;
export const BURST_MULTI_BOOST    = 0.4;

export const SPEED_DEMON_WPM      = 180;
export const SPEED_DEMON_SUSTAIN   = 3000;  // ms
export const SPEED_DEMON_COOLDOWN  = 15000; // ms
export const SPEED_DEMON_BOOST     = 0.6;

export const HONORED_ONE_WPM      = 300;
export const HONORED_ONE_DROP_WPM = 200;
export const HONORED_PERF_GUARD_WPM = 400; // suppress confetti/shake above this

export const CHALLENGE_PROB       = 0.002; // per drain tick at B+
export const CHALLENGE_COOLDOWN_MS = 30000;
export const CHALLENGE_TIMEOUT_MS  = 10000;
export const CHALLENGE_MIN_RANK   = 2;     // B

export const SUMMARY_DELAY_MS     = 3000;

// Honored One music timeline (ms from activation, +1s audio delay)
export const HO_RED_BLUE_MS       = 67_000;
export const HO_MURASAKI_MS       = 80_000;
export const HO_CRASH_MS          = 104_000;
export const HO_STAGELIGHT_MS     = 3000;
export const HO_AUDIO_DELAY_MS    = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getRankIndex(score: number): number {
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (score >= RANKS[i].min) return i;
    }
    return 0;
}
