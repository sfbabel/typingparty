/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

// ── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    enableConfetti: {
        type: OptionType.BOOLEAN,
        description: "Spawn confetti particles while typing",
        default: true,
    },
    enableScreenShake: {
        type: OptionType.BOOLEAN,
        description: "Shake the chat area based on rank",
        default: true,
    },
    shakeIntensity: {
        type: OptionType.SLIDER,
        description: "Screen shake cap — lower = less shaking (1 = subtle, 4 = full)",
        markers: [1, 2, 3, 4, 5, 6, 7, 8],
        default: 1,
        stickToMarkers: true,
    },
    confettiDensity: {
        type: OptionType.SLIDER,
        description: "Confetti particles per keystroke",
        markers: [1, 2, 3, 4, 5],
        default: 1,
        stickToMarkers: true,
    },
    comboTimeoutMs: {
        type: OptionType.SLIDER,
        description: "Seconds of inactivity before combo resets",
        markers: [1, 2, 3, 4, 5, 6, 7, 8],
        default: 3,
        stickToMarkers: true,
    },
    honoredOneAudioUrl: {
        type: OptionType.STRING,
        description: "Audio track for a certain secret — SoundCloud/YouTube URL or direct .mp3/.ogg/.wav link.",
        default: "https://soundcloud.com/dimitar-tasev-789043651/the-honored-one-japanese-ver-satoru-gojo",
    },
});

// ── Rank config ───────────────────────────────────────────────────────────────

const RANKS = [
    { id: "d",     min: 0,  label: "D",     color: "#4e5058" },
    { id: "c",     min: 18, label: "C",     color: "#72767d" },
    { id: "b",     min: 38, label: "B",     color: "#4d96ff" },
    { id: "a",     min: 58, label: "A",     color: "#40c057" },
    { id: "s",     min: 78, label: "S",     color: "#ffd93d" },
    { id: "devil", min: 92, label: "DEVIL", color: "#ff6b6b" },
] as const;

// Lower ranks drain gently so casual typists can still rank up
const ACTIVE_DRAIN = [0.5, 0.6, 1.2, 2.2, 4.5, 12.0] as const;
const IDLE_DRAIN   = [3.0, 3.5, 4.5, 6.0, 9.0, 20.0] as const;

// More frequent milestones — dopamine hits like landing tricks
const COMBO_MILESTONES: [number, number][] = [[5, 4], [10, 7], [20, 12], [35, 16], [50, 20], [75, 25], [100, 30]];

function getRankIndex(score: number): number {
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (score >= RANKS[i].min) return i;
    }
    return 0;
}

// ── Confetti ──────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = [
    "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
    "#ff6fff", "#845ef7", "#ff922b", "#20c997",
];

// Single shared animation loop — one rAF for all particles instead of one per particle.
// Particles use transform:translate() which is GPU-composited (no layout reflow per frame).
interface Particle { el: HTMLDivElement; dx: number; dy: number; rot: number; t0: number; dur: number; }
const particles: Particle[] = [];
let particleRaf: number | null = null;

function tickParticles(now: number) {
    let i = particles.length;
    while (i--) {
        const p = particles[i];
        const prog = (now - p.t0) / p.dur;
        if (prog >= 1) {
            p.el.remove();
            // Swap-and-pop — O(1) instead of splice O(n)
            particles[i] = particles[particles.length - 1];
            particles.pop();
            continue;
        }
        const ease = 1 - prog * prog;
        p.el.style.transform = `translate(${p.dx * prog}px,${p.dy * prog + 80 * prog * prog}px) rotate(${p.rot + 360 * prog}deg)`;
        p.el.style.opacity   = String(ease);
    }
    particleRaf = particles.length > 0 ? requestAnimationFrame(tickParticles) : null;
}

// ── State ─────────────────────────────────────────────────────────────────────

let hud: HTMLDivElement | null = null;
let particleContainer: HTMLDivElement | null = null;

// Cached HUD child refs — queried once at createHud, not on every update
let hudRankEl:  HTMLElement | null = null;
let hudFillEl:  HTMLElement | null = null;
let hudComboEl: HTMLElement | null = null;
let hudWpmEl:   HTMLElement | null = null;
let hudWpmSep:  HTMLElement | null = null;
let hudPkEl:    HTMLElement | null = null;
let hudPkSep:   HTMLElement | null = null;
let hudMultiEl: HTMLElement | null = null;
let hudMultiSep: HTMLElement | null = null;

// Cached Discord elements (lazily resolved, stable across channel switches)
let cachedBarEl:  HTMLElement | null = null;
let cachedChatEl: HTMLElement | null = null;

function getBarEl(): HTMLElement | null {
    if (!cachedBarEl || !document.contains(cachedBarEl))
        cachedBarEl = document.querySelector("[class*='channelTextArea']");
    return cachedBarEl;
}
function getChatEl(): HTMLElement | null {
    if (!cachedChatEl || !document.contains(cachedChatEl))
        cachedChatEl = document.querySelector("[class*='chatContent']");
    return cachedChatEl;
}

let combo              = 0;
let comboTimer: ReturnType<typeof setTimeout> | null = null;
let usedBackspace      = false;
let cleanSendStreak    = 0; // consecutive clean sends

let styleScore  = 0;
let prevRankIdx = 0;
let drainInterval: ReturnType<typeof setInterval> | null = null;
let hudShown    = false; // tracks if HUD has been shown this session (for entrance anim)

let keystrokeIntervals: number[] = [];
let lastRhythmTime    = 0;
let flowStateCooldown = 0;

let wpmTimestamps: number[] = [];
let wpm = 0;

let peakRankIdx     = 0;
let peakWpm         = 0;
let highCombo       = 0;
// Rank samples for modal average — tracked in drain loop, used in session summary
let rankSamples:    number[] = [];
let summaryTimeout: ReturnType<typeof setTimeout> | null = null;
let summaryTriggered = false;

let lastShakeTime = 0;

// Multiplier system — stacks from tricks, decays over time
let multiplier = 1.0;

// Trick detection
let lastBurstCheck       = 0;
let speedDemonStart      = 0;
let lastSpeedDemonTrigger = 0;

// Typing challenge minigame
let challengeActive  = false;
let challengePhrase  = "";
let challengeProgress = 0;
let challengeEl:      HTMLDivElement | null = null;
let challengeTimeout: ReturnType<typeof setTimeout> | null = null;
let challengeCooldown = 0;

let honoredOneActive       = false;
let honoredOneAudioTimer:  ReturnType<typeof setTimeout> | null = null;
let honoredOnePurpleTimer: ReturnType<typeof setTimeout> | null = null;
let honoredOneCrashTimer:  ReturnType<typeof setTimeout> | null = null;
let honoredOneStagelightTimer: ReturnType<typeof setTimeout> | null = null;
let honoredOneRedBlueTimer: ReturnType<typeof setTimeout> | null = null;
let honoredOneIframe: HTMLIFrameElement | null = null;
let honoredOneAudio:  HTMLAudioElement  | null = null;

// ── Rolling WPM ───────────────────────────────────────────────────────────────

// 4-second rolling window — smoother, more accurate WPM than 2s
function recordKeystrokeForWpm() {
    const now = Date.now();
    wpmTimestamps.push(now);
    wpmTimestamps = wpmTimestamps.filter(t => t >= now - 4000);
    const n = wpmTimestamps.length;
    if (n < 2) { wpm = 0; return; }
    const elapsed = (now - wpmTimestamps[0]) / 60000;
    wpm = elapsed < 0.005 ? 0 : Math.round((n / 5) / elapsed);
}

function recalcWpm() {
    const now = Date.now();
    wpmTimestamps = wpmTimestamps.filter(t => t >= now - 4000);
    const n = wpmTimestamps.length;
    if (n < 2) { wpm = 0; return; }
    const elapsed = (now - wpmTimestamps[0]) / 60000;
    wpm = elapsed < 0.005 ? 0 : Math.round((n / 5) / elapsed);
}

// ── Rhythm ────────────────────────────────────────────────────────────────────

function getRhythmConsistency(): number {
    if (keystrokeIntervals.length < 3) return 0;
    const mean = keystrokeIntervals.reduce((a, b) => a + b, 0) / keystrokeIntervals.length;
    if (!mean) return 0;
    const variance = keystrokeIntervals.reduce((s, v) => s + (v - mean) ** 2, 0) / keystrokeIntervals.length;
    return Math.max(0, 1 - Math.sqrt(variance) / mean);
}

function recordInterval() {
    const now = Date.now();
    if (lastRhythmTime > 0) {
        const iv = now - lastRhythmTime;
        if (iv >= 50 && iv <= 3000) {
            keystrokeIntervals.push(iv);
            if (keystrokeIntervals.length > 8) keystrokeIntervals.shift();
        } else if (iv > 3000) {
            keystrokeIntervals = [];
        }
    }
    lastRhythmTime = now;
}

// ── Style meter ───────────────────────────────────────────────────────────────

function gainStyle() {
    const speedBonus  = Math.min(wpm / 30, 5);
    const rhythmBonus = getRhythmConsistency() * 4;
    styleScore = Math.min(100, styleScore + (2.5 + speedBonus + rhythmBonus) * multiplier);

    const now = Date.now();
    if (keystrokeIntervals.length >= 6 && getRhythmConsistency() >= 0.75 && now - flowStateCooldown > 10000) {
        flowStateCooldown = now;
        styleScore = Math.min(100, styleScore + 15 * multiplier);
        boostMultiplier(0.3, "flow");
    }
}

function hurtStyle(amount: number) {
    styleScore = Math.max(0, styleScore - amount);
}

let drainTick = 0;
function startDrainLoop() {
    if (drainInterval) return;
    drainInterval = setInterval(() => {
        // Recalculate WPM so it decays naturally when typing stops
        recalcWpm();
        if (honoredOneActive && wpm < 200) deactivateHonoredOne();

        // Multiplier decays toward 1.0
        if (multiplier > 1.0) multiplier = Math.max(1.0, multiplier - 0.015);

        // Typing challenge — random chance when at B rank or above, ~once per 50s
        if (!challengeActive && !honoredOneActive && Math.random() < 0.002 && getRankIndex(styleScore) >= 2)
            triggerChallenge();

        if (styleScore > 0) {
            const ri   = getRankIndex(styleScore);
            const idle = Date.now() - lastRhythmTime > 2000;
            styleScore = Math.max(0, styleScore - (idle ? IDLE_DRAIN[ri] : ACTIVE_DRAIN[ri]));
            rankSamples.push(ri);
            if (rankSamples.length > 600) rankSamples.shift();
        } else if (!summaryTriggered && !summaryTimeout && (peakRankIdx > 1 || highCombo > 5)) {
            summaryTimeout = setTimeout(() => { summaryTimeout = null; showSummary(); }, 3000);
        }

        // Reposition HUD every 500ms (not 100ms) — getBoundingClientRect forces layout
        if (++drainTick % 5 === 0) positionHud();
        // Single source of truth for HUD updates — 10Hz is smooth enough
        updateHud();
    }, 100);
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function showPopup(text: string, color: string) {
    const bar = getBarEl();
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "tp-popup";
    el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 52}px;color:${color};text-shadow:0 0 12px ${color}80;`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// ── Multiplier ────────────────────────────────────────────────────────────────

function boostMultiplier(amount: number, label: string) {
    multiplier = Math.min(5.0, multiplier + amount);
    showPopup(`${label} ${multiplier.toFixed(1)}×`, "#ffd93d");
}

// ── Trick detection ──────────────────────────────────────────────────────────

function detectTricks() {
    const now = Date.now();

    // Burst — very fast sequence of 6+ keys (avg < 90ms between keys)
    if (keystrokeIntervals.length >= 6) {
        const avg = keystrokeIntervals.reduce((a, b) => a + b, 0) / keystrokeIntervals.length;
        if (avg < 90 && now - lastBurstCheck > 8000) {
            lastBurstCheck = now;
            boostMultiplier(0.4, "burst");
        }
    }

    // Speed demon — sustained 180+ WPM for 3+ seconds
    if (wpm >= 180) {
        if (!speedDemonStart) speedDemonStart = now;
        else if (now - speedDemonStart > 3000 && now - lastSpeedDemonTrigger > 15000) {
            lastSpeedDemonTrigger = now;
            boostMultiplier(0.6, "speed demon");
        }
    } else {
        speedDemonStart = 0;
    }
}

// ── Typing challenge minigame ────────────────────────────────────────────────

const CHALLENGE_PHRASES = [
    "hollow purple", "domain expansion", "black flash",
    "unlimited void", "stand proud", "nah id win",
    "with this treasure i summon", "you are strong",
    "cursed technique", "reverse cursed", "six eyes",
    "malevolent shrine", "throughout heaven and earth",
    "chimera shadow garden", "smokin sick style",
    "jackpot", "now im motivated", "devil may cry",
    "dead weight", "this party is getting crazy",
    "typing party", "combo breaker", "perfect send",
    "infinite potential", "resonance", "convergence",
    "the strongest", "im the real deal",
];

function triggerChallenge() {
    if (challengeActive || honoredOneActive) return;
    const now = Date.now();
    if (now - challengeCooldown < 30000) return;
    challengeCooldown = now;

    const bar = getBarEl();
    if (!bar) return;

    challengePhrase = CHALLENGE_PHRASES[Math.floor(Math.random() * CHALLENGE_PHRASES.length)];
    challengeProgress = 0;
    challengeActive = true;
    const rect = bar.getBoundingClientRect();

    challengeEl = document.createElement("div");
    challengeEl.id = "tp-challenge";
    challengeEl.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 70}px;`;
    challengeEl.innerHTML = `
        <div class="tp-chal-label">type this</div>
        <div class="tp-chal-phrase">
            <span class="tp-chal-done"></span><span class="tp-chal-cursor">${challengePhrase[0]}</span><span class="tp-chal-remaining">${challengePhrase.slice(1)}</span>
        </div>
        <div class="tp-chal-timer"></div>
    `;
    document.body.appendChild(challengeEl);

    challengeTimeout = setTimeout(() => dismissChallenge(), 10000);
}

function checkChallenge(key: string) {
    if (!challengeActive || !challengeEl) return;

    const expected = challengePhrase[challengeProgress];
    if (key.toLowerCase() === expected) {
        challengeProgress++;
        // Small style reward per correct char — makes it feel responsive
        styleScore = Math.min(100, styleScore + 1.5 * multiplier);

        const done = challengeEl.querySelector(".tp-chal-done") as HTMLElement;
        const cursor = challengeEl.querySelector(".tp-chal-cursor") as HTMLElement;
        const remaining = challengeEl.querySelector(".tp-chal-remaining") as HTMLElement;

        if (done) done.textContent = challengePhrase.slice(0, challengeProgress);

        if (challengeProgress >= challengePhrase.length) {
            completeChallenge();
            return;
        }

        if (cursor) cursor.textContent = challengePhrase[challengeProgress];
        if (remaining) remaining.textContent = challengePhrase.slice(challengeProgress + 1);
    } else if (key !== " ") {
        // Non-space wrong key = fail. Stray spaces are silently ignored (Discord quirk).
        dismissChallenge();
    }
}

function completeChallenge() {
    if (!challengeActive) return;
    challengeActive = false;
    if (challengeTimeout) { clearTimeout(challengeTimeout); challengeTimeout = null; }

    const bonus = 12 + challengePhrase.length;
    styleScore = Math.min(100, styleScore + bonus * multiplier);
    boostMultiplier(0.8, "challenge");

    if (challengeEl) {
        challengeEl.classList.add("tp-chal-complete");
        setTimeout(() => { challengeEl?.remove(); challengeEl = null; }, 800);
    }
}

function dismissChallenge() {
    if (!challengeActive) return;
    challengeActive = false;
    if (challengeTimeout) { clearTimeout(challengeTimeout); challengeTimeout = null; }

    if (challengeEl) {
        challengeEl.style.animation = "tp-fade-out 0.3s ease-out forwards";
        setTimeout(() => { challengeEl?.remove(); challengeEl = null; }, 300);
    }
}

// ── Bar glow ──────────────────────────────────────────────────────────────────

let lastBarShadow = "";
function updateBarGlow(rankIdx: number) {
    const bar = getBarEl();
    if (!bar) return;
    const shadow = honoredOneActive
        ? "0 0 0 1.5px rgba(199,125,255,0.5),0 0 32px rgba(155,89,182,0.22)"
        : rankIdx === 5 ? "0 0 0 1px rgba(255,107,107,0.35),0 0 20px rgba(255,107,107,0.14)"
        : rankIdx === 4 ? "0 0 0 1px rgba(255,217,61,0.2),0 0 12px rgba(255,217,61,0.08)"
        : "";
    if (shadow !== lastBarShadow) {
        bar.style.transition = "box-shadow 0.5s ease";
        bar.style.boxShadow = shadow;
        lastBarShadow = shadow;
    }
}

// ── Session summary ───────────────────────────────────────────────────────────

function getModalRankIdx(): number {
    if (rankSamples.length === 0) return peakRankIdx;
    const counts = new Array(RANKS.length).fill(0) as number[];
    for (const r of rankSamples) counts[r]++;
    return counts.reduce((best, c, i) => c > counts[best] ? i : best, 0);
}

function showSummary() {
    if (summaryTriggered) return;
    summaryTriggered = true;
    const bar = getBarEl();
    if (!bar) return;
    const rect   = bar.getBoundingClientRect();
    const modalIdx = getModalRankIdx();
    const modal  = RANKS[modalIdx];
    const peak   = RANKS[peakRankIdx];
    const showPk = peakRankIdx > modalIdx && peakRankIdx > 1;
    const el = document.createElement("div");
    el.id = "tp-summary";
    el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 8}px;`;
    el.innerHTML = `
        <div class="tp-sum-label">session</div>
        <div class="tp-sum-rank" style="color:${modal.color}">${modal.label}</div>
        <div class="tp-sum-stats">
            <span><b>${highCombo}</b><small>combo</small></span>
            ${peakWpm > 0 ? `<span><b>${peakWpm}</b><small>wpm</small></span>` : ""}
            ${showPk ? `<span><b style="color:${peak.color}">${peak.label}</b><small>peak</small></span>` : ""}
        </div>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = "tp-fade-out 0.5s ease-out forwards";
        setTimeout(() => {
            el.remove();
            resetSessionStats();
        }, 500);
    }, 5000);
}

function resetSessionStats() {
    peakRankIdx = 0; peakWpm = 0; highCombo = 0;
    rankSamples = []; summaryTriggered = false; prevRankIdx = 0;
    cleanSendStreak = 0; hudShown = false;
    hc_dataRank = ""; hc_visible = false; hc_rankText = ""; hc_rankColor = "";
    hc_fillPct = -1; hc_fillBg = ""; hc_fillShadow = "";
    hc_combo = ""; hc_comboColor = ""; hc_wpm = ""; hc_wpmShow = true;
    hc_pk = ""; hc_pkColor = ""; hc_pkShow = true; hc_multi = ""; hc_multiShow = true;
}

function dismissSummary() {
    if (summaryTimeout) { clearTimeout(summaryTimeout); summaryTimeout = null; }
    const el = document.getElementById("tp-summary");
    if (!el) return;
    el.style.animation = "tp-fade-out 0.3s ease-out forwards";
    setTimeout(() => el.remove(), 300);
    resetSessionStats();
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function createHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "tp-hud";
    hud.innerHTML = `
        <div id="tp-rank-letter">D</div>
        <div id="tp-hud-right">
            <div id="tp-meter-track"><div id="tp-meter-fill"></div></div>
            <div id="tp-hud-stats">
                <span id="tp-combo-count">0</span><span class="tp-x">×</span>
                <span class="tp-sep tp-wpm-sep">·</span>
                <span id="tp-wpm-val"></span>
                <span class="tp-sep tp-pk-sep">·</span>
                <span id="tp-peak-val"></span>
                <span class="tp-sep tp-multi-sep">·</span>
                <span id="tp-multi-val"></span>
            </div>
        </div>
    `;
    document.body.appendChild(hud);

    // Cache child refs once — never query them again
    hudRankEl  = hud.querySelector("#tp-rank-letter");
    hudFillEl  = hud.querySelector("#tp-meter-fill");
    hudComboEl = hud.querySelector("#tp-combo-count");
    hudWpmEl   = hud.querySelector("#tp-wpm-val");
    hudWpmSep  = hud.querySelector(".tp-wpm-sep");
    hudPkEl    = hud.querySelector("#tp-peak-val");
    hudPkSep   = hud.querySelector(".tp-pk-sep");
    hudMultiEl  = hud.querySelector("#tp-multi-val");
    hudMultiSep = hud.querySelector(".tp-multi-sep");

    particleContainer = document.createElement("div");
    particleContainer.id = "tp-particles";
    document.body.appendChild(particleContainer);
}

function positionHud() {
    if (!hud) return;
    const bar = getBarEl();
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    hud.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    hud.style.right  = `${window.innerWidth - rect.right + 8}px`;
}

// HUD write cache — only touch DOM when values actually change
let hc_dataRank = ""; let hc_visible = false; let hc_rankText = ""; let hc_rankColor = "";
let hc_fillPct = -1; let hc_fillBg = ""; let hc_fillShadow = "";
let hc_combo = ""; let hc_comboColor = ""; let hc_wpm = ""; let hc_wpmShow = true;
let hc_pk = ""; let hc_pkColor = ""; let hc_pkShow = true;
let hc_multi = ""; let hc_multiShow = true;

function updateHud() {
    if (!hud) return;

    const rankIdx = getRankIndex(styleScore);
    const rank    = RANKS[rankIdx];

    if (rankIdx > peakRankIdx) peakRankIdx = rankIdx;
    if (wpm > peakWpm) peakWpm = wpm;
    if (combo > highCombo) highCombo = combo;

    if (rankIdx !== prevRankIdx) {
        if (rankIdx > prevRankIdx && rankIdx >= 2) {
            showPopup(RANKS[rankIdx].label, RANKS[rankIdx].color);
            boostMultiplier(0.3, "rank up");
            if (hudRankEl) {
                hudRankEl.animate(
                    [
                        { transform: "scale(1)" },
                        { transform: "scale(1.5)", textShadow: `0 0 20px ${RANKS[rankIdx].color}` },
                        { transform: "scale(1)" },
                    ],
                    { duration: 400, easing: "cubic-bezier(0.34, 1.3, 0.64, 1)" }
                );
            }
        }
        prevRankIdx = rankIdx;
    }
    updateBarGlow(rankIdx);

    if (wpm >= 300 && !honoredOneActive) activateHonoredOne();
    else if (honoredOneActive && wpm < 200) deactivateHonoredOne();

    // --- Dirty-checked DOM writes (skip if unchanged) ---
    const dr = honoredOneActive ? "honored" : rank.id;
    if (dr !== hc_dataRank) { hud.dataset.rank = dr; hc_dataRank = dr; }

    const shouldShow = styleScore > 0 || honoredOneActive;
    if (shouldShow && !hudShown) {
        hudShown = true;
        hud.classList.add("tp-visible", "tp-hud-enter");
        setTimeout(() => hud?.classList.remove("tp-hud-enter"), 500);
        hc_visible = true;
    } else if (shouldShow !== hc_visible) {
        hud.classList.toggle("tp-visible", shouldShow);
        hc_visible = shouldShow;
    }

    if (hudRankEl) {
        const rt = honoredOneActive ? "✦" : rank.label;
        const rc = honoredOneActive ? "#e8d5ff" : rank.color;
        if (rt !== hc_rankText) { hudRankEl.textContent = rt; hc_rankText = rt; }
        if (rc !== hc_rankColor) { hudRankEl.style.color = rc; hc_rankColor = rc; }
    }

    if (hudFillEl) {
        const lo  = rank.min;
        const hi  = rankIdx < RANKS.length - 1 ? RANKS[rankIdx + 1].min : 100;
        const pct = hi > lo ? Math.round(Math.max(0, Math.min(100, (styleScore - lo) / (hi - lo) * 100))) : 100;
        const bg  = honoredOneActive ? "#c77dff" : rank.color;
        const sh  = pct >= 90 || rankIdx >= 4 ? `0 0 6px ${rank.color}` : "none";
        if (pct !== hc_fillPct) { hudFillEl.style.width = `${pct}%`; hc_fillPct = pct; }
        if (bg !== hc_fillBg) { hudFillEl.style.background = bg; hc_fillBg = bg; }
        if (sh !== hc_fillShadow) { hudFillEl.style.boxShadow = sh; hc_fillShadow = sh; }
    }

    if (hudComboEl) {
        const ct = String(combo);
        if (ct !== hc_combo) { hudComboEl.textContent = ct; hc_combo = ct; }
        if (rank.color !== hc_comboColor) { hudComboEl.style.color = rank.color; hc_comboColor = rank.color; }
    }

    if (hudWpmEl && hudWpmSep) {
        const show = wpm > 0;
        const wt = show ? `${wpm} wpm` : "";
        if (wt !== hc_wpm) { hudWpmEl.textContent = wt; hc_wpm = wt; }
        if (show !== hc_wpmShow) { hudWpmEl.style.display = hudWpmSep.style.display = show ? "" : "none"; hc_wpmShow = show; }
    }

    if (hudPkEl && hudPkSep) {
        const show = peakRankIdx > rankIdx && peakRankIdx > 1 && !honoredOneActive;
        const pt = show ? `pk:${RANKS[peakRankIdx].label}` : "";
        const pc = show ? RANKS[peakRankIdx].color : "";
        if (pt !== hc_pk) { hudPkEl.textContent = pt; hc_pk = pt; }
        if (pc !== hc_pkColor) { hudPkEl.style.color = pc; hc_pkColor = pc; }
        if (show !== hc_pkShow) { hudPkEl.style.display = hudPkSep.style.display = show ? "" : "none"; hc_pkShow = show; }
    }

    if (hudMultiEl && hudMultiSep) {
        const show = multiplier > 1.05;
        const mt = show ? `${multiplier.toFixed(1)}×` : "";
        if (mt !== hc_multi) { hudMultiEl.textContent = mt; hc_multi = mt; }
        if (show !== hc_multiShow) { hudMultiEl.style.display = hudMultiSep.style.display = show ? "" : "none"; hc_multiShow = show; }
    }
}

function destroyHud() {
    hud?.remove(); hud = null; particleContainer?.remove(); particleContainer = null;
    hudRankEl = hudFillEl = hudComboEl = hudWpmEl = hudWpmSep = hudPkEl = hudPkSep = hudMultiEl = hudMultiSep = null;
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function spawnConfetti(x: number, y: number) {
    if (!settings.store.enableConfetti || !particleContainer) return;
    if (honoredOneActive || wpm > 400) return; // suppress at high WPM to prevent FPS death
    const tier = getRankIndex(styleScore);
    if (tier < 1) return;
    const count = Math.min(settings.store.confettiDensity + Math.floor(tier / 2), 6);
    const now = performance.now();
    for (let i = 0; i < count; i++) {
        const el    = document.createElement("div");
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const size  = 3 + Math.random() * 5;
        const ang   = Math.random() * Math.PI * 2;
        const vel   = 30 + Math.random() * 60;
        const dur   = 500 + Math.random() * 500;
        // Position set once; animation uses transform:translate() — no reflow per frame
        el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};pointer-events:none;z-index:99999;border-radius:${Math.random() > 0.5 ? "50%" : "2px"};will-change:transform,opacity;`;
        particleContainer.appendChild(el);
        particles.push({ el, dx: Math.cos(ang) * vel, dy: Math.sin(ang) * vel - 25, rot: Math.random() * 360, t0: now, dur });
    }
    if (!particleRaf) particleRaf = requestAnimationFrame(tickParticles);
}

// ── Send burst ────────────────────────────────────────────────────────────────

// Raw particle spawner — no tier/rank guard, used for the send celebration.
function spawnBurst(x: number, y: number, count: number) {
    if (!particleContainer) return;
    const now = performance.now();
    for (let i = 0; i < count; i++) {
        const el    = document.createElement("div");
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const size  = 4 + Math.random() * 6;
        // Fan upward: angle biased toward the top half of the circle
        const ang   = -Math.PI + Math.random() * Math.PI; // -180° to 0° (upward arc)
        const vel   = 50 + Math.random() * 90;
        const dur   = 700 + Math.random() * 600;
        el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};pointer-events:none;z-index:99999;border-radius:${Math.random() > 0.4 ? "50%" : "2px"};will-change:transform,opacity;`;
        particleContainer.appendChild(el);
        particles.push({ el, dx: Math.cos(ang) * vel, dy: Math.sin(ang) * vel - 20, rot: Math.random() * 360, t0: now, dur });
    }
    if (!particleRaf) particleRaf = requestAnimationFrame(tickParticles);
}

function showSendEffect(sendCombo: number, rankIdx: number) {
    const bar = getBarEl();
    if (!bar) return;
    const rect = bar.getBoundingClientRect();

    // Quick flash on the message bar — subtle white pulse
    bar.animate(
        [
            { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
            { boxShadow: "0 0 12px 2px rgba(255,255,255,0.15)" },
            { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
        ],
        { duration: 350, easing: "ease-out" }
    );

    // Burst fans upward — always fires on clean send (even D rank)
    if (particleContainer) {
        const count = 4 + rankIdx * 2 + (sendCombo >= 20 ? 6 : 0);
        const x = rect.left + rect.width * 0.5 + (Math.random() - 0.5) * rect.width * 0.4;
        const y = rect.top + rect.height * 0.3;
        spawnBurst(x, y, Math.min(count, 20));
    }

    // Popup — lower thresholds so you actually see them
    const rank = RANKS[Math.max(rankIdx, 1)];
    const label = sendCombo >= 40 ? "flawless" :
                  sendCombo >= 20 ? "perfect" :
                  sendCombo >= 8  ? "clean" : "";
    if (label) showPopup(label, rank.color);

    // Perfect message streak
    cleanSendStreak++;
    if (cleanSendStreak === 3) showPopup("streak", "#40c057");
    else if (cleanSendStreak === 5) showPopup("unstoppable", "#ffd93d");
    else if (cleanSendStreak === 10) showPopup("legendary", "#ff6b6b");
}

// ── Honored One ───────────────────────────────────────────────────────────────

// ~1:06 — Red (赫) and Blue (蒼) orbs appear on opposite sides and converge toward center
function triggerRedBlue() {
    // Remove stagelight — the scene is changing
    const sl = document.getElementById("tp-stagelight");
    if (sl) sl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 2000, fill: "forwards" }).onfinish = () => sl.remove();

    const red = document.createElement("div");
    red.id = "tp-orb-red";
    const blue = document.createElement("div");
    blue.id = "tp-orb-blue";
    document.body.appendChild(red);
    document.body.appendChild(blue);
    // They converge over ~9 seconds (1:06 → 1:15)
}

// 1:15.9 — "MURASAKI" (紫). Flash + persistent full-screen purple.
// Red and Blue merge → Hollow Purple covers everything.
function triggerMurasakiFlash() {
    // Remove converging orbs
    document.getElementById("tp-orb-red")?.remove();
    document.getElementById("tp-orb-blue")?.remove();

    // 1. Blinding white flash — solid color, cheapest possible fullscreen overlay
    const flash = document.createElement("div");
    flash.id = "tp-murasaki-flash";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);

    // 2. Shockwave ring — staggered 120ms so it emerges as flash fades
    setTimeout(() => {
        if (!honoredOneActive) return;
        const ring = document.createElement("div");
        ring.id = "tp-murasaki-ring";
        document.body.appendChild(ring);
        setTimeout(() => ring.remove(), 1200);
    }, 120);

    // 3. Technique name — 虚式「茈」 — staggered 300ms for sequence feel
    setTimeout(() => {
        if (!honoredOneActive) return;
        const kanji = document.createElement("div");
        kanji.id = "tp-murasaki-kanji";
        kanji.textContent = "虚式「茈」";
        document.body.appendChild(kanji);
        setTimeout(() => kanji.remove(), 3200);
    }, 300);

    // 4. Hard screen shake on impact
    const chat = getChatEl();
    if (chat) {
        chat.animate(
            [
                { transform: "translate(0,0)" },
                { transform: "translate(-8px,6px)" },
                { transform: "translate(10px,-7px)" },
                { transform: "translate(-5px,4px)" },
                { transform: "translate(0,0)" },
            ],
            { duration: 350, easing: "ease-out" }
        );
    }

    // 5. The persistent purple overlay
    const el = document.createElement("div");
    el.id = "tp-murasaki";
    document.body.appendChild(el);

    // Hard flash on impact, then settle into a breathing purple haze
    const anim = el.animate(
        [
            { opacity: 0 },
            { opacity: 1, offset: 0.02 },
            { opacity: 0.6, offset: 0.08 },
            { opacity: 1, offset: 0.15 },
            { opacity: 0.7, offset: 0.25 },
            { opacity: 1, offset: 0.35 },
            { opacity: 0.45 },
        ],
        { duration: 5000, easing: "ease-in-out", fill: "forwards" }
    );
    // Once settled, switch to CSS breathing animation
    anim.onfinish = () => { anim.cancel(); el.classList.add("tp-murasaki-breathe"); };
}

// 1:43 — Climax. Discord "crashes". Stays for 6 seconds then fades.
// (Fake — pointer-events:none so you can still type through it.)
function triggerFakeCrash() {
    const el = document.createElement("div");
    el.id = "tp-crash";
    document.body.appendChild(el);

    // Screen flash on entry
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, fill: "forwards" });

    // Shake the whole thing briefly
    el.animate(
        [
            { transform: "translate(0,0)" },
            { transform: "translate(-6px,4px)" },
            { transform: "translate(6px,-4px)" },
            { transform: "translate(-4px,2px)" },
            { transform: "translate(0,0)" },
        ],
        { duration: 250, delay: 80, easing: "ease-out" }
    );

    setTimeout(() => {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: "forwards" })
            .onfinish = () => el.remove();
    }, 6000);
}

// Spawns an iframe for the given final embed URL, tagging it with typingparty=1
// so the native.ts main-process hook can identify and force-play it.
function spawnHonoredIframe(embedUrl: string) {
    const iframe = document.createElement("iframe");
    iframe.id = "tp-honored-audio";
    iframe.allow = "autoplay; encrypted-media; fullscreen";
    // opacity:0 keeps it in the visual viewport — Chromium throttles truly off-screen iframes
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:none;pointer-events:none;opacity:0;";
    const sep = embedUrl.includes("?") ? "&" : "?";
    iframe.src = `${embedUrl}${sep}typingparty=1`;
    document.body.appendChild(iframe);
    honoredOneIframe = iframe;
}

function buildEmbedUrl(url: string): string | null {
    const isSoundCloud = /soundcloud\.com/i.test(url);
    const isYouTube    = /youtube(-nocookie)?\.com|youtu\.be/i.test(url);

    if (isSoundCloud) {
        return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&hide_related=true&show_comments=false`;
    }
    if (isYouTube) {
        const nocookie = url.replace(/^https?:\/\/(?:www\.)?youtube\.com/, "https://www.youtube-nocookie.com");
        const videoId  = nocookie.split("/").pop()?.split("?")[0] ?? "";
        const sep      = nocookie.includes("?") ? "&" : "?";
        return `${nocookie}${sep}autoplay=1&loop=1&playlist=${videoId}`;
    }
    return null; // direct file — handled by new Audio()
}

function activateHonoredOne() {
    if (honoredOneActive) return;
    honoredOneActive = true;

    const banner = document.createElement("div");
    banner.id = "tp-honored-banner";
    banner.innerHTML = `<span class="tp-honored-title">✦ honored one ✦</span><span class="tp-honored-sub">300 wpm</span>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 3000);

    const url = settings.store.honoredOneAudioUrl?.trim();
    if (!url) return;

    const isDirectFile = /\.(mp3|ogg|wav|flac|aac|m4a|opus)(\?|$)/i.test(url);
    const embedUrl     = isDirectFile ? null : buildEmbedUrl(url);

    // Dramatic moments keyed to the track (offsets from activation, +1s audio delay):
    //   +67s  = 1:06 Red & Blue orbs appear and converge
    //   +80s  = 1:19 MURASAKI — flash + persistent purple (after blast sfx)
    //   +104s = 1:43 crash (energy dies here)
    honoredOneRedBlueTimer = setTimeout(triggerRedBlue,      67_000);
    honoredOnePurpleTimer  = setTimeout(triggerMurasakiFlash, 80_000);
    honoredOneCrashTimer   = setTimeout(triggerFakeCrash,    104_000);

    // Stagelight — fades in after banner disappears (3s), shines down on the typing area
    honoredOneStagelightTimer = setTimeout(() => {
        honoredOneStagelightTimer = null;
        if (!honoredOneActive) return;
        const el = document.createElement("div");
        el.id = "tp-stagelight";
        document.body.appendChild(el);
    }, 3000);

    // 1-second delay — banner shows, then music drops right after
    honoredOneAudioTimer = setTimeout(() => {
        honoredOneAudioTimer = null;
        if (!honoredOneActive) return; // deactivated during the delay

        if (isDirectFile || !embedUrl) {
            try {
                const audio = new Audio(url);
                audio.loop   = true;
                audio.volume = 0.7;
                audio.play().catch(() => embedUrl && spawnHonoredIframe(embedUrl));
                honoredOneAudio = audio;
            } catch {
                if (embedUrl) spawnHonoredIframe(embedUrl);
            }
        } else {
            spawnHonoredIframe(embedUrl);
        }
    }, 1000);
}

function deactivateHonoredOne() {
    if (!honoredOneActive) return;
    honoredOneActive = false;
    if (honoredOneAudioTimer)       { clearTimeout(honoredOneAudioTimer);       honoredOneAudioTimer       = null; }
    if (honoredOnePurpleTimer)      { clearTimeout(honoredOnePurpleTimer);      honoredOnePurpleTimer      = null; }
    if (honoredOneCrashTimer)       { clearTimeout(honoredOneCrashTimer);       honoredOneCrashTimer       = null; }
    if (honoredOneStagelightTimer)  { clearTimeout(honoredOneStagelightTimer);  honoredOneStagelightTimer  = null; }
    if (honoredOneRedBlueTimer)     { clearTimeout(honoredOneRedBlueTimer);     honoredOneRedBlueTimer     = null; }
    document.getElementById("tp-murasaki")?.remove();
    document.getElementById("tp-murasaki-flash")?.remove();
    document.getElementById("tp-murasaki-ring")?.remove();
    document.getElementById("tp-murasaki-kanji")?.remove();
    document.getElementById("tp-crash")?.remove();
    document.getElementById("tp-orb-red")?.remove();
    document.getElementById("tp-orb-blue")?.remove();
    // Fade out stagelight gracefully
    const stagelight = document.getElementById("tp-stagelight");
    if (stagelight) {
        stagelight.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" })
            .onfinish = () => stagelight.remove();
    }
    if (honoredOneAudio) {
        honoredOneAudio.pause();
        honoredOneAudio.src = "";
        honoredOneAudio = null;
    }
    honoredOneIframe?.remove(); honoredOneIframe = null;
    document.getElementById("tp-honored-banner")?.remove();
    const bar = getBarEl();
    if (bar) bar.style.boxShadow = "";
}

// ── Screen shake ──────────────────────────────────────────────────────────────

function triggerShake() {
    if (!settings.store.enableScreenShake) return;
    if (honoredOneActive || wpm > 400) return; // suppress at high WPM to prevent FPS death
    const rankIdx = getRankIndex(styleScore);
    if (rankIdx < 2) return;

    const now = Date.now();
    if (now - lastShakeTime < 110) return;
    lastShakeTime = now;

    const chat = getChatEl();
    if (!chat) return;

    // Level 0=B, 1=A, 2=S, 3=DEVIL (extra intensity for DEVIL)
    const level = Math.min(rankIdx - 2, 3);
    const px    = (level + 1) * 3 * (settings.store.shakeIntensity / 4);
    const dur   = 120 + level * 28;

    chat.animate(
        [
            { transform: "translate(0,0)" },
            { transform: `translate(${-px}px,${px * 0.6}px)` },
            { transform: `translate(${px}px,${-px * 0.6}px)` },
            { transform: `translate(${-px * 0.5}px,${px * 0.35}px)` },
            { transform: "translate(0,0)" },
        ],
        { duration: dur, easing: "ease-out", composite: "replace" }
    );
}

// ── Combo ─────────────────────────────────────────────────────────────────────

function breakCombo() {
    // Called only on timeout — not on backspace
    if (combo > 0) hurtStyle(20);
    combo = 0;
}

function incrementCombo() {
    combo++;
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(breakCombo, settings.store.comboTimeoutMs * 1000);

    // Milestone rewards — style bonus + multiplier bump (like landing a trick)
    for (const [threshold, bonus] of COMBO_MILESTONES) {
        if (combo === threshold) {
            styleScore = Math.min(100, styleScore + bonus * multiplier);
            const boost = threshold >= 50 ? 0.4 : 0.2;
            boostMultiplier(boost, `${combo}×`);
            break;
        }
    }
}

// Backspace: soft penalty — nudge combo down, small style hurt, no hard reset
function softDamage() {
    usedBackspace = true;
    hurtStyle(6);
    if (combo > 0) combo = Math.max(0, combo - 3);
    if (comboTimer) clearTimeout(comboTimer);
    if (combo > 0) comboTimer = setTimeout(breakCombo, settings.store.comboTimeoutMs * 1000);
}

function onMessageSent() {
    const wasClean  = !usedBackspace;
    const sendCombo = combo;
    const rankIdx   = getRankIndex(styleScore);

    if (wasClean && combo > 0) styleScore = Math.min(100, styleScore + 8 + Math.min(combo, 20));

    // Show send celebration BEFORE resetting state so we can read rank/combo
    if (wasClean) showSendEffect(sendCombo, rankIdx);
    else cleanSendStreak = 0; // backspace breaks the streak

    usedBackspace = false;
    combo = 0; // WPM decays naturally via the 4s window — don't hard-reset
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target?.closest?.("[role='textbox']")) return;
    if (e.key.length > 1 && !["Backspace", "Delete"].includes(e.key)) return;

    dismissSummary();

    // Challenge check runs before everything — single-char keys only
    if (challengeActive && e.key.length === 1) checkChallenge(e.key);

    if (e.key === "Backspace" || e.key === "Delete") {
        softDamage();
        return;
    }

    recordInterval();
    recordKeystrokeForWpm();
    incrementCombo();
    gainStyle();
    detectTricks();
    // Confetti at caret; collapsed-range rects can be all-zero in some Discord builds
    const sel = window.getSelection();
    let cx: number, cy: number;
    if (sel && sel.rangeCount > 0) {
        const cr = sel.getRangeAt(0).getBoundingClientRect();
        if (cr.left !== 0 || cr.top !== 0) {
            cx = cr.right; cy = cr.top + cr.height * 0.5;
        } else {
            const fb = target.getBoundingClientRect();
            cx = fb.left + fb.width * (0.3 + Math.random() * 0.4); cy = fb.top;
        }
    } else {
        const fb = target.getBoundingClientRect();
        cx = fb.left + fb.width * (0.3 + Math.random() * 0.4); cy = fb.top;
    }
    spawnConfetti(cx, cy);
    triggerShake();
}

function onKeyDownCapture(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target?.closest?.("[role='textbox']")) setTimeout(onMessageSent, 50);
    }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "TypingParty",
    description: "DMC-inspired style meter — rewards speed and rhythm with confetti, screenshake, and rank-up drama. github.com/sfbabel/typingparty",
    authors: [{ name: "sfbabel", id: 0n }],
    settings,

    start() {
        const fontLink = document.createElement("link");
        fontLink.id = "tp-font"; fontLink.rel = "stylesheet";
        fontLink.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap";
        document.head.appendChild(fontLink);

        const style = document.createElement("style");
        style.id = "tp-styles"; style.textContent = CSS_TEXT;
        document.head.appendChild(style);

        createHud();
        positionHud();
        startDrainLoop();
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("keydown", onKeyDownCapture, false);
        window.addEventListener("resize", positionHud);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keydown", onKeyDownCapture, false);
        window.removeEventListener("resize", positionHud);

        if (comboTimer)     clearTimeout(comboTimer);
        if (drainInterval)  { clearInterval(drainInterval); drainInterval = null; }
        if (summaryTimeout) { clearTimeout(summaryTimeout); summaryTimeout = null; }
        if (particleRaf)    { cancelAnimationFrame(particleRaf); particleRaf = null; }
        particles.length = 0;

        deactivateHonoredOne();
        honoredOneActive = false; honoredOneAudioTimer = null; honoredOnePurpleTimer = null; honoredOneCrashTimer = null; honoredOneStagelightTimer = null; honoredOneRedBlueTimer = null; honoredOneAudio = null; honoredOneIframe = null;

        const chat = getChatEl();
        if (chat) { chat.getAnimations().forEach(a => a.cancel()); chat.style.transform = ""; }
        const bar = getBarEl();
        if (bar) bar.style.boxShadow = "";

        dismissChallenge();
        document.getElementById("tp-summary")?.remove();
        document.getElementById("tp-honored-banner")?.remove();
        document.getElementById("tp-stagelight")?.remove();
        document.querySelectorAll(".tp-popup").forEach(el => el.remove());
        destroyHud();
        document.getElementById("tp-styles")?.remove();
        document.getElementById("tp-font")?.remove();

        combo = 0; styleScore = 0; usedBackspace = false; cleanSendStreak = 0;
        keystrokeIntervals = []; wpmTimestamps = []; wpm = 0;
        lastRhythmTime = 0; flowStateCooldown = 0; lastShakeTime = 0;
        multiplier = 1.0; lastBurstCheck = 0; speedDemonStart = 0; lastSpeedDemonTrigger = 0; lastBarShadow = ""; drainTick = 0;
        challengeCooldown = 0;
        prevRankIdx = 0; hudShown = false;
        resetSessionStats();
        cachedBarEl = null; cachedChatEl = null;
    },
});

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
#tp-hud {
    position: fixed;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: 'Space Grotesk', 'gg sans', sans-serif;
    pointer-events: none;
    z-index: 9998;
    padding: 8px 14px 8px 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    opacity: 0;
    transform-origin: bottom right;
    transition:
        opacity 0.4s ease,
        transform 0.4s cubic-bezier(0.34, 1.3, 0.64, 1),
        background 0.4s ease,
        border-color 0.4s ease,
        box-shadow 0.4s ease;
}
#tp-hud.tp-visible { opacity: 1; }
/* Entrance animation — slide up from bottom-right */
#tp-hud.tp-hud-enter {
    animation: tp-hud-slide-in 0.5s cubic-bezier(0.34, 1.3, 0.64, 1) forwards;
}
@keyframes tp-hud-slide-in {
    0%   { opacity: 0; transform: translateY(16px) scale(0.8); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
}

#tp-hud[data-rank="d"],
#tp-hud[data-rank="c"] { transform: scale(0.82); }

#tp-hud[data-rank="b"],
#tp-hud[data-rank="a"] { transform: scale(1.0); }

#tp-hud[data-rank="s"] {
    transform: scale(1.1);
    background: rgba(0,0,0,0.5);
    border-color: rgba(255,255,255,0.05);
    box-shadow: 0 4px 18px rgba(0,0,0,0.45);
    backdrop-filter: blur(12px);
}

#tp-hud[data-rank="devil"] {
    transform: scale(1.2);
    background: rgba(0,0,0,0.62);
    border-color: rgba(255,107,107,0.12);
    box-shadow: 0 0 24px rgba(255,107,107,0.18), 0 4px 22px rgba(0,0,0,0.55);
    backdrop-filter: blur(16px);
}

#tp-rank-letter {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 30px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.5px;
    min-width: 46px;
    text-align: center;
    text-transform: uppercase;
    transition: color 0.25s ease, text-shadow 0.3s ease;
}
#tp-hud[data-rank="s"]     #tp-rank-letter { text-shadow: 0 0 10px currentColor; }
#tp-hud[data-rank="devil"] #tp-rank-letter {
    text-shadow: 0 0 14px currentColor, 0 0 30px currentColor;
    animation: tp-devil-pulse 0.8s ease-in-out infinite alternate;
}
@keyframes tp-devil-pulse {
    from { filter: brightness(1); }
    to   { filter: brightness(1.6); }
}

#tp-hud-right { display: flex; flex-direction: column; gap: 4px; }

#tp-meter-track {
    width: 72px; height: 3px; border-radius: 2px; overflow: hidden;
    background: rgba(255,255,255,0.07);
}
#tp-meter-fill {
    height: 100%; border-radius: 2px;
    transition: width 0.12s ease-out, background 0.25s ease, box-shadow 0.25s ease;
}
#tp-hud-stats {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 10px; font-weight: 400; letter-spacing: 0.5px;
    text-transform: lowercase; display: flex; align-items: center;
    gap: 3px; color: rgba(255,255,255,0.35); line-height: 1;
}
#tp-combo-count { font-weight: 600; transition: color 0.2s ease; }
.tp-x   { opacity: 0.3; font-weight: 300; }
.tp-sep { opacity: 0.25; }
#tp-wpm-val  { color: rgba(255,255,255,0.28); }
#tp-peak-val { font-weight: 600; }
#tp-multi-val { color: #ffd93d; font-weight: 600; }

.tp-popup {
    position: fixed;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px; font-weight: 500; letter-spacing: 2px;
    text-transform: lowercase; pointer-events: none; z-index: 9999;
    animation: tp-float-up 1.2s ease-out forwards;
}
@keyframes tp-float-up {
    0%   { opacity: 0; transform: translateY(4px); }
    18%  { opacity: 1; transform: translateY(-8px); }
    100% { opacity: 0; transform: translateY(-52px); }
}

#tp-summary {
    position: fixed; font-family: 'Space Grotesk', sans-serif;
    text-align: center; pointer-events: none; z-index: 9998;
    background: rgba(18,19,22,0.96); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px; padding: 14px 22px 12px; backdrop-filter: blur(18px);
    box-shadow: 0 8px 28px rgba(0,0,0,0.55); min-width: 130px;
    animation: tp-summary-in 0.4s cubic-bezier(0.34, 1.3, 0.64, 1) forwards;
}
.tp-sum-label { font-size: 9px; font-weight: 400; letter-spacing: 3px; color: #2e3035; margin-bottom: 4px; text-transform: lowercase; }
.tp-sum-rank  { font-size: 46px; font-weight: 700; line-height: 1; margin-bottom: 8px; }
.tp-sum-stats { display: flex; justify-content: center; gap: 16px; }
.tp-sum-stats span { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tp-sum-stats b    { font-size: 17px; font-weight: 600; color: #dcddde; line-height: 1; }
.tp-sum-stats small{ font-size: 8px; font-weight: 400; letter-spacing: 2px; color: #2e3035; text-transform: lowercase; }
@keyframes tp-summary-in {
    0%   { opacity: 0; transform: translateY(8px) scale(0.93); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes tp-fade-out {
    0%   { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(6px); }
}

/* ── Typing challenge ──────────────────────────────────────────────────────── */
#tp-challenge {
    position: fixed;
    font-family: 'Space Grotesk', sans-serif;
    pointer-events: none; z-index: 9999;
    background: rgba(18,19,22,0.95);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px; padding: 10px 16px;
    backdrop-filter: blur(12px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    animation: tp-summary-in 0.3s ease-out forwards;
}
.tp-chal-label {
    font-size: 8px; font-weight: 400; letter-spacing: 3px;
    color: rgba(255,255,255,0.25); text-transform: lowercase;
    margin-bottom: 6px;
}
.tp-chal-phrase {
    font-size: 16px; font-weight: 500; letter-spacing: 1px;
    line-height: 1.4; white-space: nowrap;
}
.tp-chal-done { color: #40c057; }
.tp-chal-cursor { color: #fff; text-decoration: underline; }
.tp-chal-remaining { color: rgba(255,255,255,0.2); }
.tp-chal-timer {
    margin-top: 6px; width: 100%; height: 2px; border-radius: 1px;
    background: rgba(255,217,61,0.5);
    transform-origin: left center;
    will-change: transform;
    animation: tp-chal-countdown 10s linear forwards;
}
@keyframes tp-chal-countdown {
    0%   { transform: scaleX(1); }
    80%  { background: rgba(255,217,61,0.5); }
    100% { transform: scaleX(0); background: rgba(255,107,107,0.5); }
}
.tp-chal-complete {
    border-color: rgba(64,192,87,0.3) !important;
    animation: tp-chal-success 0.8s ease-out forwards !important;
}
@keyframes tp-chal-success {
    0%   { opacity: 1; transform: scale(1); }
    25%  { opacity: 1; transform: scale(1.06); border-color: rgba(64,192,87,0.5); }
    100% { opacity: 0; transform: scale(0.95) translateY(-10px); }
}

/* ── Honored One ─────────────────────────────────────────────────────────────── */
#tp-honored-banner {
    position: fixed; top: 50%; left: 50%;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-family: 'Space Grotesk', sans-serif; pointer-events: none; z-index: 99998;
    animation: tp-honored-banner-anim 3s ease-out forwards;
}
.tp-honored-title {
    font-size: 60px; font-weight: 700; letter-spacing: 10px;
    color: #e8d5ff; text-transform: lowercase;
    text-shadow: 0 0 32px #c77dff, 0 0 64px #9b59b6;
}
.tp-honored-sub {
    font-size: 13px; font-weight: 300; letter-spacing: 8px;
    color: rgba(200,180,255,0.5); text-transform: lowercase;
}
@keyframes tp-honored-banner-anim {
    0%   { opacity: 0; transform: translate(-50%, -44%) scale(0.88); }
    12%  { opacity: 1; transform: translate(-50%, -50%) scale(1.02); }
    72%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0); }
    100% { opacity: 0; transform: translate(-50%, -56%) scale(0.96); }
}
#tp-hud[data-rank="honored"] {
    transform: scale(1.5);
    background: rgba(28, 8, 50, 0.9);
    border-color: rgba(200, 150, 255, 0.18);
    box-shadow: 0 0 40px rgba(155,89,182,0.35), 0 4px 24px rgba(0,0,0,0.65);
    backdrop-filter: blur(16px);
}
#tp-hud[data-rank="honored"] #tp-rank-letter {
    animation: tp-honored-pulse 0.9s ease-in-out infinite alternate;
}
@keyframes tp-honored-pulse {
    from { filter: brightness(1.0); text-shadow: 0 0 16px #e8d5ff, 0 0 32px #9b59b6; }
    to   { filter: brightness(1.9); text-shadow: 0 0 28px #fff,    0 0 56px #c77dff; }
}

/* ── Red & Blue orbs (1:06) — converge toward center ─────────────────────── */
#tp-orb-red, #tp-orb-blue {
    position: fixed; top: 50%; width: 120px; height: 120px;
    border-radius: 50%; pointer-events: none; z-index: 999997;
    filter: blur(30px);
    will-change: translate, scale, opacity;
    animation: tp-orb-converge 9s ease-in forwards;
}
#tp-orb-red {
    left: 5%; transform: translateY(-50%);
    background: radial-gradient(circle, #ff4444 0%, #cc0000 50%, transparent 100%);
    box-shadow: 0 0 60px #ff4444, 0 0 120px #cc000080;
    --tp-target-x: calc(50vw - 60px - 5vw);
}
#tp-orb-blue {
    right: 5%; left: auto; transform: translateY(-50%);
    background: radial-gradient(circle, #4488ff 0%, #0044cc 50%, transparent 100%);
    box-shadow: 0 0 60px #4488ff, 0 0 120px #0044cc80;
    --tp-target-x: calc(-50vw + 60px + 5vw);
}
@keyframes tp-orb-converge {
    0%   { opacity: 0; translate: 0 0; scale: 0.5; }
    15%  { opacity: 1; scale: 1; }
    85%  { opacity: 1; scale: 1.3; }
    100% { opacity: 0; translate: var(--tp-target-x) 0; scale: 0.6; }
}

/* ── Murasaki (1:15.9) — persistent full-screen purple ───────────────────── */
#tp-murasaki {
    position: fixed; inset: 0; z-index: 999998; pointer-events: none;
    background: radial-gradient(ellipse at center, #c864ff 0%, #9b30ff 25%, #7b1fa2 45%, #4a007a 65%, #1a0033 100%);
    opacity: 0;
}
.tp-murasaki-breathe {
    animation: tp-murasaki-breathe 3.5s ease-in-out infinite alternate !important;
}
@keyframes tp-murasaki-breathe {
    from { opacity: 0.35; }
    to   { opacity: 0.52; }
}

/* White flash on Murasaki impact — solid color, no gradient compositing */
#tp-murasaki-flash {
    position: fixed; inset: 0; z-index: 999999; pointer-events: none;
    background: #fff;
    will-change: opacity;
    animation: tp-murasaki-flash-anim 0.7s ease-out forwards;
}
@keyframes tp-murasaki-flash-anim {
    0%   { opacity: 0; }
    5%   { opacity: 1; }
    15%  { opacity: 0.6; }
    100% { opacity: 0; }
}

/* Expanding shockwave ring — border + opacity only, NO box-shadow (kills perf at scale) */
#tp-murasaki-ring {
    position: fixed; top: 50%; left: 50%;
    width: 40px; height: 40px; margin: -20px 0 0 -20px;
    border-radius: 50%;
    border: 2.5px solid rgba(200,100,255,0.85);
    pointer-events: none; z-index: 999999;
    will-change: transform, opacity;
    animation: tp-ring-expand 1.2s ease-out forwards;
}
@keyframes tp-ring-expand {
    0%   { transform: scale(0.3); opacity: 1; }
    25%  { opacity: 0.7; }
    100% { transform: scale(30); opacity: 0; }
}

/* Technique kanji — 虚式「茈」 — NO filter:blur (forces re-rasterization per frame) */
#tp-murasaki-kanji {
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    font-size: 72px; font-weight: 700;
    color: #f0e0ff;
    text-shadow: 0 0 30px #c77dff, 0 0 60px #9b59b6, 0 0 100px #7b1fa2;
    pointer-events: none; z-index: 999999;
    letter-spacing: 14px;
    will-change: transform, opacity;
    animation: tp-kanji-anim 3.2s ease-out forwards;
}
@keyframes tp-kanji-anim {
    0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
    10%  { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
    50%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(1.12); }
}

/* ── Crash screen (1:43) ─────────────────────────────────────────────────────── */
#tp-crash {
    position: fixed; inset: 0; z-index: 999999; pointer-events: none;
    background: #0d0d0d;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px;
    font-family: 'Space Grotesk', monospace; opacity: 0;
}
#tp-crash::before {
    content: ":(";
    font-size: 120px; font-weight: 700; color: #fff; line-height: 1;
}
#tp-crash::after {
    content: "Your Discord ran into a problem.\\Astop code:  HONORED_ONE_ACHIEVED";
    white-space: pre;
    font-size: 15px; font-weight: 400; color: rgba(255,255,255,0.7);
    text-align: center; line-height: 2; letter-spacing: 1px;
}

/* ── Stagelight (Honored One) — golden Gojo awakening ────────────────────── */
#tp-stagelight {
    position: fixed; inset: 0; z-index: 9997; pointer-events: none;
    background:
        radial-gradient(ellipse 32% 100% at 50% 0%,
            rgba(255,215,80,0.28) 0%,
            rgba(255,180,40,0.14) 30%,
            rgba(255,150,20,0.05) 55%,
            transparent 75%),
        radial-gradient(ellipse 18% 80% at 50% 0%,
            rgba(255,240,180,0.18) 0%,
            transparent 60%),
        linear-gradient(180deg,
            rgba(255,220,100,0.08) 0%,
            transparent 50%);
    opacity: 0;
    animation: tp-stagelight-in 2.5s ease-in forwards;
}
@keyframes tp-stagelight-in {
    0%   { opacity: 0; }
    100% { opacity: 1; }
}
#tp-stagelight::before {
    content: "";
    position: absolute;
    top: 0; left: 50%; width: 4px; height: 100vh;
    transform: translateX(-50%) scaleY(0);
    transform-origin: top center;
    background: linear-gradient(180deg, rgba(255,230,140,0.7), rgba(255,200,60,0.15), transparent);
    will-change: transform, opacity;
    animation: tp-stagelight-beam 2s ease-out 0.5s forwards;
}
@keyframes tp-stagelight-beam {
    0%   { transform: translateX(-50%) scaleY(0); opacity: 0; }
    100% { transform: translateX(-50%) scaleY(1); opacity: 1; }
}

#tp-particles {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 99999; overflow: hidden;
}
`;
