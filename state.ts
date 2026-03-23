/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ── Cached Discord elements ──────────────────────────────────────────────────

let cachedBarEl:  HTMLElement | null = null;
let cachedChatEl: HTMLElement | null = null;

export function getBarEl(): HTMLElement | null {
    if (!cachedBarEl || !document.contains(cachedBarEl))
        cachedBarEl = document.querySelector("[class*='channelTextArea']");
    return cachedBarEl;
}

export function getChatEl(): HTMLElement | null {
    if (!cachedChatEl || !document.contains(cachedChatEl))
        cachedChatEl = document.querySelector("[class*='chatContent']");
    return cachedChatEl;
}

export function clearCachedEls() {
    cachedBarEl = null;
    cachedChatEl = null;
}

// ── Game state ───────────────────────────────────────────────────────────────

export const game = {
    combo: 0,
    comboTimer: null as ReturnType<typeof setTimeout> | null,
    usedBackspace: false,
    cleanSendStreak: 0,

    styleScore: 0,
    prevRankIdx: 0,
    multiplier: 1.0,

    wpmTimestamps: [] as number[],
    wpm: 0,

    keystrokeIntervals: [] as number[],
    lastRhythmTime: 0,
    flowStateCooldown: 0,

    lastShakeTime: 0,

    // Trick detection
    lastBurstCheck: 0,
    speedDemonStart: 0,
    lastSpeedDemonTrigger: 0,
};

const GAME_DEFAULTS = { ...game };

export function resetGameState() {
    Object.assign(game, GAME_DEFAULTS);
    game.wpmTimestamps = [];
    game.keystrokeIntervals = [];
    game.comboTimer = null;
}

// ── Session stats ────────────────────────────────────────────────────────────

export const session = {
    peakRankIdx: 0,
    peakWpm: 0,
    highCombo: 0,
    rankSamples: [] as number[],
    summaryTimeout: null as ReturnType<typeof setTimeout> | null,
    summaryTriggered: false,
    hudShown: false,
};

export function resetSession() {
    session.peakRankIdx = 0;
    session.peakWpm = 0;
    session.highCombo = 0;
    session.rankSamples = [];
    session.summaryTriggered = false;
    session.hudShown = false;
    if (session.summaryTimeout) {
        clearTimeout(session.summaryTimeout);
        session.summaryTimeout = null;
    }
}

// ── Honored One state ────────────────────────────────────────────────────────

export const honored = {
    active: false,
    audioTimer:      null as ReturnType<typeof setTimeout> | null,
    purpleTimer:     null as ReturnType<typeof setTimeout> | null,
    crashTimer:      null as ReturnType<typeof setTimeout> | null,
    stagelightTimer: null as ReturnType<typeof setTimeout> | null,
    redBlueTimer:    null as ReturnType<typeof setTimeout> | null,
    iframe:          null as HTMLIFrameElement | null,
    audio:           null as HTMLAudioElement  | null,
};

export function clearHonoredTimers() {
    const timers = ["audioTimer", "purpleTimer", "crashTimer", "stagelightTimer", "redBlueTimer"] as const;
    for (const key of timers) {
        if (honored[key]) {
            clearTimeout(honored[key]!);
            honored[key] = null;
        }
    }
}

export function resetHonored() {
    honored.active = false;
    clearHonoredTimers();
    honored.iframe = null;
    honored.audio = null;
}

// ── Challenge state ──────────────────────────────────────────────────────────

export const challenge = {
    active: false,
    phrase: "",
    progress: 0,
    el: null as HTMLDivElement | null,
    timeout: null as ReturnType<typeof setTimeout> | null,
    cooldown: 0,
};

export function resetChallenge() {
    challenge.active = false;
    challenge.phrase = "";
    challenge.progress = 0;
    challenge.el = null;
    if (challenge.timeout) {
        clearTimeout(challenge.timeout);
        challenge.timeout = null;
    }
    challenge.cooldown = 0;
}
