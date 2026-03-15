/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";

// Intercept our YouTube iframe frame and force audio playback from the main process,
// bypassing Chromium's autoplay policy. We identify our iframe via the `typingparty=1`
// query parameter that the renderer appends to the embed URL.

app.on("browser-window-created", (_, win) => {
    win.webContents.on("frame-created", (_, { frame }) => {
        if (!frame) return;
        frame.once("dom-ready", () => {
            try {
                if (!frame.url.includes("typingparty=1")) return;

                // Poll for the video element — YouTube's player initialises asynchronously
                frame.executeJavaScript(`
                    (function tryPlay(retries) {
                        const v = document.querySelector("video");
                        if (v) {
                            v.volume = 0.7;
                            v.muted = false;
                            v.play().catch(function() {});
                        } else if (retries > 0) {
                            setTimeout(function() { tryPlay(retries - 1); }, 300);
                        }
                    })(15);
                `).catch(() => {});
            } catch {}
        });
    });
});
