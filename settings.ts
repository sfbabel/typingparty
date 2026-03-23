/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 sfbabel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    challengeMode: {
        type: OptionType.SELECT,
        description: "What type of typing challenges appear while you type",
        options: [
            { label: "Phrases (short JJK/DMC references)", value: "phrases", default: true },
            { label: "Quotes — Short (≤100 chars, from MonkeyType)", value: "quotes-short" },
            { label: "Quotes — Medium (100–300 chars, from MonkeyType)", value: "quotes-medium" },
            { label: "Quotes — Mixed (short + medium)", value: "quotes-mixed" },
            { label: "Off", value: "off" },
        ],
    },
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
        default: 1,
        stickToMarkers: true,
    },
    confettiDensity: {
        type: OptionType.SLIDER,
        description: "Confetti particles per keystroke",
        markers: [1, 2, 3, 4, 5],
        default: 1,
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
        description: "Audio track for a certain secret — SoundCloud/YouTube URL or direct .mp3/.ogg/.wav link.",
        default: "https://soundcloud.com/dimitar-tasev-789043651/the-honored-one-japanese-ver-satoru-gojo",
    },
});
