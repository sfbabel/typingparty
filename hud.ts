/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RANKS, getRankIndex, POPUP_MAX, POPUP_DURATION_MS, MULTIPLIER_MAX } from "./constants";
import { game, session, honored, getBarEl } from "./state";

// ── DOM refs ─────────────────────────────────────────────────────────────────

let hud: HTMLDivElement | null = null;
let hudRankEl:   HTMLElement | null = null;
let hudFillEl:   HTMLElement | null = null;
let hudComboEl:  HTMLElement | null = null;
let hudWpmEl:    HTMLElement | null = null;
let hudWpmSep:   HTMLElement | null = null;
let hudPkEl:     HTMLElement | null = null;
let hudPkSep:    HTMLElement | null = null;
let hudMultiEl:  HTMLElement | null = null;
let hudMultiSep: HTMLElement | null = null;

// ── Dirty-check cache ────────────────────────────────────────────────────────

const dc = {
    dataRank: "", visible: false, rankText: "", rankColor: "",
    fillPct: -1, fillBg: "", fillShadow: "",
    combo: "", comboColor: "", wpm: "", wpmShow: true,
    pk: "", pkColor: "", pkShow: true, multi: "", multiShow: true,
};

export function resetDirtyCache() {
    dc.dataRank = ""; dc.visible = false; dc.rankText = ""; dc.rankColor = "";
    dc.fillPct = -1; dc.fillBg = ""; dc.fillShadow = "";
    dc.combo = ""; dc.comboColor = ""; dc.wpm = ""; dc.wpmShow = true;
    dc.pk = ""; dc.pkColor = ""; dc.pkShow = true; dc.multi = ""; dc.multiShow = true;
}

// ── Popup system ─────────────────────────────────────────────────────────────

const activePopups: HTMLDivElement[] = [];

export function showPopup(text: string, color: string) {
    if (activePopups.length >= POPUP_MAX) activePopups.shift()?.remove();
    const bar = getBarEl();
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "bt-popup";
    el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 52}px;color:${color};text-shadow:0 0 12px ${color}80;`;
    el.textContent = text;
    document.body.appendChild(el);
    activePopups.push(el);
    setTimeout(() => {
        el.remove();
        const idx = activePopups.indexOf(el);
        if (idx >= 0) activePopups.splice(idx, 1);
    }, POPUP_DURATION_MS);
}

export function clearPopups() {
    activePopups.forEach(el => el.remove());
    activePopups.length = 0;
}

// ── Bar glow ─────────────────────────────────────────────────────────────────

let lastBarShadow = "";

export function updateBarGlow(rankIdx: number) {
    const bar = getBarEl();
    if (!bar) return;
    const shadow = honored.active
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

export function clearBarGlow() {
    const bar = getBarEl();
    if (bar) bar.style.boxShadow = "";
    lastBarShadow = "";
}

// ── HUD lifecycle ────────────────────────────────────────────────────────────

export function createHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "bt-hud";
    hud.innerHTML = `
        <div id="bt-rank-letter">D</div>
        <div id="bt-hud-right">
            <div id="bt-meter-track"><div id="bt-meter-fill"></div></div>
            <div id="bt-hud-stats">
                <span id="bt-combo-count">0</span><span class="bt-x">×</span>
                <span class="bt-sep bt-wpm-sep">·</span>
                <span id="bt-wpm-val"></span>
                <span class="bt-sep bt-pk-sep">·</span>
                <span id="bt-peak-val"></span>
                <span class="bt-sep bt-multi-sep">·</span>
                <span id="bt-multi-val"></span>
            </div>
        </div>
    `;
    document.body.appendChild(hud);

    hudRankEl  = hud.querySelector("#bt-rank-letter");
    hudFillEl  = hud.querySelector("#bt-meter-fill");
    hudComboEl = hud.querySelector("#bt-combo-count");
    hudWpmEl   = hud.querySelector("#bt-wpm-val");
    hudWpmSep  = hud.querySelector(".bt-wpm-sep");
    hudPkEl    = hud.querySelector("#bt-peak-val");
    hudPkSep   = hud.querySelector(".bt-pk-sep");
    hudMultiEl  = hud.querySelector("#bt-multi-val");
    hudMultiSep = hud.querySelector(".bt-multi-sep");
}

export function destroyHud() {
    hud?.remove(); hud = null;
    hudRankEl = hudFillEl = hudComboEl = hudWpmEl = hudWpmSep = hudPkEl = hudPkSep = hudMultiEl = hudMultiSep = null;
    resetDirtyCache();
}

export function positionHud() {
    if (!hud) return;
    const bar = getBarEl();
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    hud.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    hud.style.right  = `${window.innerWidth - rect.right + 8}px`;
}

// ── HUD update (10Hz from drain loop) ────────────────────────────────────────

export function updateHud() {
    if (!hud) return;

    const rankIdx = getRankIndex(game.styleScore);
    const rank    = RANKS[rankIdx];

    if (rankIdx > session.peakRankIdx) session.peakRankIdx = rankIdx;
    if (game.wpm > session.peakWpm) session.peakWpm = game.wpm;
    if (game.combo > session.highCombo) session.highCombo = game.combo;

    if (rankIdx !== game.prevRankIdx) {
        if (rankIdx > game.prevRankIdx && rankIdx >= 2) {
            showPopup(RANKS[rankIdx].label, RANKS[rankIdx].color);
            game.multiplier = Math.min(MULTIPLIER_MAX, game.multiplier + 0.3);
            showPopup(`rank up ${game.multiplier.toFixed(1)}×`, "#ffd93d");
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
        game.prevRankIdx = rankIdx;
    }
    updateBarGlow(rankIdx);

    // --- Dirty-checked DOM writes ---
    const dr = honored.active ? "honored" : rank.id;
    if (dr !== dc.dataRank) { hud.dataset.rank = dr; dc.dataRank = dr; }

    const shouldShow = game.styleScore > 0 || honored.active;
    if (shouldShow && !session.hudShown) {
        session.hudShown = true;
        hud.classList.add("bt-visible", "bt-hud-enter");
        setTimeout(() => hud?.classList.remove("bt-hud-enter"), 500);
        dc.visible = true;
    } else if (shouldShow !== dc.visible) {
        hud.classList.toggle("bt-visible", shouldShow);
        dc.visible = shouldShow;
    }

    if (hudRankEl) {
        const rt = honored.active ? "✦" : rank.label;
        const rc = honored.active ? "#e8d5ff" : rank.color;
        if (rt !== dc.rankText) { hudRankEl.textContent = rt; dc.rankText = rt; }
        if (rc !== dc.rankColor) { hudRankEl.style.color = rc; dc.rankColor = rc; }
    }

    if (hudFillEl) {
        const lo  = rank.min;
        const hi  = rankIdx < RANKS.length - 1 ? RANKS[rankIdx + 1].min : 100;
        const pct = hi > lo ? Math.round(Math.max(0, Math.min(100, (game.styleScore - lo) / (hi - lo) * 100))) : 100;
        const bg  = honored.active ? "#c77dff" : rank.color;
        const sh  = pct >= 90 || rankIdx >= 4 ? `0 0 6px ${rank.color}` : "none";
        if (pct !== dc.fillPct) { hudFillEl.style.width = `${pct}%`; dc.fillPct = pct; }
        if (bg !== dc.fillBg) { hudFillEl.style.background = bg; dc.fillBg = bg; }
        if (sh !== dc.fillShadow) { hudFillEl.style.boxShadow = sh; dc.fillShadow = sh; }
    }

    if (hudComboEl) {
        const ct = String(game.combo);
        if (ct !== dc.combo) { hudComboEl.textContent = ct; dc.combo = ct; }
        if (rank.color !== dc.comboColor) { hudComboEl.style.color = rank.color; dc.comboColor = rank.color; }
    }

    if (hudWpmEl && hudWpmSep) {
        const show = game.wpm > 0;
        const wt = show ? `${game.wpm} wpm` : "";
        if (wt !== dc.wpm) { hudWpmEl.textContent = wt; dc.wpm = wt; }
        if (show !== dc.wpmShow) { hudWpmEl.style.display = hudWpmSep.style.display = show ? "" : "none"; dc.wpmShow = show; }
    }

    if (hudPkEl && hudPkSep) {
        const show = session.peakRankIdx > rankIdx && session.peakRankIdx > 1 && !honored.active;
        const pt = show ? `pk:${RANKS[session.peakRankIdx].label}` : "";
        const pc = show ? RANKS[session.peakRankIdx].color : "";
        if (pt !== dc.pk) { hudPkEl.textContent = pt; dc.pk = pt; }
        if (pc !== dc.pkColor) { hudPkEl.style.color = pc; dc.pkColor = pc; }
        if (show !== dc.pkShow) { hudPkEl.style.display = hudPkSep.style.display = show ? "" : "none"; dc.pkShow = show; }
    }

    if (hudMultiEl && hudMultiSep) {
        const show = game.multiplier > 1.05;
        const mt = show ? `${game.multiplier.toFixed(1)}×` : "";
        if (mt !== dc.multi) { hudMultiEl.textContent = mt; dc.multi = mt; }
        if (show !== dc.multiShow) { hudMultiEl.style.display = hudMultiSep.style.display = show ? "" : "none"; dc.multiShow = show; }
    }
}

// ── Session summary ──────────────────────────────────────────────────────────

function getModalRankIdx(): number {
    if (session.rankSamples.length === 0) return session.peakRankIdx;
    const counts = new Array(RANKS.length).fill(0) as number[];
    for (const r of session.rankSamples) counts[r]++;
    return counts.reduce((best, c, i) => c > counts[best] ? i : best, 0);
}

export function showSummary() {
    if (session.summaryTriggered) return;
    session.summaryTriggered = true;
    const bar = getBarEl();
    if (!bar) return;
    const rect     = bar.getBoundingClientRect();
    const modalIdx = getModalRankIdx();
    const modal    = RANKS[modalIdx];
    const peak     = RANKS[session.peakRankIdx];
    const showPk   = session.peakRankIdx > modalIdx && session.peakRankIdx > 1;
    const el = document.createElement("div");
    el.id = "bt-summary";
    el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 8}px;`;
    el.innerHTML = `
        <div class="bt-sum-label">session</div>
        <div class="bt-sum-rank" style="color:${modal.color}">${modal.label}</div>
        <div class="bt-sum-stats">
            <span><b>${session.highCombo}</b><small>combo</small></span>
            ${session.peakWpm > 0 ? `<span><b>${session.peakWpm}</b><small>wpm</small></span>` : ""}
            ${showPk ? `<span><b style="color:${peak.color}">${peak.label}</b><small>peak</small></span>` : ""}
        </div>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = "bt-fade-out 0.5s ease-out forwards";
        setTimeout(() => { el.remove(); fullReset(); }, 500);
    }, 5000);
}

export function dismissSummary() {
    if (session.summaryTimeout) { clearTimeout(session.summaryTimeout); session.summaryTimeout = null; }
    const el = document.getElementById("bt-summary");
    if (!el) return;
    el.style.animation = "bt-fade-out 0.3s ease-out forwards";
    setTimeout(() => el.remove(), 300);
    fullReset();
}

function fullReset() {
    session.peakRankIdx = 0; session.peakWpm = 0; session.highCombo = 0;
    session.rankSamples = []; session.summaryTriggered = false;
    game.prevRankIdx = 0; game.cleanSendStreak = 0; session.hudShown = false;
    resetDirtyCache();
}
