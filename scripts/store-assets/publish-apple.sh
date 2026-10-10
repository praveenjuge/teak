#!/usr/bin/env bash
# Replaces one App Store version's screenshot set with the committed images and
# waits until Apple holds exactly those files, in order, by checksum.
#   bash scripts/store-assets/publish-apple.sh <mac|iphone> <version-id>
# The Mac release workflow runs it for every release; run it by hand for iPhone.
set -euo pipefail
export LC_ALL=C
PLATFORM="${1:?Platform required: mac or iphone}"
VERSION_ID="${2:?Version ID required}"
RUNNER_TEMP="${RUNNER_TEMP:-$(mktemp -d)}"
GITHUB_STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

case "$PLATFORM" in
  mac)
    locale="$(jq -er '.locale' apps/mac/store.config.json)"
    directory="apps/mac/assets/screenshots/$locale"
    device_type=APP_DESKTOP
    names="$(jq -er '.screenshots[]' apps/mac/store.config.json)"
    label=Mac ;;
  iphone)
    locale=en-US
    device_type=APP_IPHONE_67
    directory="apps/mobile/store/apple/screenshot/$locale/$device_type"
    names="$(jq -er --arg locale "$locale" --arg type "$device_type" '.apple.info[$locale].screenshots[$type][] | split("/") | last' apps/mobile/store.config.json)"
    label=iPhone ;;
  *) echo "Unknown platform: $PLATFORM" >&2; exit 1 ;;
esac
prefix="$RUNNER_TEMP/$PLATFORM-screenshot"

# Validate every local asset before replacing an existing App Store set.
asc screenshots validate --path "$directory" --device-type "$device_type" --output json > "$prefix-validation.json"
# The store config names the exact set, in order; a missing or extra file
# must never replace a complete App Store set.
expected_names=()
while IFS= read -r name; do expected_names+=("$name"); done <<< "$names"
shopt -s nullglob
local_list=""
for file in "$directory"/*.png; do local_list="$local_list $(basename "$file")"; done
if [ "${#expected_names[@]}" -lt 1 ] || [ "${#expected_names[@]}" -gt 10 ]; then
  echo "Expected 1–10 $label App Store PNG screenshots." >&2
  exit 1
fi
if [ "${local_list# }" != "${expected_names[*]}" ]; then
  echo "$label screenshots in $directory don't match the store config: expected ${expected_names[*]}, found ${local_list:- none}." >&2
  exit 1
fi
expected="$prefix-expected.json"
printf '[]' > "$expected"
for name in "${expected_names[@]}"; do
  file="$directory/$name"
  checksum="$(openssl dgst -md5 "$file")"
  checksum="${checksum##* }"
  jq --arg name "$(basename "$file")" --arg checksum "$checksum" \
    '. + [{fileName: $name, sourceFileChecksum: $checksum}]' "$expected" > "$expected.next"
  mv "$expected.next" "$expected"
done

asc localizations list --version "$VERSION_ID" --paginate --output json > "$prefix-localizations.json"
localization_id="$(jq -er --arg locale "$locale" '[.data[] | select(.attributes.locale == $locale)] | if length == 1 then .[0].id else error("Expected exactly one screenshot localization") end' "$prefix-localizations.json")"
remote="$prefix-remote.json"
list_screenshots() {
  asc screenshots list --version-localization "$localization_id" --output json > "$remote"
}
matches_screenshots() {
  jq -e --arg type "$device_type" --slurpfile expected "$expected" '
    [.sets[] | select(.set.attributes.screenshotDisplayType == $type)] as $sets |
    ($sets | length) == 1 and
    ([$sets[0].screenshots[] | {fileName: .attributes.fileName, sourceFileChecksum: .attributes.sourceFileChecksum}] == $expected[0]) and
    all($sets[0].screenshots[]; .attributes.assetDeliveryState.state == "COMPLETE")
  ' "$remote" > /dev/null
}
list_screenshots
if matches_screenshots; then
  echo "$label screenshots already match the committed set."
else
  asc screenshots upload --version-localization "$localization_id" --path "$directory" \
    --device-type "$device_type" --replace --confirm --output json > "$prefix-upload.json"
  verified=false
  for attempt in $(seq 1 30); do
    list_screenshots
    if matches_screenshots; then verified=true; break; fi
    if jq -e --arg type "$device_type" 'any(.sets[] | select(.set.attributes.screenshotDisplayType == $type) | .screenshots[]; .attributes.assetDeliveryState.state == "FAILED")' "$remote" > /dev/null; then
      echo "Apple rejected a $label screenshot asset." >&2
      exit 1
    fi
    if [ "$attempt" -lt 30 ]; then sleep 10; fi
  done
  if [ "$verified" != true ]; then
    echo "$label screenshots did not reach COMPLETE with the exact committed count, order, and checksums." >&2
    exit 1
  fi
fi
echo "- Verified ${#expected_names[@]} $label screenshots ($locale): COMPLETE, ordered, checksum matched" >> "$GITHUB_STEP_SUMMARY"
