/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CONFETTI_COLORS, MAX_PARTICLES } from "./constants";

// ── Particle system ──────────────────────────────────────────────────────────
// Single shared rAF loop. Particles use transform:translate() (GPU-composited).

interface Particle {
    el: HTMLDivElement;
    dx: number;
    dy: number;
    rot: number;
    t0: number;
    dur: number;
}

interface SpawnConfig {
    sizeMin: number;
    sizeMax: number;
    velMin: number;
    velMax: number;
    angleMin: number;
    angleMax: number;
    dyOffset: number;
    durMin: number;
    durMax: number;
    roundChance: number;
}

export const CONFETTI_CFG: SpawnConfig = {
    sizeMin: 3, sizeMax: 8,
    velMin: 30, velMax: 90,
    angleMin: 0, angleMax: Math.PI * 2,
    dyOffset: -25,
    durMin: 500, durMax: 1000,
    roundChance: 0.5,
};

export const BURST_CFG: SpawnConfig = {
    sizeMin: 4, sizeMax: 10,
    velMin: 50, velMax: 140,
    angleMin: -Math.PI, angleMax: Math.PI,
    dyOffset: -20,
    durMin: 700, durMax: 1300,
    roundChance: 0.4,
};

const particles: Particle[] = [];
let particleRaf: number | null = null;
let container: HTMLDivElement | null = null;

function tick(now: number) {
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
        p.el.style.opacity = String(ease);
    }
    particleRaf = particles.length > 0 ? requestAnimationFrame(tick) : null;
}

export function initParticles() {
    if (container) return;
    container = document.createElement("div");
    container.id = "bt-particles";
    document.body.appendChild(container);
}

export function destroyParticles() {
    if (particleRaf) { cancelAnimationFrame(particleRaf); particleRaf = null; }
    particles.length = 0;
    container?.remove();
    container = null;
}

export function spawnParticles(x: number, y: number, count: number, cfg: SpawnConfig) {
    if (!container || particles.length >= MAX_PARTICLES) return;
    count = Math.min(count, MAX_PARTICLES - particles.length);
    const now = performance.now();
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
        const el    = document.createElement("div");
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const size  = cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin);
        const ang   = cfg.angleMin + Math.random() * (cfg.angleMax - cfg.angleMin);
        const vel   = cfg.velMin + Math.random() * (cfg.velMax - cfg.velMin);
        const dur   = cfg.durMin + Math.random() * (cfg.durMax - cfg.durMin);
        el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};pointer-events:none;z-index:99999;border-radius:${Math.random() > cfg.roundChance ? "50%" : "2px"};will-change:transform,opacity;`;
        frag.appendChild(el);
        particles.push({
            el,
            dx: Math.cos(ang) * vel,
            dy: Math.sin(ang) * vel + cfg.dyOffset,
            rot: Math.random() * 360,
            t0: now,
            dur,
        });
    }
    container.appendChild(frag);
    if (!particleRaf) particleRaf = requestAnimationFrame(tick);
}

export function hasContainer(): boolean {
    return container !== null;
}
