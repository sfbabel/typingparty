/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";

// Intercept our audio iframe and force playback from the main process,
// bypassing Chromium's autoplay policy entirely.
// We identify our iframe via the `babeltype=1` query param the renderer appends.
// Uses MutationObserver for reliable detection + polling fallback.

app.on("browser-window-created", (_, win) => {
    win.webContents.on("frame-created", (_, { frame }) => {
        if (!frame) return;
        frame.once("dom-ready", () => {
            try {
                if (!frame.url.includes("babeltype=1")) return;

                // MutationObserver catches the <audio>/<video> the instant SoundCloud
                // (or any widget) creates it — no more missed polls.
                // Polling fallback in case the element exists before the observer attaches.
                frame.executeJavaScript(`
                    (function() {
                        function forcePlay(media) {
                            media.volume = 0.7;
                            media.muted = false;
                            media.play().catch(function() {});
                        }

                        function findAndPlay() {
                            var media = document.querySelector("audio") || document.querySelector("video");
                            if (media) { forcePlay(media); return true; }
                            return false;
                        }

                        // Try immediately
                        if (findAndPlay()) return;

                        // MutationObserver — catches element creation reliably
                        var observer = new MutationObserver(function(mutations) {
                            for (var i = 0; i < mutations.length; i++) {
                                var nodes = mutations[i].addedNodes;
                                for (var j = 0; j < nodes.length; j++) {
                                    var node = nodes[j];
                                    if (node.tagName === "AUDIO" || node.tagName === "VIDEO") {
                                        forcePlay(node);
                                        observer.disconnect();
                                        return;
                                    }
                                    if (node.querySelector) {
                                        var media = node.querySelector("audio") || node.querySelector("video");
                                        if (media) {
                                            forcePlay(media);
                                            observer.disconnect();
                                            return;
                                        }
                                    }
                                }
                            }
                        });
                        observer.observe(document.documentElement, { childList: true, subtree: true });

                        // Polling fallback (40 retries = 12s) in case observer misses it
                        (function tryPlay(retries) {
                            if (findAndPlay()) { observer.disconnect(); return; }
                            if (retries > 0) setTimeout(function() { tryPlay(retries - 1); }, 300);
                            else observer.disconnect(); // give up after 12s
                        })(40);
                    })();
                `).catch(() => {});
            } catch {}
        });
    });
});
