# Native library Mac run — 1.0.72

Date: 23 September 2026. Signed Debug build on macOS 26, local web app
(`localhost:3000`) and local Convex deployment. Account:
`e2e-test@teakvault.local`.

| Journey | Result | Evidence |
| --- | --- | --- |
| Signed-out launch shows onboarding; sign-in opens the library | Pass | [Onboarding](onboarding.png), [library](post-onboarding-library.png) |
| Default 1120 × 760 window and masonry grid render seeded text, link, image, video, audio, document, palette, and quote cards | Pass | [Grid](library-grid-wide.png) |
| Search focus expands type and Favorites controls | Pass | [Expanded search](search-expanded.png) |
| Text search and Palette + Quote filters reduce the grid to both matching types | Pass | [Combined filters](combined-filters.png) |
| Card opens native detail sheet with notes, summary, tags, dates, and Copy | Pass | [Quote sheet](quote-sheet.png) |
| All eight type filters open their native card sheets | Pass | Mac accessibility run; text, link, image, video, audio, document, palette, and quote each opened with Copy and Done |
| A palette with saved colors shows five labeled swatches and per-color Copy | Pass | [Palette sheet](palette-sheet.png) |
| A 98-card library scrolls through paginated results; closing a card preserves the bottom grid position | Pass | [Bottom of library](large-library-bottom.png); Mac scroll-bar position remained `1` before and after the sheet |
| Save Link adds `https://www.apple.com/swift/` to the same local account | Pass | REST list returned the saved link, ID `j978k2s0eac7wbbgb1y3sgwcr18ez5t7` |
| Relaunch keeps the session and opens the library | Pass | [Library after relaunch](post-onboarding-library.png) |
| Safari capture saves `https://example.com/`; repeat reports Already saved | Pass | [Safari duplicate](safari-duplicate.png); REST list returned ID `j979829k39mafwfe1n0j77bqj18ey32q` |
| Repeated `type` with text search and `limit=1` returns Quote then Palette across two server pages | Pass | Local REST check, `hasMore` true then false |

Media-type cards in this local run used text-only samples. Their fallback tiles
and read-only sheets rendered; real file playback, PDF rendering, and download
were verified by build and code review but not exercised with uploaded local
files. The local files worker points at a production R2 bucket, so no test
media was uploaded. The 98-card pass checked page loading and scroll position;
it was not an FPS benchmark.
