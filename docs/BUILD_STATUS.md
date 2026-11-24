# REMORSE build status

Work started from `6cf4757035cfcbe755537a174002418a28bc3ad1` in `~/Developer/remorse-chess` on 2026-11-24 (Europe/Moscow). The PDF extracted with PDFKit agrees with the supplied transcript and its SHA-256 matches the preparation record.

| Stage | Status |
|---|---|
| Rules, source decisions and fixtures | Implemented and tested. |
| Ten bot profiles and Worker | Implemented. Verified fixed-budget and real browser searches, plus bounded color-swapped self-play. |
| WebGL, motion, asset licensing and 2D | Implemented. Reviewed Chrome and WebKit viewport captures plus a short motion recording. Production context-loss and asset recovery tests passed. |
| Session, local Elo, history, saves and replay | Implemented. Browser runs covered a genuine mate, repetition and resignation, including two simultaneous tabs and practice save/import/undo. |
| Nine RU/EN tutorial lessons | Implemented and completed through real controls in both languages. Verified continuing with standard RNG and real level 4 AI, plus canceling and confirming clean setup. |
| Delivery | Final integrated pass complete. Production binds to loopback and Wi-Fi. The game has separate source and delivery commits on main. |

The playfield centers the marble game board with ivory, obsidian and bronze materials. The responsive app uses Cormorant Garamond with Manrope, stacked capture ledgers on both ends and a collapsible phone sheet. Visual iterations corrected parity and bishop geometry, improved camera fit and lighting, then sharpened the low-quality canvas and expanded mobile hit areas.

Final checks passed: clean install, TypeScript, ESLint, 94 unit tests, production build and 28 Chromium/WebKit tests. See [validation](VALIDATION.md) for actual results, scene measurements and the tested implementation commit. The paired iPhone was unavailable over Xcode, so mobile evidence is from touchscreen viewports in browser automation. If work resumes, recheck the current Wi-Fi address and preview listeners before sharing the links.
