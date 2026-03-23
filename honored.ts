/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    HO_RED_BLUE_MS, HO_MURASAKI_MS, HO_CRASH_MS,
    HO_STAGELIGHT_MS, HO_AUDIO_DELAY_MS,
} from "./constants";
import { honored, getBarEl, getChatEl, clearHonoredTimers } from "./state";
import { settings } from "./settings";

// ── Audio helpers ────────────────────────────────────────────────────────────

function buildEmbedUrl(url: string): string | null {
    const isSoundCloud = /soundcloud\.com/i.test(url);
    const isYouTube    = /youtube(-nocookie)?\.com|youtu\.be/i.test(url);

    if (isSoundCloud) {
        return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&hide_related=true&show_comments=false`;
    }
    if (isYouTube) {
        let videoId = "";
        const shortMatch = url.match(/youtu\.be\/([^?&#]+)/);
        const longMatch  = url.match(/[?&]v=([^&#]+)/);
        const embedMatch = url.match(/\/embed\/([^?&#]+)/);
        videoId = shortMatch?.[1] ?? longMatch?.[1] ?? embedMatch?.[1] ?? "";
        if (!videoId) return null;
        return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}`;
    }
    return null;
}

function spawnIframe(embedUrl: string) {
    const iframe = document.createElement("iframe");
    iframe.id = "bt-honored-audio";
    iframe.allow = "autoplay; encrypted-media; fullscreen";
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:none;pointer-events:none;opacity:0;";
    const sep = embedUrl.includes("?") ? "&" : "?";
    iframe.src = `${embedUrl}${sep}babeltype=1`;
    document.body.appendChild(iframe);
    honored.iframe = iframe;
}

// ── Timed visual stages ──────────────────────────────────────────────────────

// ~1:06 — Red and Blue orbs converge toward center
function triggerRedBlue() {
    const sl = document.getElementById("bt-stagelight");
    if (sl) sl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 2000, fill: "forwards" }).onfinish = () => sl.remove();

    const red = document.createElement("div");
    red.id = "bt-orb-red";
    const blue = document.createElement("div");
    blue.id = "bt-orb-blue";
    document.body.appendChild(red);
    document.body.appendChild(blue);
}

// ~1:15.9 — Hollow Purple. Flash + shockwave + kanji + persistent overlay.
function triggerMurasakiFlash() {
    document.getElementById("bt-orb-red")?.remove();
    document.getElementById("bt-orb-blue")?.remove();

    // White flash
    const flash = document.createElement("div");
    flash.id = "bt-murasaki-flash";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);

    // Shockwave ring
    setTimeout(() => {
        if (!honored.active) return;
        const ring = document.createElement("div");
        ring.id = "bt-murasaki-ring";
        document.body.appendChild(ring);
        setTimeout(() => ring.remove(), 1200);
    }, 120);

    // Technique name — 虚式「茈」
    setTimeout(() => {
        if (!honored.active) return;
        const kanji = document.createElement("div");
        kanji.id = "bt-murasaki-kanji";
        kanji.textContent = "虚式「茈」";
        document.body.appendChild(kanji);
        setTimeout(() => kanji.remove(), 3200);
    }, 300);

    // Hard shake on impact
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

    // Persistent purple overlay
    const el = document.createElement("div");
    el.id = "bt-murasaki";
    document.body.appendChild(el);
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
    anim.onfinish = () => { anim.cancel(); el.classList.add("bt-murasaki-breathe"); };
}

// ~1:43 — Fake crash screen. pointer-events:none so you can still type through it.
function triggerFakeCrash() {
    const el = document.createElement("div");
    el.id = "bt-crash";
    document.body.appendChild(el);

    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, fill: "forwards" });
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

// ── Activate / Deactivate ────────────────────────────────────────────────────

export function activateHonoredOne() {
    if (honored.active) return;
    honored.active = true;

    const banner = document.createElement("div");
    banner.id = "bt-honored-banner";
    banner.innerHTML = `<span class="bt-honored-title">✦ honored one ✦</span><span class="bt-honored-sub">300 wpm</span>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 3000);

    const url = settings.store.honoredOneAudioUrl?.trim();
    if (!url) return;

    const isDirectFile = /\.(mp3|ogg|wav|flac|aac|m4a|opus)(\?|$)/i.test(url);
    const embedUrl     = isDirectFile ? null : buildEmbedUrl(url);

    honored.redBlueTimer    = setTimeout(triggerRedBlue,      HO_RED_BLUE_MS);
    honored.purpleTimer     = setTimeout(triggerMurasakiFlash, HO_MURASAKI_MS);
    honored.crashTimer      = setTimeout(triggerFakeCrash,     HO_CRASH_MS);

    honored.stagelightTimer = setTimeout(() => {
        honored.stagelightTimer = null;
        if (!honored.active) return;
        const el = document.createElement("div");
        el.id = "bt-stagelight";
        document.body.appendChild(el);
    }, HO_STAGELIGHT_MS);

    honored.audioTimer = setTimeout(() => {
        honored.audioTimer = null;
        if (!honored.active) return;

        if (isDirectFile || !embedUrl) {
            try {
                const audio = new Audio(url);
                audio.loop   = true;
                audio.volume = 0.7;
                audio.play().catch(() => embedUrl && spawnIframe(embedUrl));
                honored.audio = audio;
            } catch {
                if (embedUrl) spawnIframe(embedUrl);
            }
        } else {
            spawnIframe(embedUrl);
        }
    }, HO_AUDIO_DELAY_MS);
}

const HONORED_DOM_IDS = [
    "bt-murasaki", "bt-murasaki-flash", "bt-murasaki-ring", "bt-murasaki-kanji",
    "bt-crash", "bt-orb-red", "bt-orb-blue", "bt-honored-banner",
];

export function deactivateHonoredOne() {
    if (!honored.active) return;
    honored.active = false;
    clearHonoredTimers();

    for (const id of HONORED_DOM_IDS) document.getElementById(id)?.remove();

    const stagelight = document.getElementById("bt-stagelight");
    if (stagelight) {
        stagelight.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" })
            .onfinish = () => stagelight.remove();
    }

    if (honored.audio) {
        honored.audio.pause();
        honored.audio.src = "";
        honored.audio = null;
    }
    honored.iframe?.remove();
    honored.iframe = null;

    const bar = getBarEl();
    if (bar) bar.style.boxShadow = "";
}
