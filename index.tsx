/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Miku
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
        default: 2,
        stickToMarkers: true,
    },
    confettiDensity: {
        type: OptionType.SLIDER,
        description: "Confetti particles per keystroke",
        markers: [1, 2, 3, 4, 5],
        default: 2,
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
        description: "YouTube embed URL for the secret Honored One rank theme",
        default: "https://www.youtube.com/embed/zv2nHpEgqVU",
    },
});

// ── Rank config ───────────────────────────────────────────────────────────────
//
// Tuned so that:
//   D/C  → just typing anything
//   B/A  → ~40–60 wpm
//   S    → ~80 wpm + decent rhythm
//   WILD → ~120 wpm + good rhythm
//   DEVIL→ ~150 wpm + great rhythm  /  ~200 wpm average rhythm
//
const RANKS = [
    { id: "d",     min: 0,  label: "D",     color: "#4e5058" },
    { id: "c",     min: 12, label: "C",     color: "#72767d" },
    { id: "b",     min: 28, label: "B",     color: "#4d96ff" },
    { id: "a",     min: 46, label: "A",     color: "#40c057" },
    { id: "s",     min: 64, label: "S",     color: "#ffd93d" },
    { id: "wild",  min: 78, label: "WILD",  color: "#ff922b" },
    { id: "devil", min: 90, label: "DEVIL", color: "#ff6b6b" },
] as const;

// Active drain/tick (100 ms) and idle drain/tick (>2 s no keystroke):
//   D   → 0.8  / 4.0
//   C   → 1.0  / 4.0
//   B   → 1.5  / 5.0
//   A   → 2.5  / 6.0
//   S   → 4.0  / 8.0
//   WILD→ 6.5  / 12.0
//   DEVIL→10.0 / 16.0
const ACTIVE_DRAIN = [0.8, 1.0, 1.5, 2.5, 4.0, 6.5, 10.0] as const;
const IDLE_DRAIN   = [4.0, 4.0, 5.0, 6.0, 8.0, 12.0, 16.0] as const;

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
    "#f06595", "#cc5de8", "#5c7cfa", "#22b8cf",
];
const CONFETTI_SHAPES = ["square", "circle", "triangle"] as const;

// ── State ─────────────────────────────────────────────────────────────────────

let hud: HTMLDivElement | null = null;
let particleContainer: HTMLDivElement | null = null;

// Combo
let combo              = 0;
let comboMultiplier    = 1;
let comboTimer: ReturnType<typeof setTimeout> | null = null;
let messagesSentInWindow = 0;
let lastMessageTime    = 0;
let usedBackspace      = false;

// Style meter
let styleScore  = 0;
let prevRankIdx = 0;
let drainInterval: ReturnType<typeof setInterval> | null = null;

// Rhythm
let keystrokeIntervals: number[] = [];
let lastRhythmTime    = 0;
let flowStateCooldown = 0;

// WPM — 5 s rolling window
let wpmTimestamps: number[] = [];
let wpm = 0;

// Session
let peakRankIdx     = 0;
let peakWpm         = 0;
let highCombo       = 0;
let droppedToDTime  = 0;
let summaryTimeout: ReturnType<typeof setTimeout> | null = null;
let summaryTriggered = false;

// Shake throttle
let lastShakeTime = 0;

// Honored One (secret rank at 300 WPM)
let honoredOneActive    = false;
let honoredOneIframe: HTMLIFrameElement | null = null;

// ── Utility ───────────────────────────────────────────────────────────────────

function getBarRect(): DOMRect | null {
    return (document.querySelector("[class*='channelTextArea']") as HTMLElement | null)?.getBoundingClientRect() ?? null;
}

// ── Rolling WPM ───────────────────────────────────────────────────────────────

function recordKeystrokeForWpm() {
    const now = Date.now();
    wpmTimestamps.push(now);
    wpmTimestamps = wpmTimestamps.filter(t => t >= now - 5000);
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
//
// Gain per keystroke:
//   base      1.5
//   speed     min(wpm / 40, 4)   → 0 at 0 wpm, 4 at 160+ wpm
//   rhythm    consistency × 4    → 0–4
//   max       9.5 / keystroke
//
// Verified break-even points (gain/s = drain/s):
//   S    : 80 wpm + perfect rhythm  |  can't sustain at 80 wpm avg rhythm
//   WILD : 120 wpm + decent rhythm  |  ~120 wpm + perfect = comfortable
//   DEVIL: 150 wpm + great rhythm   |  ~200 wpm + avg rhythm
//
function gainStyle() {
    const speedBonus  = Math.min(wpm / 40, 4);
    const rhythmBonus = getRhythmConsistency() * 4;
    styleScore = Math.min(100, styleScore + 1.5 + speedBonus + rhythmBonus);

    const now = Date.now();
    if (keystrokeIntervals.length >= 6 && getRhythmConsistency() >= 0.75 && now - flowStateCooldown > 10000) {
        flowStateCooldown = now;
        styleScore = Math.min(100, styleScore + 15);
        showPopup("FLOW STATE!", "#4d96ff", true);
    }
}

function hurtStyle(amount: number) {
    styleScore = Math.max(0, styleScore - amount);
}

function startDrainLoop() {
    if (drainInterval) return;
    drainInterval = setInterval(() => {
        // ── WPM decay: recalculate every tick so wpm reflects current reality,
        //    not just the last keypress. Without this, wpm stays stale for seconds.
        const now = Date.now();
        wpmTimestamps = wpmTimestamps.filter(t => t >= now - 5000);
        const wpmN = wpmTimestamps.length;
        if (wpmN >= 2) {
            const elapsed = (now - wpmTimestamps[0]) / 60000;
            wpm = elapsed < 0.005 ? 0 : Math.round((wpmN / 5) / elapsed);
        } else {
            wpm = 0;
        }
        // Honored One deactivation can happen even when styleScore = 0
        if (honoredOneActive && wpm < 300) deactivateHonoredOne();

        if (styleScore <= 0) {
            if (!summaryTriggered && !summaryTimeout && (peakRankIdx > 1 || highCombo > 5)) {
                summaryTimeout = setTimeout(() => { summaryTimeout = null; showSummary(); }, 3000);
            }
            return;
        }
        const ri   = getRankIndex(styleScore);
        const idle = now - lastRhythmTime > 2000;
        styleScore = Math.max(0, styleScore - (idle ? IDLE_DRAIN[ri] : ACTIVE_DRAIN[ri]));
        updateHud();
    }, 100);
}

// ── Popups ────────────────────────────────────────────────────────────────────

function showPopup(text: string, color: string, large = false, delayMs = 0) {
    const doShow = () => {
        const rect = getBarRect();
        if (!rect) return;
        const el = document.createElement("div");
        el.className = "tp-popup";
        const jitter = large ? 0 : (Math.random() - 0.5) * 36;
        el.style.cssText = `
            right:${window.innerWidth - rect.right + 8 + jitter}px;
            bottom:${window.innerHeight - rect.top + (large ? 60 : 42) + Math.random() * 14}px;
            color:${color};
            font-size:${large ? "18px" : "11px"};
            font-weight:${large ? 700 : 600};
            letter-spacing:${large ? "4px" : "2px"};
            text-shadow:0 0 14px ${color},0 0 28px ${color}40;
            animation-duration:${large ? "1.5s" : "1.1s"};
        `;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), large ? 1500 : 1100);
    };
    delayMs > 0 ? setTimeout(doShow, delayMs) : doShow();
}

function showRankUpFlash(rankIdx: number) {
    const rank = RANKS[rankIdx];
    const rect = getBarRect();
    if (!rect) return;
    const el = document.createElement("div");
    el.className = "tp-rankup-flash";
    el.textContent = rank.label;
    el.style.cssText = `
        right:${window.innerWidth - rect.right + 8}px;
        bottom:${window.innerHeight - rect.top + 72}px;
        color:${rank.color};
        text-shadow:0 0 30px ${rank.color},0 0 60px ${rank.color}80;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

function screenFlash(color: string) {
    const el = document.createElement("div");
    el.style.cssText = `position:fixed;inset:0;background:${color};pointer-events:none;z-index:99997;animation:tp-screen-flash 0.4s ease-out forwards;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 400);
}

// ── Rank change events ────────────────────────────────────────────────────────

function onRankChange(oldIdx: number, newIdx: number) {
    if (newIdx > oldIdx) {
        if (newIdx >= 4) { showRankUpFlash(newIdx); screenFlash(RANKS[newIdx].color + "18"); }
        if (newIdx === 4) showPopup("STYLISH!",    RANKS[4].color, true);
        if (newIdx === 5) showPopup("GOING WILD!", RANKS[5].color, true);
        if (newIdx === 6) showPopup("DEVIL TRIGGER!", RANKS[6].color, true);

        if (newIdx >= 3 && droppedToDTime > 0 && Date.now() - droppedToDTime < 4000) {
            showPopup("COMEBACK!", "#ffd93d", true, 500);
            droppedToDTime = 0;
        }
    } else {
        if (newIdx === 0 && oldIdx > 0) droppedToDTime = Date.now();
    }
}

// ── Bar glow ──────────────────────────────────────────────────────────────────

function updateBarGlow(rankIdx: number) {
    const bar = document.querySelector("[class*='channelTextArea']") as HTMLElement | null;
    if (!bar) return;
    bar.style.transition = "box-shadow 0.4s ease";
    if (honoredOneActive)
        bar.style.boxShadow = "0 0 0 1.5px rgba(199,125,255,0.55),0 0 36px rgba(155,89,182,0.28)";
    else if (rankIdx === 6)
        bar.style.boxShadow = "0 0 0 1.5px rgba(255,107,107,0.4),0 0 28px rgba(255,107,107,0.18)";
    else if (rankIdx === 5)
        bar.style.boxShadow = "0 0 0 1px rgba(255,146,43,0.3),0 0 18px rgba(255,146,43,0.13)";
    else
        bar.style.boxShadow = "";
}

// ── Session summary ───────────────────────────────────────────────────────────

function showSummary() {
    if (summaryTriggered) return;
    summaryTriggered = true;
    const rect = getBarRect();
    if (!rect) return;
    const peak = RANKS[peakRankIdx];
    const el = document.createElement("div");
    el.id = "tp-summary";
    el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 8}px;`;
    el.innerHTML = `
        <div class="tp-sum-label">SESSION</div>
        <div class="tp-sum-rank" style="color:${peak.color};text-shadow:0 0 24px ${peak.color}">${peak.label}</div>
        <div class="tp-sum-stats">
            <span><b>${highCombo}</b><small>BEST COMBO</small></span>
            ${peakWpm > 0 ? `<span><b>${peakWpm}</b><small>PEAK WPM</small></span>` : ""}
        </div>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = "tp-fade-out 0.5s ease-out forwards";
        setTimeout(() => {
            el.remove();
            peakRankIdx = 0; peakWpm = 0; highCombo = 0;
            summaryTriggered = false; prevRankIdx = 0;
        }, 500);
    }, 5000);
}

function dismissSummary() {
    if (summaryTimeout) { clearTimeout(summaryTimeout); summaryTimeout = null; }
    const el = document.getElementById("tp-summary");
    if (!el) return;
    el.style.animation = "tp-fade-out 0.3s ease-out forwards";
    setTimeout(() => el.remove(), 300);
    peakRankIdx = 0; peakWpm = 0; highCombo = 0;
    summaryTriggered = false; prevRankIdx = 0;
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
            </div>
        </div>
    `;
    document.body.appendChild(hud);
    particleContainer = document.createElement("div");
    particleContainer.id = "tp-particles";
    document.body.appendChild(particleContainer);
}

function positionHud() {
    if (!hud) return;
    const rect = getBarRect();
    if (!rect) return;
    hud.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    hud.style.right  = `${window.innerWidth - rect.right + 8}px`;
}

function updateHud() {
    if (!hud) return;
    positionHud();

    const rankIdx = getRankIndex(styleScore);
    const rank    = RANKS[rankIdx];

    if (rankIdx > peakRankIdx) peakRankIdx = rankIdx;
    if (wpm > peakWpm) peakWpm = wpm;
    if (combo > highCombo) highCombo = combo;

    if (rankIdx !== prevRankIdx) { onRankChange(prevRankIdx, rankIdx); prevRankIdx = rankIdx; }
    updateBarGlow(rankIdx);

    hud.dataset.rank = rank.id;
    hud.classList.toggle("tp-visible", styleScore > 0 || honoredOneActive);

    const rankEl  = document.getElementById("tp-rank-letter");
    const fillEl  = document.getElementById("tp-meter-fill");
    const comboEl = document.getElementById("tp-combo-count");
    const wpmEl   = document.getElementById("tp-wpm-val");
    const wpmSep  = hud.querySelector(".tp-wpm-sep") as HTMLElement | null;
    const pkEl    = document.getElementById("tp-peak-val");
    const pkSep   = hud.querySelector(".tp-pk-sep") as HTMLElement | null;

    if (rankEl) { rankEl.textContent = rank.label; rankEl.style.color = rank.color; }

    // ── Honored One override ───────────────────────────────────────────────────
    const isHonoredOne = wpm >= 300;
    if (isHonoredOne && !honoredOneActive) activateHonoredOne();
    else if (!isHonoredOne && honoredOneActive) deactivateHonoredOne();
    if (isHonoredOne) {
        hud.dataset.rank = "honored";
        if (rankEl) {
            rankEl.textContent = "✦";
            rankEl.style.color = "#e8d5ff";
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Meter = within-rank buffer — how much room before dropping a rank
    if (fillEl) {
        const lo  = rank.min;
        const hi  = rankIdx < RANKS.length - 1 ? RANKS[rankIdx + 1].min : 100;
        const pct = hi > lo ? Math.max(0, Math.min(100, (styleScore - lo) / (hi - lo) * 100)) : 100;
        fillEl.style.width      = `${pct}%`;
        fillEl.style.background = rank.color;
        fillEl.style.boxShadow  = rankIdx >= 4 ? `0 0 8px ${rank.color}` : "none";
    }

    if (comboEl) { comboEl.textContent = String(combo); comboEl.style.color = rank.color; }

    if (wpmEl && wpmSep) {
        const show = wpm > 0;
        wpmEl.textContent                      = show ? `${wpm} wpm` : "";
        wpmEl.style.display = wpmSep.style.display = show ? "" : "none";
    }

    if (pkEl && pkSep) {
        const show = peakRankIdx > rankIdx && peakRankIdx > 1;
        pkEl.textContent              = show ? `pk:${RANKS[peakRankIdx].label}` : "";
        pkEl.style.color              = show ? RANKS[peakRankIdx].color : "";
        pkEl.style.display = pkSep.style.display = show ? "" : "none";
    }
}

function destroyHud() {
    hud?.remove(); hud = null;
    particleContainer?.remove(); particleContainer = null;
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function spawnConfetti(x: number, y: number) {
    if (!settings.store.enableConfetti || !particleContainer) return;
    const tier = getRankIndex(styleScore);
    if (tier < 1) return;
    for (let i = 0; i < settings.store.confettiDensity + tier; i++) {
        const p     = document.createElement("div");
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const shape = CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)];
        const size  = 4 + Math.random() * 6;
        const ang   = Math.random() * Math.PI * 2;
        const vel   = 40 + Math.random() * 80;
        const dx    = Math.cos(ang) * vel, dy = Math.sin(ang) * vel - 30;
        const rot   = Math.random() * 360, dur = 600 + Math.random() * 600;
        p.style.cssText = `
            position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;
            background:${color};pointer-events:none;z-index:99999;
            border-radius:${shape === "circle" ? "50%" : shape === "triangle" ? "0" : "2px"};
            ${shape === "triangle" ? "clip-path:polygon(50% 0%,0% 100%,100% 100%);" : ""}
        `;
        particleContainer.appendChild(p);
        const t0 = performance.now();
        const frame = (now: number) => {
            const prog = (now - t0) / dur;
            if (prog >= 1) { p.remove(); return; }
            p.style.left      = `${x + dx * prog}px`;
            p.style.top       = `${y + dy * prog + 100 * prog * prog}px`;
            p.style.transform = `rotate(${rot + 360 * prog}deg)`;
            p.style.opacity   = String(1 - prog * prog);
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }
}

// ── Honored One ───────────────────────────────────────────────────────────────

function activateHonoredOne() {
    if (honoredOneActive) return;
    honoredOneActive = true;

    // Full-screen centered banner — impossible to miss
    const banner = document.createElement("div");
    banner.id = "tp-honored-banner";
    banner.innerHTML = `<span class="tp-honored-title">✦ HONORED ONE ✦</span><span class="tp-honored-sub">300 WPM</span>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 3000);

    // Triple flash cascade
    screenFlash("#9b59b428");
    setTimeout(() => screenFlash("#c77dff14"), 280);
    setTimeout(() => screenFlash("#9b59b41a"), 560);

    // Audio via YouTube iframe — autoplay works in Electron/Vesktop
    const url = settings.store.honoredOneAudioUrl?.trim();
    if (url) {
        const iframe = document.createElement("iframe");
        iframe.id = "tp-honored-audio";
        iframe.allow = "autoplay; encrypted-media";
        iframe.style.cssText = "display:none;position:fixed;width:1px;height:1px;pointer-events:none;top:-99px;";
        const videoId = url.split("/").pop()?.split("?")[0] ?? "";
        const sep = url.includes("?") ? "&" : "?";
        iframe.src = `${url}${sep}autoplay=1&loop=1&playlist=${videoId}`;
        document.body.appendChild(iframe);
        honoredOneIframe = iframe;
    }
}

function deactivateHonoredOne() {
    if (!honoredOneActive) return;
    honoredOneActive = false;
    honoredOneIframe?.remove();
    honoredOneIframe = null;
    document.getElementById("tp-honored-banner")?.remove();
    // Reset bar glow immediately
    const bar = document.querySelector("[class*='channelTextArea']") as HTMLElement | null;
    if (bar) bar.style.boxShadow = "";
}

// ── Screen shake — Web Animations API, throttled ──────────────────────────────
// No JS rAF loop, no forced layout, runs on compositor thread.

function triggerShake() {
    if (!settings.store.enableScreenShake) return;
    const rankIdx = getRankIndex(styleScore);
    if (rankIdx < 2) return;

    const now = Date.now();
    if (now - lastShakeTime < 110) return; // ~9 shakes/s max
    lastShakeTime = now;

    const chat = document.querySelector("[class*='chatContent']") as HTMLElement | null;
    if (!chat) return;

    // Level 0 = B/A, 1 = S, 2 = WILD/DEVIL
    const level = Math.min(rankIdx - 2, 2);
    const scale = settings.store.shakeIntensity / 4;
    const px    = (level + 1) * 3 * scale;
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
    if (combo > 0) hurtStyle(25);
    combo = 0; comboMultiplier = 1;
    updateHud();
}

function incrementCombo() {
    combo++;
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(breakCombo, settings.store.comboTimeoutMs * 1000);
}

function onMessageSent() {
    const now = Date.now();
    if (now - lastMessageTime < 5000) {
        messagesSentInWindow++;
        comboMultiplier = Math.min(messagesSentInWindow + 1, 7);
    } else {
        messagesSentInWindow = 1; comboMultiplier = 1;
    }
    lastMessageTime = now;
    if (!usedBackspace && combo > 3) {
        styleScore = Math.min(100, styleScore + 20);
        showPopup("CLEAN!", "#40c057", true);
    }
    usedBackspace = false;
    wpmTimestamps = []; wpm = 0; combo = 0;
    updateHud();
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target?.closest?.("[role='textbox']")) return;
    if (e.key.length > 1 && !["Backspace", "Delete"].includes(e.key)) return;

    dismissSummary();

    if (e.key === "Backspace" || e.key === "Delete") {
        usedBackspace = true;
        if (combo > 15) showPopup("COMBO BREAKER!", "#72767d");
        hurtStyle(40); // very painful
        breakCombo();
        return;
    }

    recordInterval();
    recordKeystrokeForWpm();
    incrementCombo();
    gainStyle();

    // Spawn confetti at the caret position. Collapsed-range rects can be
    // (0,0,0,0) in some Discord builds — fall back to textbox bounds if so.
    const sel = window.getSelection();
    let cx: number, cy: number;
    if (sel && sel.rangeCount > 0) {
        const cr = sel.getRangeAt(0).getBoundingClientRect();
        if (cr.left !== 0 || cr.top !== 0) {
            cx = cr.right;
            cy = cr.top + cr.height * 0.5;
        } else {
            const fb = target.getBoundingClientRect();
            cx = fb.left + fb.width * (0.3 + Math.random() * 0.4);
            cy = fb.top;
        }
    } else {
        const fb = target.getBoundingClientRect();
        cx = fb.left + fb.width * (0.3 + Math.random() * 0.4);
        cy = fb.top;
    }
    spawnConfetti(cx, cy);
    triggerShake();
    updateHud();

    // Brightness flash — skip during Honored One so CSS animation isn't clobbered
    const rankEl = document.getElementById("tp-rank-letter");
    if (rankEl && !honoredOneActive) {
        rankEl.style.transition = "none";
        rankEl.style.filter     = "brightness(2.2)";
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (rankEl && !honoredOneActive) {
                rankEl.style.transition = "filter 0.18s ease-out";
                rankEl.style.filter = "brightness(1)";
            }
        }));
    }
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
    description: "DMC-inspired style meter — rewards speed and rhythm with confetti, screenshake, and rank-up drama",
    authors: [{ name: "Miku", id: 0n }],
    settings,

    start() {
        const fontLink = document.createElement("link");
        fontLink.id = "tp-font"; fontLink.rel = "stylesheet";
        fontLink.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap";
        document.head.appendChild(fontLink);

        const style = document.createElement("style");
        style.id = "tp-styles"; style.textContent = CSS_TEXT;
        document.head.appendChild(style);

        createHud();
        startDrainLoop();
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("keydown", onKeyDownCapture, false);
        window.addEventListener("resize", positionHud);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keydown", onKeyDownCapture, false);
        window.removeEventListener("resize", positionHud);

        if (comboTimer)    clearTimeout(comboTimer);
        if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
        if (summaryTimeout){ clearTimeout(summaryTimeout); summaryTimeout = null; }

        deactivateHonoredOne();
        honoredOneActive = false;

        const chat = document.querySelector("[class*='chatContent']") as HTMLElement | null;
        if (chat) { chat.getAnimations().forEach(a => a.cancel()); chat.style.transform = ""; }
        const bar = document.querySelector("[class*='channelTextArea']") as HTMLElement | null;
        if (bar) bar.style.boxShadow = "";

        document.getElementById("tp-summary")?.remove();
        document.getElementById("tp-honored-banner")?.remove();
        document.querySelectorAll(".tp-popup,.tp-rankup-flash").forEach(el => el.remove());
        destroyHud();
        document.getElementById("tp-styles")?.remove();
        document.getElementById("tp-font")?.remove();

        combo = 0; comboMultiplier = 1; styleScore = 0; usedBackspace = false;
        keystrokeIntervals = []; wpmTimestamps = []; wpm = 0;
        lastRhythmTime = 0; flowStateCooldown = 0; lastShakeTime = 0;
        messagesSentInWindow = 0; lastMessageTime = 0;
        prevRankIdx = 0; peakRankIdx = 0; peakWpm = 0; highCombo = 0;
        droppedToDTime = 0; summaryTriggered = false;
    },
});

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
#tp-hud {
    position: fixed;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: 'Oswald', 'gg sans', sans-serif;
    pointer-events: none;
    z-index: 9998;
    padding: 8px 14px 8px 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    opacity: 0;
    transform-origin: bottom right;
    transition:
        opacity 0.4s ease,
        transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1),
        background 0.35s ease,
        border-color 0.35s ease,
        box-shadow 0.35s ease;
}
#tp-hud.tp-visible { opacity: 1; }

#tp-hud[data-rank="d"]     { transform: scale(0.70); }
#tp-hud[data-rank="c"]     { transform: scale(0.82); }
#tp-hud[data-rank="b"]     { transform: scale(0.93); }
#tp-hud[data-rank="a"]     { transform: scale(1.04); }
#tp-hud[data-rank="s"]     { transform: scale(1.18); }
#tp-hud[data-rank="wild"]  { transform: scale(1.36); }
#tp-hud[data-rank="devil"] { transform: scale(1.56); }

#tp-hud[data-rank="s"],
#tp-hud[data-rank="wild"],
#tp-hud[data-rank="devil"] {
    background: rgba(0,0,0,0.6);
    border-color: rgba(255,255,255,0.07);
    box-shadow: 0 4px 22px rgba(0,0,0,0.55);
    backdrop-filter: blur(12px);
}

#tp-rank-letter {
    font-family: 'Oswald', sans-serif;
    font-size: 34px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.5px;
    min-width: 52px;
    text-align: center;
    text-transform: uppercase;
    transition: color 0.2s ease, text-shadow 0.3s ease, filter 0.18s ease-out;
}
#tp-hud[data-rank="s"]     #tp-rank-letter { text-shadow: 0 0 12px currentColor; }
#tp-hud[data-rank="wild"]  #tp-rank-letter { text-shadow: 0 0 16px currentColor, 0 0 32px currentColor; }
#tp-hud[data-rank="devil"] #tp-rank-letter {
    text-shadow: 0 0 18px currentColor, 0 0 36px currentColor, 0 0 64px currentColor;
    animation: tp-devil-pulse 0.65s ease-in-out infinite alternate;
}
@keyframes tp-devil-pulse {
    from { filter: brightness(1); }
    to   { filter: brightness(1.75); }
}

#tp-hud-right { display: flex; flex-direction: column; gap: 4px; }

/* Meter = within-rank buffer. Full = just entered rank. Empty = about to drop. */
#tp-meter-track {
    width: 80px;
    height: 4px;
    border-radius: 2px;
    overflow: hidden;
    background: rgba(255,255,255,0.07);
}
#tp-meter-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.12s ease-out, background 0.25s ease, box-shadow 0.25s ease;
}

#tp-hud-stats {
    font-family: 'Oswald', sans-serif;
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 1px;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 3px;
    color: rgba(255,255,255,0.38);
    line-height: 1;
}
#tp-combo-count { font-weight: 600; transition: color 0.2s ease; }
.tp-x   { opacity: 0.35; font-weight: 300; }
.tp-sep { opacity: 0.28; }
#tp-wpm-val  { color: rgba(255,255,255,0.3); }
#tp-peak-val { font-weight: 600; }

/* Screen flash */
@keyframes tp-screen-flash {
    0%   { opacity: 1; }
    100% { opacity: 0; }
}

/* Floating popups */
.tp-popup {
    position: fixed;
    font-family: 'Oswald', sans-serif;
    letter-spacing: 3px;
    text-transform: uppercase;
    pointer-events: none;
    z-index: 9999;
    animation: tp-float-up linear forwards;
}
@keyframes tp-float-up {
    0%   { opacity: 0;   transform: translateY(6px)  scale(0.8); }
    15%  { opacity: 1;   transform: translateY(-10px) scale(1.08); }
    100% { opacity: 0;   transform: translateY(-64px) scale(0.88); }
}

/* Rank-up flash */
.tp-rankup-flash {
    position: fixed;
    font-family: 'Oswald', sans-serif;
    font-size: 66px;
    font-weight: 700;
    letter-spacing: -1px;
    text-transform: uppercase;
    pointer-events: none;
    z-index: 9999;
    animation: tp-rankup-anim 1.0s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}
@keyframes tp-rankup-anim {
    0%   { opacity: 0; transform: scale(0.3)  translateY(16px); }
    28%  { opacity: 1; transform: scale(1.22) translateY(-6px); }
    60%  { opacity: 1; transform: scale(1.0)  translateY(0); }
    100% { opacity: 0; transform: scale(0.84) translateY(-20px); }
}

/* Session summary */
#tp-summary {
    position: fixed;
    font-family: 'Oswald', sans-serif;
    text-align: center;
    pointer-events: none;
    z-index: 9998;
    background: rgba(20,21,24,0.97);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 12px;
    padding: 14px 22px 12px;
    backdrop-filter: blur(16px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    min-width: 136px;
    animation: tp-summary-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.tp-sum-label  { font-size: 9px; font-weight: 400; letter-spacing: 4px; color: #35373d; margin-bottom: 4px; }
.tp-sum-rank   { font-size: 50px; font-weight: 700; line-height: 1; margin-bottom: 8px; }
.tp-sum-stats  { display: flex; justify-content: center; gap: 16px; }
.tp-sum-stats span { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.tp-sum-stats b    { font-size: 18px; font-weight: 600; color: #dcddde; line-height: 1; }
.tp-sum-stats small{ font-size: 8px; font-weight: 400; letter-spacing: 2px; color: #35373d; }

@keyframes tp-summary-in {
    0%   { opacity: 0; transform: translateY(10px) scale(0.91); }
    100% { opacity: 1; transform: translateY(0)    scale(1); }
}
@keyframes tp-fade-out {
    0%   { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(8px); }
}

/* ── Honored One (secret rank: 300 WPM) ────────────────────────────────────── */

/* Full-screen reveal banner */
#tp-honored-banner {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    font-family: 'Oswald', sans-serif;
    pointer-events: none;
    z-index: 99998;
    animation: tp-honored-banner-anim 3s ease-out forwards;
}
.tp-honored-title {
    font-size: 72px;
    font-weight: 700;
    letter-spacing: 14px;
    color: #e8d5ff;
    text-transform: uppercase;
    text-shadow: 0 0 40px #c77dff, 0 0 80px #9b59b6, 0 0 140px #7b2d8b;
}
.tp-honored-sub {
    font-size: 14px;
    font-weight: 300;
    letter-spacing: 10px;
    color: rgba(200,180,255,0.55);
    text-transform: uppercase;
}
@keyframes tp-honored-banner-anim {
    0%   { opacity: 0; transform: translate(-50%, -44%) scale(0.82); }
    12%  { opacity: 1; transform: translate(-50%, -50%) scale(1.04); }
    72%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0); }
    100% { opacity: 0; transform: translate(-50%, -58%) scale(0.96); }
}
#tp-hud[data-rank="honored"] {
    transform: scale(2.0);
    background: rgba(30, 8, 55, 0.92);
    border-color: rgba(200, 150, 255, 0.22);
    box-shadow:
        0 0 0 1px rgba(200,150,255,0.15),
        0 0 48px rgba(155,89,182,0.45),
        0 4px 28px rgba(0,0,0,0.7);
    backdrop-filter: blur(16px);
}
#tp-hud[data-rank="honored"] #tp-rank-letter {
    font-size: 44px;
    letter-spacing: 0;
    animation: tp-honored-pulse 0.75s ease-in-out infinite alternate;
}
@keyframes tp-honored-pulse {
    from { filter: brightness(1.0) hue-rotate(0deg);  text-shadow: 0 0 18px #e8d5ff, 0 0 36px #9b59b6; }
    to   { filter: brightness(2.2) hue-rotate(28deg); text-shadow: 0 0 32px #fff,    0 0 64px #c77dff, 0 0 96px #7b2d8b; }
}
#tp-hud[data-rank="honored"] #tp-meter-fill { background: #c77dff !important; box-shadow: 0 0 12px #c77dff !important; }

#tp-particles {
    position: fixed; top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none; z-index: 99999; overflow: hidden;
}
`;
