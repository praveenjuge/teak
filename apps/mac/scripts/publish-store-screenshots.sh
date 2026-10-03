#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
: "${VERSION_ID:?}" "${RUNNER_TEMP:?}" "${GITHUB_STEP_SUMMARY:?}"

locale="$(jq -er '.locale' apps/mac/store.config.json)"
directory="apps/mac/assets/screenshots/$locale"
# Validate every local asset before replacing an existing App Store set.
asc screenshots validate --path "$directory" --device-type APP_DESKTOP --output json > "$RUNNER_TEMP/mac-screenshot-validation.json"
shopt -s nullglob
files=("$directory"/*.png)
if [ "${#files[@]}" -lt 1 ] || [ "${#files[@]}" -gt 10 ]; then
  echo "Expected 1–10 Mac App Store PNG screenshots." >&2
  exit 1
fi
expected="$RUNNER_TEMP/mac-screenshots-expected.json"
printf '[]' > "$expected"
for file in "${files[@]}"; do
  checksum="$(openssl dgst -md5 "$file" | awk '{print $NF}')"
  jq --arg name "$(basename "$file")" --arg checksum "$checksum" \
    '. + [{fileName: $name, sourceFileChecksum: $checksum}]' "$expected" > "$expected.next"
  mv "$expected.next" "$expected"
done

asc localizations list --version "$VERSION_ID" --paginate --output json > "$RUNNER_TEMP/mac-screenshot-localizations.json"
localization_id="$(jq -er --arg locale "$locale" '[.data[] | select(.attributes.locale == $locale)] | if length == 1 then .[0].id else error("Expected exactly one screenshot localization") end' "$RUNNER_TEMP/mac-screenshot-localizations.json")"
remote="$RUNNER_TEMP/mac-screenshots-remote.json"
list_screenshots() {
  asc screenshots list --version-localization "$localization_id" --output json > "$remote"
}
matches_screenshots() {
  jq -e --slurpfile expected "$expected" '
    [.sets[] | select(.set.attributes.screenshotDisplayType == "APP_DESKTOP")] as $sets |
    ($sets | length) == 1 and
    ([$sets[0].screenshots[] | {fileName: .attributes.fileName, sourceFileChecksum: .attributes.sourceFileChecksum}] == $expected[0]) and
    all($sets[0].screenshots[]; .attributes.assetDeliveryState.state == "COMPLETE")
  ' "$remote" > /dev/null
}
list_screenshots
if matches_screenshots; then
  echo "Mac screenshots already match the committed set."
else
  asc screenshots upload --version-localization "$localization_id" --path "$directory" \
    --device-type APP_DESKTOP --replace --confirm --output json > "$RUNNER_TEMP/mac-screenshot-upload.json"
  verified=false
  for attempt in $(seq 1 30); do
    list_screenshots
    if matches_screenshots; then verified=true; break; fi
    if jq -e 'any(.sets[] | select(.set.attributes.screenshotDisplayType == "APP_DESKTOP") | .screenshots[]; .attributes.assetDeliveryState.state == "FAILED")' "$remote" > /dev/null; then
      echo "Apple rejected a Mac screenshot asset." >&2
      exit 1
    fi
    if [ "$attempt" -lt 30 ]; then sleep 10; fi
  done
  if [ "$verified" != true ]; then
    echo "Mac screenshots did not reach COMPLETE with the exact committed count, order, and checksums." >&2
    exit 1
  fi
fi
echo "- Verified ${#files[@]} Mac screenshots ($locale): COMPLETE, ordered, checksum matched" >> "$GITHUB_STEP_SUMMARY"
