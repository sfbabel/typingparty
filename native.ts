/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";

// Intercept our audio iframe and force playback from the main process,
// bypassing Chromium's autoplay policy entirely.
// We identify our iframe via the `typingparty=1` query param the renderer appends.
// Supports both <video> (YouTube) and <audio> (SoundCloud widget) elements.

app.on("browser-window-created", (_, win) => {
    win.webContents.on("frame-created", (_, { frame }) => {
        if (!frame) return;
        frame.once("dom-ready", () => {
            try {
                if (!frame.url.includes("typingparty=1")) return;

                // Poll for the media element — both YouTube (<video>) and
                // SoundCloud (<audio>) are handled. The player initialises async.
                frame.executeJavaScript(`
                    (function tryPlay(retries) {
                        var media = document.querySelector("audio") || document.querySelector("video");
                        if (media) {
                            media.volume = 0.7;
                            media.muted = false;
                            media.play().catch(function() {});
                            return;
                        }
                        if (retries > 0) setTimeout(function() { tryPlay(retries - 1); }, 300);
                    })(20);
                `).catch(() => {});
            } catch {}
        });
    });
});
