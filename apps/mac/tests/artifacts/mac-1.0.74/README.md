# Teak for Mac 1.0.74 local verification

Verified October 3, 2026 with the Apple Development signed Debug app and Safari
extension, both version 1.0.74, against the development backend.

- Created a note and quote through native capture; both appeared in the library.
- Uploaded a JPEG through the native file picker; it appeared as an image card.
- Edited an image title and notes, and favorited it; API reads confirmed the values.
- Deleted the disposable JPEG through native confirmation; it disappeared from the library.
- Recorded a short audio sample and saved it; the API confirmed an audio/mp4 card.
- Saved a new Noguchi biography page through Safari; the popup showed Saved to Teak.
- Opened the existing museum page through Safari; the popup showed Already saved.

The temporary note, duplicate JPEG, and audio sample were moved to Trash after
verification. The curated inspiration cards remain for screenshots. Proof JSON
contains only card metadata; credentials and signed storage URLs are excluded.
The unchanged window captures and final Store images are in
../../../assets/screenshots/.

Repeat with the signed Debug scheme while the canonical local web watch is
running. Test capture, edit, favorite, delete, Safari save, and duplicate save;
confirm mutations through the matching development account/API. Run
bash scripts/test-mac-oauth.sh for deterministic retries, pagination, session,
upload, and concurrent query/mutation regressions.
