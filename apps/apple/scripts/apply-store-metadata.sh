#!/usr/bin/env bash
# Applies apps/apple/store/store.config.json to one App Store version of
# "Teak: Save Inspirations", verifies every field, and publishes the committed
# screenshots for that platform. apple-release.yml runs it once per platform.
#   bash apps/apple/scripts/apply-store-metadata.sh <app-id> <version-id> <IOS|MAC_OS> <first-platform-version: true|false> [release-notes]
# The first version on a platform can't carry What's New, so it's skipped there.
set -euo pipefail
ASC_APP_ID="${1:?App ID required}"
VERSION_ID="${2:?Version ID required}"
PLATFORM="${3:?Platform required: IOS or MAC_OS}"
FIRST_VERSION="${4:?First-version flag required: true or false}"
RELEASE_NOTES="${5:-}"
RUNNER_TEMP="${RUNNER_TEMP:-$(mktemp -d)}"
GITHUB_STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

config=apps/apple/store/store.config.json
case "$PLATFORM" in
  IOS) screenshot_sets=(iphone ipad) ;;
  MAC_OS) screenshot_sets=(mac) ;;
  *) echo "Unknown platform: $PLATFORM" >&2; exit 1 ;;
esac
if [ "$FIRST_VERSION" != true ] && [ "$FIRST_VERSION" != false ]; then
  echo "First-version flag must be true or false." >&2
  exit 1
fi
locale="$(jq -er '.locale' "$config")"
prefix="$RUNNER_TEMP/apple-$PLATFORM"

# App info (name, subtitle, privacy policy) is shared by every platform on the
# listing. Edit it while it's editable. Once another platform's submission has
# locked it, it must already match the config.
asc apps info list --app "$ASC_APP_ID" --output json > "$prefix-app-infos.json"
editable_infos="$(jq '[.data[] | select((.attributes.state // .attributes.appStoreState) as $state | ["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"] | index($state))]' "$prefix-app-infos.json")"
pending_infos="$(jq '[.data[] | select((.attributes.state // .attributes.appStoreState) as $state | ["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"] | index($state) | not)]' "$prefix-app-infos.json")"
if [ "$(jq 'length' <<< "$editable_infos")" -eq 1 ]; then
  app_info_id="$(jq -r '.[0].id' <<< "$editable_infos")"
  asc localizations update --app "$ASC_APP_ID" --app-info "$app_info_id" --type app-info --locale "$locale" \
    --name "$(jq -er '.appInfo.name' "$config")" \
    --subtitle "$(jq -er '.appInfo.subtitle' "$config")" \
    --privacy-policy-url "$(jq -er '.appInfo.privacyPolicyUrl' "$config")" --output json > /dev/null
  app_info_note="updated"
elif [ "$(jq 'length' <<< "$editable_infos")" -eq 0 ] && [ "$(jq 'length' <<< "$pending_infos")" -eq 1 ]; then
  app_info_id="$(jq -r '.[0].id' <<< "$pending_infos")"
  app_info_note="locked by another platform's review, verified unchanged"
else
  echo "Expected exactly one editable or pending App Info for $ASC_APP_ID." >&2
  exit 1
fi
asc localizations list --app "$ASC_APP_ID" --app-info "$app_info_id" --type app-info --output json > "$prefix-app-info-listing.json"
if ! jq -e --slurpfile config "$config" '[.data[] | select(.attributes.locale == $config[0].locale)][0].attributes as $actual | $config[0].appInfo | to_entries | all(.[]; $actual[.key] == .value)' "$prefix-app-info-listing.json" > /dev/null; then
  echo "App info ($locale) doesn't match $config." >&2
  exit 1
fi

# Version listing. A version created without a source version has no
# localization yet, so add the configured locale first.
asc localizations list --version "$VERSION_ID" --paginate --output json > "$prefix-version-localizations.json"
if ! jq -e --arg locale "$locale" 'any(.data[]; .attributes.locale == $locale)' "$prefix-version-localizations.json" > /dev/null; then
  asc localizations create --version "$VERSION_ID" --locale "$locale" --output json > /dev/null
fi
notes="${RELEASE_NOTES:-$(jq -er '.version.whatsNew' "$config")}"
update_args=(
  localizations update --version "$VERSION_ID" --locale "$locale"
  --description "$(jq -er '.version.description' "$config")"
  --keywords "$(jq -er '.version.keywords' "$config")"
  --promotional-text "$(jq -er '.version.promotionalText' "$config")"
  --support-url "$(jq -er '.version.supportUrl' "$config")"
  --marketing-url "$(jq -er '.version.marketingUrl' "$config")"
)
if [ "$FIRST_VERSION" = false ]; then
  update_args+=(--whats-new "$notes")
fi
asc "${update_args[@]}" --output json > /dev/null
asc localizations list --version "$VERSION_ID" --paginate --output json > "$prefix-version-listing.json"
if ! jq -e --slurpfile config "$config" --arg notes "$notes" --arg first "$FIRST_VERSION" '
  [.data[] | select(.attributes.locale == $config[0].locale)][0].attributes as $actual |
  ($config[0].version | del(.whatsNew)) + (if $first == "true" then {} else {whatsNew: $notes} end) |
  to_entries | all(.[]; $actual[.key] == .value)
' "$prefix-version-listing.json" > /dev/null; then
  echo "Version listing ($locale) doesn't match $config." >&2
  exit 1
fi
echo "- Verified $PLATFORM listing ($locale) from $config; app info $app_info_note" >> "$GITHUB_STEP_SUMMARY"

# Screenshots. An empty folder keeps what App Store Connect already has.
for set_name in "${screenshot_sets[@]}"; do
  directory="apps/apple/store/screenshots/$set_name/$locale"
  shopt -s nullglob
  pngs=("$directory"/*.png)
  shopt -u nullglob
  if [ "${#pngs[@]}" -eq 0 ]; then
    echo "::warning::No $set_name screenshots in $directory yet; keeping the ones App Store Connect already has."
    echo "- $set_name screenshots: skipped, none committed" >> "$GITHUB_STEP_SUMMARY"
    continue
  fi
  bash scripts/store-assets/publish-apple.sh "apple-$set_name" "$VERSION_ID"
done
