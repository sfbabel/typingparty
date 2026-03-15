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
        description: "Audio for Honored One rank — direct .mp3/.ogg/.wav URL plays natively; YouTube embed URLs use iframe. Swap out the default to change the track.",
        default: "https://www.youtube.com/embed/7hkI43oPIxk",
    },
});

// ── Rank config ───────────────────────────────────────────────────────────────

const RANKS = [
    { id: "d",     min: 0,  label: "D",     color: "#4e5058" },
    { id: "c",     min: 12, label: "C",     color: "#72767d" },
    { id: "b",     min: 28, label: "B",     color: "#4d96ff" },
    { id: "a",     min: 46, label: "A",     color: "#40c057" },
    { id: "s",     min: 64, label: "S",     color: "#ffd93d" },
    { id: "wild",  min: 78, label: "WILD",  color: "#ff922b" },
    { id: "devil", min: 90, label: "DEVIL", color: "#ff6b6b" },
] as const;

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
        if (prog >= 1) { p.el.remove(); particles.splice(i, 1); continue; }
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
let messagesSentInWindow = 0;
let lastMessageTime    = 0;
let usedBackspace      = false;

let styleScore  = 0;
let prevRankIdx = 0;
let drainInterval: ReturnType<typeof setInterval> | null = null;

let keystrokeIntervals: number[] = [];
let lastRhythmTime    = 0;
let flowStateCooldown = 0;

let wpmTimestamps: number[] = [];
let wpm = 0;

let peakRankIdx     = 0;
let peakWpm         = 0;
let highCombo       = 0;
let summaryTimeout: ReturnType<typeof setTimeout> | null = null;
let summaryTriggered = false;

let lastShakeTime = 0;

let honoredOneActive    = false;
let honoredOneIframe: HTMLIFrameElement | null = null;
let honoredOneAudio:  HTMLAudioElement  | null = null;

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

function recalcWpm() {
    const now = Date.now();
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

function gainStyle() {
    const speedBonus  = Math.min(wpm / 40, 4);
    const rhythmBonus = getRhythmConsistency() * 4;
    styleScore = Math.min(100, styleScore + 1.5 + speedBonus + rhythmBonus);

    const now = Date.now();
    if (keystrokeIntervals.length >= 6 && getRhythmConsistency() >= 0.75 && now - flowStateCooldown > 10000) {
        flowStateCooldown = now;
        styleScore = Math.min(100, styleScore + 15);
        showPopup("flow state", "#4d96ff");
    }
}

function hurtStyle(amount: number) {
    styleScore = Math.max(0, styleScore - amount);
}

function startDrainLoop() {
    if (drainInterval) return;
    drainInterval = setInterval(() => {
        // Recalculate WPM so it decays naturally when typing stops
        recalcWpm();
        if (honoredOneActive && wpm < 300) deactivateHonoredOne();

        if (styleScore <= 0) {
            if (!summaryTriggered && !summaryTimeout && (peakRankIdx > 1 || highCombo > 5)) {
                summaryTimeout = setTimeout(() => { summaryTimeout = null; showSummary(); }, 3000);
            }
            return;
        }
        const ri   = getRankIndex(styleScore);
        const idle = Date.now() - lastRhythmTime > 2000;
        styleScore = Math.max(0, styleScore - (idle ? IDLE_DRAIN[ri] : ACTIVE_DRAIN[ri]));
        // Reposition HUD here (drain loop = ~10/s) instead of on every keypress
        positionHud();
        updateHud();
    }, 100);
}

// ── Popup (Flow State only) ───────────────────────────────────────────────────

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

// ── Bar glow ──────────────────────────────────────────────────────────────────

function updateBarGlow(rankIdx: number) {
    const bar = getBarEl();
    if (!bar) return;
    bar.style.transition = "box-shadow 0.5s ease";
    if (honoredOneActive)
        bar.style.boxShadow = "0 0 0 1.5px rgba(199,125,255,0.5),0 0 32px rgba(155,89,182,0.22)";
    else if (rankIdx === 6)
        bar.style.boxShadow = "0 0 0 1px rgba(255,107,107,0.35),0 0 20px rgba(255,107,107,0.14)";
    else if (rankIdx === 5)
        bar.style.boxShadow = "0 0 0 1px rgba(255,146,43,0.25),0 0 14px rgba(255,146,43,0.1)";
    else
        bar.style.boxShadow = "";
}

// ── Session summary ───────────────────────────────────────────────────────────

function showSummary() {
    if (summaryTriggered) return;
    summaryTriggered = true;
    const bar = getBarEl();
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const peak = RANKS[peakRankIdx];
    const el = document.createElement("div");
    el.id = "tp-summary";
    el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 8}px;`;
    el.innerHTML = `
        <div class="tp-sum-label">session</div>
        <div class="tp-sum-rank" style="color:${peak.color}">${peak.label}</div>
        <div class="tp-sum-stats">
            <span><b>${highCombo}</b><small>combo</small></span>
            ${peakWpm > 0 ? `<span><b>${peakWpm}</b><small>wpm</small></span>` : ""}
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

    // Cache child refs once — never query them again
    hudRankEl  = hud.querySelector("#tp-rank-letter");
    hudFillEl  = hud.querySelector("#tp-meter-fill");
    hudComboEl = hud.querySelector("#tp-combo-count");
    hudWpmEl   = hud.querySelector("#tp-wpm-val");
    hudWpmSep  = hud.querySelector(".tp-wpm-sep");
    hudPkEl    = hud.querySelector("#tp-peak-val");
    hudPkSep   = hud.querySelector(".tp-pk-sep");

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

function updateHud() {
    if (!hud) return;

    const rankIdx = getRankIndex(styleScore);
    const rank    = RANKS[rankIdx];

    if (rankIdx > peakRankIdx) peakRankIdx = rankIdx;
    if (wpm > peakWpm) peakWpm = wpm;
    if (combo > highCombo) highCombo = combo;

    if (rankIdx !== prevRankIdx) prevRankIdx = rankIdx;
    updateBarGlow(rankIdx);

    const isHonoredOne = wpm >= 300;
    if (isHonoredOne && !honoredOneActive) activateHonoredOne();
    else if (!isHonoredOne && honoredOneActive) deactivateHonoredOne();

    hud.dataset.rank = isHonoredOne ? "honored" : rank.id;
    hud.classList.toggle("tp-visible", styleScore > 0 || honoredOneActive);

    if (hudRankEl) {
        hudRankEl.textContent = isHonoredOne ? "✦" : rank.label;
        hudRankEl.style.color = isHonoredOne ? "#e8d5ff" : rank.color;
    }

    if (hudFillEl) {
        const lo  = rank.min;
        const hi  = rankIdx < RANKS.length - 1 ? RANKS[rankIdx + 1].min : 100;
        const pct = hi > lo ? Math.max(0, Math.min(100, (styleScore - lo) / (hi - lo) * 100)) : 100;
        hudFillEl.style.width      = `${pct}%`;
        hudFillEl.style.background = isHonoredOne ? "#c77dff" : rank.color;
        hudFillEl.style.boxShadow  = rankIdx >= 4 ? `0 0 6px ${rank.color}` : "none";
    }

    if (hudComboEl) { hudComboEl.textContent = String(combo); hudComboEl.style.color = rank.color; }

    if (hudWpmEl && hudWpmSep) {
        const show = wpm > 0;
        hudWpmEl.textContent                         = show ? `${wpm} wpm` : "";
        hudWpmEl.style.display = hudWpmSep.style.display = show ? "" : "none";
    }

    if (hudPkEl && hudPkSep) {
        const show = peakRankIdx > rankIdx && peakRankIdx > 1 && !isHonoredOne;
        hudPkEl.textContent              = show ? `pk:${RANKS[peakRankIdx].label}` : "";
        hudPkEl.style.color              = show ? RANKS[peakRankIdx].color : "";
        hudPkEl.style.display = hudPkSep.style.display = show ? "" : "none";
    }
}

function destroyHud() {
    hud?.remove(); hud = null; particleContainer?.remove(); particleContainer = null;
    hudRankEl = hudFillEl = hudComboEl = hudWpmEl = hudWpmSep = hudPkEl = hudPkSep = null;
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function spawnConfetti(x: number, y: number) {
    if (!settings.store.enableConfetti || !particleContainer) return;
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

// ── Honored One ───────────────────────────────────────────────────────────────

function spawnHonoredIframe(url: string) {
    const iframe = document.createElement("iframe");
    iframe.id = "tp-honored-audio";
    iframe.allow = "autoplay; encrypted-media; fullscreen";
    // Must NOT use display:none — YouTube won't autoplay when hidden that way
    iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:none;pointer-events:none;";
    const videoId = url.split("/").pop()?.split("?")[0] ?? "";
    const sep = url.includes("?") ? "&" : "?";
    iframe.src = `${url}${sep}autoplay=1&loop=1&playlist=${videoId}`;
    document.body.appendChild(iframe);
    honoredOneIframe = iframe;
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

    const isYouTube    = /youtube\.com|youtu\.be/i.test(url);
    const isDirectFile = /\.(mp3|ogg|wav|flac|aac|m4a|opus)(\?|$)/i.test(url);

    if (isDirectFile || !isYouTube) {
        // Native HTML5 Audio — works in Electron without CORS restrictions
        try {
            const audio = new Audio(url);
            audio.loop   = true;
            audio.volume = 0.7;
            audio.play().catch(() => {
                // If browser policy blocks autoplay, fall back to iframe
                spawnHonoredIframe(url);
            });
            honoredOneAudio = audio;
        } catch {
            spawnHonoredIframe(url);
        }
    } else {
        spawnHonoredIframe(url);
    }
}

function deactivateHonoredOne() {
    if (!honoredOneActive) return;
    honoredOneActive = false;
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
    const rankIdx = getRankIndex(styleScore);
    if (rankIdx < 2) return;

    const now = Date.now();
    if (now - lastShakeTime < 110) return;
    lastShakeTime = now;

    const chat = getChatEl();
    if (!chat) return;

    const level = Math.min(rankIdx - 2, 2);
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
    if (combo > 0) hurtStyle(25);
    combo = 0;
    updateHud();
}

function incrementCombo() {
    combo++;
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(breakCombo, settings.store.comboTimeoutMs * 1000);
}

function onMessageSent() {
    const now = Date.now();
    if (now - lastMessageTime < 5000) messagesSentInWindow++;
    else messagesSentInWindow = 1;
    lastMessageTime = now;
    if (!usedBackspace && combo > 3) styleScore = Math.min(100, styleScore + 20);
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
        hurtStyle(40);
        breakCombo();
        return;
    }

    recordInterval();
    recordKeystrokeForWpm();
    incrementCombo();
    gainStyle();

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
    updateHud();
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
        honoredOneActive = false; honoredOneAudio = null; honoredOneIframe = null;

        const chat = getChatEl();
        if (chat) { chat.getAnimations().forEach(a => a.cancel()); chat.style.transform = ""; }
        const bar = getBarEl();
        if (bar) bar.style.boxShadow = "";

        document.getElementById("tp-summary")?.remove();
        document.getElementById("tp-honored-banner")?.remove();
        document.querySelectorAll(".tp-popup").forEach(el => el.remove());
        destroyHud();
        document.getElementById("tp-styles")?.remove();
        document.getElementById("tp-font")?.remove();

        combo = 0; styleScore = 0; usedBackspace = false;
        keystrokeIntervals = []; wpmTimestamps = []; wpm = 0;
        lastRhythmTime = 0; flowStateCooldown = 0; lastShakeTime = 0;
        messagesSentInWindow = 0; lastMessageTime = 0;
        prevRankIdx = 0; peakRankIdx = 0; peakWpm = 0; highCombo = 0;
        summaryTriggered = false; cachedBarEl = null; cachedChatEl = null;
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

#tp-hud[data-rank="d"],
#tp-hud[data-rank="c"] { transform: scale(0.82); }

#tp-hud[data-rank="b"],
#tp-hud[data-rank="a"] { transform: scale(1.0); }

#tp-hud[data-rank="s"],
#tp-hud[data-rank="wild"],
#tp-hud[data-rank="devil"] {
    transform: scale(1.15);
    background: rgba(0,0,0,0.55);
    border-color: rgba(255,255,255,0.06);
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    backdrop-filter: blur(14px);
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
#tp-hud[data-rank="wild"]  #tp-rank-letter { text-shadow: 0 0 14px currentColor, 0 0 28px currentColor; }
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

#tp-particles {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 99999; overflow: hidden;
}
`;
