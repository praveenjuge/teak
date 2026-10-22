# Store a photo's camera clock time and EXIF offset

## Goal

The Files Worker stores a photo's capture time as the camera's clock showed it (`fileMetadata.exif.takenAtClock`) and, when the EXIF records one, its offset (`takenAtOffset`, minutes east of UTC). The web, Apple and Android apps then show "May 17, 2026, 02:30 PM UTC+5:30" in every viewer's zone, instead of moving the time with the viewer.

## Facts (as of 2026-10-22)

- `takenAt` keeps its old meaning for released Apple and Android builds, which format it in the device's zone: an instant when the EXIF has an offset (`OffsetTimeOriginal`, tag `0x9011`), else the camera's clock time read as UTC. Changing its meaning would make those builds show a phone photo taken at 14:30 +05:30 as 20:00 in India.
- `imageExifValidator` (`packages/convex/schema.ts`) accepts `takenAtClock` and `takenAtOffset`. The clients (`apps/web/src/lib/exif.ts`, `ExifFacts` in `apps/apple/Packages/TeakKit/Sources/TeakCore/Logic/CardFacts.swift`, `Exif` in `apps/android/core/model/.../Exif.kt`) format `takenAtClock` in UTC with the offset after it, and fall back to their old reading of `takenAt` in the viewer's zone when it's missing. Only the Files Worker doesn't write the new fields yet.
- It ships in its own PR because the Files Worker deploys before Convex (`.agents/feature-conventions.md`, "Deploys"). A Worker that sends the new fields before Convex accepts them fails `updateCardFileMetadata`'s validator, and `analyzeImage` (`apps/files-worker/src/workflows/cardProcessing/renderables.ts`) drops that image's dimensions, EXIF and colors.

## Steps

1. Check that production Convex accepts `takenAtClock` and `takenAtOffset`: the PR that added them to `imageExifValidator` has been deployed by Backend Deploy.
2. In `apps/files-worker/src/images/exif.ts`, keep `takenAt` as it is. Add `takenAtClock`: `DateTimeOriginal` parsed with a `Z` suffix, whatever the offset. When tag `0x9011` matches `^[+-]\d{2}:\d{2}$`, add `takenAtOffset` in minutes (negative west of UTC).
3. Test it in `exif.test.ts`: the fixture (`14:30:05 +05:30`) gives `takenAt` 09:00:05Z, `takenAtClock` 14:30:05Z and `takenAtOffset` 330; `-08:00` gives -480; a missing or malformed offset leaves `takenAtOffset` out and `takenAtClock` unchanged.
4. Photos processed before this have no `takenAtClock` and keep moving with the viewer. Reading their EXIF again (a backfill over image cards with `exif.takenAt`, `packages/convex/migration/`) needs the owner's approval.

## Verification

Upload a JPEG whose EXIF has `DateTimeOriginal` and `OffsetTimeOriginal` to the dev deployment once the Worker is deployed, and one without the offset. The `card-photo-details` recipe (`.agents/skills/verify-teak/features/card-actions.md`) shows "Taken" at the camera's time in Los Angeles and Auckland, with the offset after it when there is one.

Delete this plan in the PR that ships it.
