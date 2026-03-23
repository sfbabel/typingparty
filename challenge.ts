/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    CHALLENGE_PHRASES, CHALLENGE_COOLDOWN_MS, CHALLENGE_TIMEOUT_MS,
    MULTIPLIER_MAX,
} from "./constants";
import { settings } from "./settings";
import { game, challenge, honored, getBarEl } from "./state";
import { showPopup } from "./hud";
import quotes from "./quotes.json";

// ── Quote selection ──────────────────────────────────────────────────────────

function pickText(): string | null {
    const mode = settings.store.challengeMode;
    if (mode === "off") return null;

    if (mode === "phrases") {
        return CHALLENGE_PHRASES[Math.floor(Math.random() * CHALLENGE_PHRASES.length)];
    }

    let pool: string[];
    if (mode === "quotes-short") pool = quotes.short;
    else if (mode === "quotes-medium") pool = quotes.medium;
    else pool = [...quotes.short, ...quotes.medium]; // mixed

    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ── Timeout scaling ──────────────────────────────────────────────────────────
// Phrases get 10s flat. Quotes scale by length — ~1s per 12 chars, minimum 8s, max 30s.

function getTimeout(text: string): number {
    const mode = settings.store.challengeMode;
    if (mode === "phrases") return CHALLENGE_TIMEOUT_MS;
    return Math.min(30000, Math.max(8000, Math.ceil(text.length / 12) * 1000));
}

// ── Style reward scaling ─────────────────────────────────────────────────────
// Per-char reward is lower for quotes (so total reward scales with length without being OP).
// Completion bonus also scales with length.

function getPerCharReward(): number {
    return settings.store.challengeMode === "phrases" ? 1.5 : 0.5;
}

function getCompletionBonus(text: string): number {
    const base = settings.store.challengeMode === "phrases" ? 12 : 8;
    return base + Math.floor(text.length * 0.3);
}

function getMultiplierBoost(text: string): number {
    if (settings.store.challengeMode === "phrases") return 0.8;
    // Longer quotes = bigger boost, capped at 1.5
    return Math.min(1.5, 0.4 + text.length / 200);
}

// ── Trigger ──────────────────────────────────────────────────────────────────

export function triggerChallenge() {
    if (challenge.active || honored.active) return;
    const now = Date.now();
    if (now - challenge.cooldown < CHALLENGE_COOLDOWN_MS) return;
    challenge.cooldown = now;

    const text = pickText();
    if (!text) return;

    const bar = getBarEl();
    if (!bar) return;

    challenge.phrase = text.toLowerCase();
    challenge.progress = 0;
    challenge.active = true;
    const rect = bar.getBoundingClientRect();
    const timeout = getTimeout(challenge.phrase);

    const isQuote = settings.store.challengeMode !== "phrases";

    challenge.el = document.createElement("div");
    challenge.el.id = "bt-challenge";
    if (isQuote) challenge.el.classList.add("bt-chal-quote");
    challenge.el.style.cssText = `right:${window.innerWidth - rect.right + 8}px;bottom:${window.innerHeight - rect.top + 70}px;`;
    challenge.el.innerHTML = `
        <div class="bt-chal-label">${isQuote ? "type this quote" : "type this"}</div>
        <div class="bt-chal-phrase">
            <span class="bt-chal-done"></span><span class="bt-chal-cursor">${challenge.phrase[0]}</span><span class="bt-chal-remaining">${challenge.phrase.slice(1)}</span>
        </div>
        ${isQuote ? `<div class="bt-chal-progress">0/${challenge.phrase.length}</div>` : ""}
        <div class="bt-chal-timer" style="--bt-chal-dur:${timeout}ms;"></div>
    `;
    document.body.appendChild(challenge.el);

    challenge.timeout = setTimeout(() => dismissChallenge(), timeout);
}

// ── Input checking ───────────────────────────────────────────────────────────

export function checkChallenge(key: string) {
    if (!challenge.active || !challenge.el) return;

    const expected = challenge.phrase[challenge.progress];
    if (key.toLowerCase() === expected) {
        challenge.progress++;
        game.styleScore = Math.min(100, game.styleScore + getPerCharReward() * game.multiplier);

        const done = challenge.el.querySelector(".bt-chal-done") as HTMLElement;
        const cursor = challenge.el.querySelector(".bt-chal-cursor") as HTMLElement;
        const remaining = challenge.el.querySelector(".bt-chal-remaining") as HTMLElement;
        const progress = challenge.el.querySelector(".bt-chal-progress") as HTMLElement;

        if (done) done.textContent = challenge.phrase.slice(0, challenge.progress);
        if (progress) progress.textContent = `${challenge.progress}/${challenge.phrase.length}`;

        if (challenge.progress >= challenge.phrase.length) {
            completeChallenge();
            return;
        }

        if (cursor) cursor.textContent = challenge.phrase[challenge.progress];
        if (remaining) remaining.textContent = challenge.phrase.slice(challenge.progress + 1);
    } else if (key !== " ") {
        // Phrases: wrong key = instant fail
        // Quotes: wrong key = show error flash but don't dismiss (too punishing for long quotes)
        if (settings.store.challengeMode === "phrases") {
            dismissChallenge();
        } else {
            // Flash the cursor red briefly
            const cursor = challenge.el.querySelector(".bt-chal-cursor") as HTMLElement;
            if (cursor) {
                cursor.style.color = "#ff6b6b";
                cursor.style.transition = "color 0.15s";
                setTimeout(() => {
                    if (cursor) { cursor.style.color = "#fff"; cursor.style.transition = ""; }
                }, 200);
            }
            // Small style penalty for typos in quote mode
            game.styleScore = Math.max(0, game.styleScore - 2);
        }
    }
}

// ── Completion ───────────────────────────────────────────────────────────────

function completeChallenge() {
    if (!challenge.active) return;
    challenge.active = false;
    if (challenge.timeout) { clearTimeout(challenge.timeout); challenge.timeout = null; }

    const bonus = getCompletionBonus(challenge.phrase);
    game.styleScore = Math.min(100, game.styleScore + bonus * game.multiplier);
    const boost = getMultiplierBoost(challenge.phrase);
    game.multiplier = Math.min(MULTIPLIER_MAX, game.multiplier + boost);
    showPopup(`challenge ${game.multiplier.toFixed(1)}×`, "#ffd93d");

    if (challenge.el) {
        challenge.el.classList.add("bt-chal-complete");
        setTimeout(() => { challenge.el?.remove(); challenge.el = null; }, 800);
    }
}

// ── Dismissal ────────────────────────────────────────────────────────────────

export function dismissChallenge() {
    if (!challenge.active) return;
    challenge.active = false;
    if (challenge.timeout) { clearTimeout(challenge.timeout); challenge.timeout = null; }

    if (challenge.el) {
        challenge.el.style.animation = "bt-fade-out 0.3s ease-out forwards";
        setTimeout(() => { challenge.el?.remove(); challenge.el = null; }, 300);
    }
}
