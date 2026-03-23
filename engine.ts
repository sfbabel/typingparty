/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    RANKS, getRankIndex, WPM_WINDOW_MS, IDLE_THRESHOLD_MS,
    ACTIVE_DRAIN, IDLE_DRAIN, MAX_RANK_SAMPLES, MAX_RHYTHM_SAMPLES,
    MULTIPLIER_MAX, MULTIPLIER_DECAY, COMBO_MILESTONES,
    BACKSPACE_STYLE_COST, BACKSPACE_COMBO_COST, COMBO_TIMEOUT_STYLE_COST,
    FLOW_THRESHOLD, FLOW_COOLDOWN_MS, FLOW_STYLE_BONUS, FLOW_MULTI_BOOST,
    BURST_MIN_INTERVALS, BURST_AVG_THRESHOLD, BURST_COOLDOWN_MS, BURST_MULTI_BOOST,
    SPEED_DEMON_WPM, SPEED_DEMON_SUSTAIN, SPEED_DEMON_COOLDOWN, SPEED_DEMON_BOOST,
    HONORED_ONE_WPM, HONORED_ONE_DROP_WPM, HONORED_PERF_GUARD_WPM,
    CHALLENGE_PROB, CHALLENGE_MIN_RANK, SUMMARY_DELAY_MS,
} from "./constants";
import { settings } from "./settings";
import { game, session, honored, challenge, getBarEl, getChatEl } from "./state";
import { showPopup, updateHud, positionHud, showSummary } from "./hud";
import { spawnParticles, CONFETTI_CFG, BURST_CFG, hasContainer } from "./particles";
import { triggerChallenge } from "./challenge";
import { activateHonoredOne, deactivateHonoredOne } from "./honored";

// ── Rolling WPM ──────────────────────────────────────────────────────────────

function calcWpm() {
    const now = Date.now();
    game.wpmTimestamps = game.wpmTimestamps.filter(t => t >= now - WPM_WINDOW_MS);
    const n = game.wpmTimestamps.length;
    if (n < 2) { game.wpm = 0; return; }
    const elapsed = (now - game.wpmTimestamps[0]) / 60000;
    game.wpm = elapsed < 0.005 ? 0 : Math.round((n / 5) / elapsed);
}

export function recordKeystrokeForWpm() {
    game.wpmTimestamps.push(Date.now());
    calcWpm();
}

// ── Rhythm ───────────────────────────────────────────────────────────────────

export function getRhythmConsistency(): number {
    if (game.keystrokeIntervals.length < 3) return 0;
    const mean = game.keystrokeIntervals.reduce((a, b) => a + b, 0) / game.keystrokeIntervals.length;
    if (!mean) return 0;
    const variance = game.keystrokeIntervals.reduce((s, v) => s + (v - mean) ** 2, 0) / game.keystrokeIntervals.length;
    return Math.max(0, 1 - Math.sqrt(variance) / mean);
}

export function recordInterval() {
    const now = Date.now();
    if (game.lastRhythmTime > 0) {
        const iv = now - game.lastRhythmTime;
        if (iv >= 50 && iv <= 3000) {
            game.keystrokeIntervals.push(iv);
            if (game.keystrokeIntervals.length > MAX_RHYTHM_SAMPLES) game.keystrokeIntervals.shift();
        } else if (iv > 3000) {
            game.keystrokeIntervals = [];
        }
    }
    game.lastRhythmTime = now;
}

// ── Style meter ──────────────────────────────────────────────────────────────

export function gainStyle() {
    const rhythm = getRhythmConsistency();
    const speedBonus  = Math.min(game.wpm / 30, 5);
    const rhythmBonus = rhythm * 4;
    game.styleScore = Math.min(100, game.styleScore + (2.5 + speedBonus + rhythmBonus) * game.multiplier);

    const now = Date.now();
    if (game.keystrokeIntervals.length >= 6 && rhythm >= FLOW_THRESHOLD && now - game.flowStateCooldown > FLOW_COOLDOWN_MS) {
        game.flowStateCooldown = now;
        game.styleScore = Math.min(100, game.styleScore + FLOW_STYLE_BONUS * game.multiplier);
        boostMultiplier(FLOW_MULTI_BOOST, "flow");
    }
}

export function hurtStyle(amount: number) {
    game.styleScore = Math.max(0, game.styleScore - amount);
}

// ── Multiplier ───────────────────────────────────────────────────────────────

export function boostMultiplier(amount: number, label: string) {
    game.multiplier = Math.min(MULTIPLIER_MAX, game.multiplier + amount);
    showPopup(`${label} ${game.multiplier.toFixed(1)}×`, "#ffd93d");
}

// ── Trick detection ──────────────────────────────────────────────────────────

export function detectTricks() {
    const now = Date.now();

    if (game.keystrokeIntervals.length >= BURST_MIN_INTERVALS) {
        const avg = game.keystrokeIntervals.reduce((a, b) => a + b, 0) / game.keystrokeIntervals.length;
        if (avg < BURST_AVG_THRESHOLD && now - game.lastBurstCheck > BURST_COOLDOWN_MS) {
            game.lastBurstCheck = now;
            boostMultiplier(BURST_MULTI_BOOST, "burst");
        }
    }

    if (game.wpm >= SPEED_DEMON_WPM) {
        if (!game.speedDemonStart) game.speedDemonStart = now;
        else if (now - game.speedDemonStart > SPEED_DEMON_SUSTAIN && now - game.lastSpeedDemonTrigger > SPEED_DEMON_COOLDOWN) {
            game.lastSpeedDemonTrigger = now;
            boostMultiplier(SPEED_DEMON_BOOST, "speed demon");
        }
    } else {
        game.speedDemonStart = 0;
    }
}

// ── Combo ────────────────────────────────────────────────────────────────────

function breakCombo() {
    if (game.combo > 0) hurtStyle(COMBO_TIMEOUT_STYLE_COST);
    game.combo = 0;
}

export function incrementCombo() {
    game.combo++;
    if (game.comboTimer) clearTimeout(game.comboTimer);
    game.comboTimer = setTimeout(breakCombo, settings.store.comboTimeoutMs * 1000);

    for (const [threshold, bonus] of COMBO_MILESTONES) {
        if (game.combo === threshold) {
            game.styleScore = Math.min(100, game.styleScore + bonus * game.multiplier);
            const boost = threshold >= 50 ? 0.4 : 0.2;
            boostMultiplier(boost, `${game.combo}×`);
            break;
        }
    }
}

export function softDamage() {
    game.usedBackspace = true;
    hurtStyle(BACKSPACE_STYLE_COST);
    if (game.combo > 0) game.combo = Math.max(0, game.combo - BACKSPACE_COMBO_COST);
    if (game.comboTimer) clearTimeout(game.comboTimer);
    if (game.combo > 0) game.comboTimer = setTimeout(breakCombo, settings.store.comboTimeoutMs * 1000);
}

// ── Send effects ─────────────────────────────────────────────────────────────

function showSendEffect(sendCombo: number, rankIdx: number) {
    const bar = getBarEl();
    if (!bar) return;
    const rect = bar.getBoundingClientRect();

    bar.animate(
        [
            { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
            { boxShadow: "0 0 12px 2px rgba(255,255,255,0.15)" },
            { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
        ],
        { duration: 350, easing: "ease-out" }
    );

    if (hasContainer()) {
        const count = 4 + rankIdx * 2 + (sendCombo >= 20 ? 6 : 0);
        const x = rect.left + rect.width * 0.5 + (Math.random() - 0.5) * rect.width * 0.4;
        const y = rect.top + rect.height * 0.3;
        spawnParticles(x, y, Math.min(count, 20), BURST_CFG);
    }

    const rank = RANKS[Math.max(rankIdx, 1)];
    const label = sendCombo >= 40 ? "flawless" :
                  sendCombo >= 20 ? "perfect" :
                  sendCombo >= 8  ? "clean" : "";
    if (label) showPopup(label, rank.color);

    game.cleanSendStreak++;
    if (game.cleanSendStreak === 3) showPopup("streak", "#40c057");
    else if (game.cleanSendStreak === 5) showPopup("unstoppable", "#ffd93d");
    else if (game.cleanSendStreak === 10) showPopup("legendary", "#ff6b6b");
}

export function onMessageSent() {
    const wasClean  = !game.usedBackspace;
    const sendCombo = game.combo;
    const rankIdx   = getRankIndex(game.styleScore);

    if (wasClean && game.combo > 0) game.styleScore = Math.min(100, game.styleScore + 8 + Math.min(game.combo, 20));

    if (wasClean) showSendEffect(sendCombo, rankIdx);
    else game.cleanSendStreak = 0;

    game.usedBackspace = false;
    game.combo = 0;
}

// ── Screen shake ─────────────────────────────────────────────────────────────

export function triggerShake() {
    if (!settings.store.enableScreenShake) return;
    if (honored.active || game.wpm > HONORED_PERF_GUARD_WPM) return;
    const rankIdx = getRankIndex(game.styleScore);
    if (rankIdx < 2) return;

    const now = Date.now();
    if (now - game.lastShakeTime < 110) return;
    game.lastShakeTime = now;

    const chat = getChatEl();
    if (!chat) return;

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

// ── Confetti ─────────────────────────────────────────────────────────────────

export function spawnConfetti(x: number, y: number) {
    if (!settings.store.enableConfetti) return;
    if (honored.active || game.wpm > HONORED_PERF_GUARD_WPM) return;
    const tier = getRankIndex(game.styleScore);
    if (tier < 1) return;
    const count = Math.min(settings.store.confettiDensity + Math.floor(tier / 2), 6);
    spawnParticles(x, y, count, CONFETTI_CFG);
}

// ── Drain loop ───────────────────────────────────────────────────────────────

let drainInterval: ReturnType<typeof setInterval> | null = null;
let drainTick = 0;

export function startDrainLoop() {
    if (drainInterval) return;
    drainInterval = setInterval(() => {
        calcWpm();
        if (honored.active && game.wpm < HONORED_ONE_DROP_WPM) deactivateHonoredOne();

        if (game.multiplier > 1.0) game.multiplier = Math.max(1.0, game.multiplier - MULTIPLIER_DECAY);

        if (!challenge.active && !honored.active && settings.store.challengeMode !== "off" && Math.random() < CHALLENGE_PROB && getRankIndex(game.styleScore) >= CHALLENGE_MIN_RANK)
            triggerChallenge();

        if (game.styleScore > 0) {
            const ri   = getRankIndex(game.styleScore);
            const idle = Date.now() - game.lastRhythmTime > IDLE_THRESHOLD_MS;
            game.styleScore = Math.max(0, game.styleScore - (idle ? IDLE_DRAIN[ri] : ACTIVE_DRAIN[ri]));
            session.rankSamples.push(ri);
            if (session.rankSamples.length > MAX_RANK_SAMPLES) session.rankSamples.shift();
        } else if (!session.summaryTriggered && !session.summaryTimeout && (session.peakRankIdx > 1 || session.highCombo > 5)) {
            session.summaryTimeout = setTimeout(() => { session.summaryTimeout = null; showSummary(); }, SUMMARY_DELAY_MS);
        }

        if (game.wpm >= HONORED_ONE_WPM && !honored.active) activateHonoredOne();

        if (++drainTick % 5 === 0) positionHud();
        updateHud();
    }, 100);
}

export function stopDrainLoop() {
    if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
    drainTick = 0;
}
