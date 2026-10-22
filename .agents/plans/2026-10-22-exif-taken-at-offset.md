# Store a photo's EXIF offset

## Goal

When a photo's EXIF records the offset of its capture time (`OffsetTimeOriginal`, tag `0x9011`, for example `+05:30`), the Files Worker stores it as `fileMetadata.exif.takenAtOffset`, in minutes east of UTC. The web, Apple and Android apps then show it after the capture time: "May 17, 2026, 02:30 PM UTC+5:30".

## Facts (as of 2026-10-22)

- `takenAt` is the camera's clock time as epoch ms, read as if that clock were UTC. Every client formats it in UTC (`apps/web/src/lib/exif.ts`, `ExifFacts` in `apps/apple/Packages/TeakKit/Sources/TeakCore/Logic/CardFacts.swift`, `Exif` in `apps/android/core/model/.../Exif.kt`).
- `imageExifValidator` (`packages/convex/schema.ts`) accepts `takenAtOffset`, and all three clients already show it. Only the Files Worker doesn't write it yet.
- It ships in its own PR because the Files Worker deploys before Convex (`.agents/feature-conventions.md`, "Deploys"). A Worker that sends `takenAtOffset` before Convex accepts it fails `updateCardFileMetadata`'s validator, and `analyzeImage` (`apps/files-worker/src/workflows/cardProcessing/renderables.ts`) drops that image's dimensions, EXIF and colors.

## Steps

1. Check that production Convex accepts `takenAtOffset`: the PR that added it to `imageExifValidator` has been deployed by Backend Deploy.
2. In `apps/files-worker/src/images/exif.ts`, read tag `0x9011` from the Exif IFD. When it matches `^[+-]\d{2}:\d{2}$`, add `takenAtOffset` (minutes, negative west of UTC) to `ExifFacts`. Leave `takenAt` as the clock time.
3. Test it in `exif.test.ts`: the fixture's `+05:30` reads `330`, `-08:00` reads `-480`, and a missing or malformed offset leaves the field out.

## Verification

Upload a JPEG whose EXIF has `DateTimeOriginal` and `OffsetTimeOriginal` to the dev deployment once the Worker is deployed. The `card-photo-details` recipe (`.agents/skills/verify-teak/features/card-actions.md`) shows "Taken" with the offset after the time.

Delete this plan in the PR that ships it.
