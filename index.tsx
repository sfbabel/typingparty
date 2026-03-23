/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import managedStyle from "./styles.css?managed";

import { settings } from "./settings";
import { game, challenge, resetGameState, resetSession, resetHonored, clearCachedEls, getChatEl } from "./state";
import { createHud, positionHud, destroyHud, dismissSummary, clearPopups, clearBarGlow } from "./hud";
import { initParticles, destroyParticles } from "./particles";
import { checkChallenge, dismissChallenge } from "./challenge";
import { deactivateHonoredOne } from "./honored";
import {
    recordInterval, recordKeystrokeForWpm, incrementCombo,
    gainStyle, detectTricks, softDamage, onMessageSent,
    spawnConfetti, triggerShake, startDrainLoop, stopDrainLoop,
} from "./engine";

// ── Event handlers ───────────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target?.closest?.("[role='textbox']")) return;
    if (e.key.length > 1 && !["Backspace", "Delete"].includes(e.key)) return;

    dismissSummary();

    if (challenge.active && e.key.length === 1) checkChallenge(e.key);

    if (e.key === "Backspace" || e.key === "Delete") {
        softDamage();
        return;
    }

    recordInterval();
    recordKeystrokeForWpm();
    incrementCombo();
    gainStyle();
    detectTricks();

    // Confetti at caret position
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

// ── Plugin definition ────────────────────────────────────────────────────────

export default definePlugin({
    name: "babeltype",
    description: "DMC-inspired style meter — rewards speed and rhythm with confetti, screenshake, and rank-up drama. github.com/sfbabel/babeltype",
    authors: [{ name: "sfbabel", id: 0n }],
    settings,
    managedStyle,

    start() {
        const fontLink = document.createElement("link");
        fontLink.id = "bt-font";
        fontLink.rel = "stylesheet";
        fontLink.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap";
        document.head.appendChild(fontLink);

        createHud();
        initParticles();
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

        if (game.comboTimer) clearTimeout(game.comboTimer);
        stopDrainLoop();
        deactivateHonoredOne();
        resetHonored();

        const chat = getChatEl();
        if (chat) { chat.getAnimations().forEach(a => a.cancel()); chat.style.transform = ""; }
        clearBarGlow();

        dismissChallenge();
        document.getElementById("bt-summary")?.remove();
        document.getElementById("bt-honored-banner")?.remove();
        document.getElementById("bt-stagelight")?.remove();
        clearPopups();
        destroyHud();
        destroyParticles();
        document.getElementById("bt-font")?.remove();

        resetGameState();
        resetSession();
        clearCachedEls();
    },
});
