#!/usr/bin/env bash
set -euo pipefail
ASC_APP_ID="${1:?App ID required}"
VERSION_ID="${2:?Version ID required}"
RELEASE_NOTES="${3:-}"
: "${RUNNER_TEMP:?}" "${GITHUB_STEP_SUMMARY:?}"

config=apps/mac/store.config.json
locale="$(jq -er '.locale' "$config")"
asc apps info list --app "$ASC_APP_ID" --output json > "$RUNNER_TEMP/mac-app-infos.json"
editable_infos="$(jq '[.data[] | select((.attributes.state // .attributes.appStoreState) as $state | ["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"] | index($state))]' "$RUNNER_TEMP/mac-app-infos.json")"
if [ "$(jq 'length' <<< "$editable_infos")" -ne 1 ]; then
  echo "Expected exactly one editable Mac App Info after version promotion." >&2
  exit 1
fi
app_info_id="$(jq -r '.[0].id' <<< "$editable_infos")"
asc localizations update --app "$ASC_APP_ID" --app-info "$app_info_id" --type app-info --locale "$locale" \
  --name "$(jq -er '.appInfo.name' "$config")" \
  --subtitle "$(jq -er '.appInfo.subtitle' "$config")" \
  --privacy-policy-url "$(jq -er '.appInfo.privacyPolicyUrl' "$config")" --output json > /dev/null
asc localizations update --version "$VERSION_ID" --locale "$locale" \
  --description "$(jq -er '.version.description' "$config")" \
  --keywords "$(jq -er '.version.keywords' "$config")" \
  --promotional-text "$(jq -er '.version.promotionalText' "$config")" \
  --support-url "$(jq -er '.version.supportUrl' "$config")" \
  --marketing-url "$(jq -er '.version.marketingUrl' "$config")" --output json > /dev/null
asc localizations list --app "$ASC_APP_ID" --app-info "$app_info_id" --type app-info --output json > "$RUNNER_TEMP/mac-app-info-listing.json"
asc localizations list --version "$VERSION_ID" --paginate --output json > "$RUNNER_TEMP/mac-version-listing.json"
jq -e --slurpfile config "$config" '[.data[] | select(.attributes.locale == $config[0].locale)][0].attributes as $actual | $config[0].appInfo | to_entries | all(.[]; $actual[.key] == .value)' "$RUNNER_TEMP/mac-app-info-listing.json" > /dev/null
jq -e --slurpfile config "$config" --arg notes "${RELEASE_NOTES:-$(jq -er '.version.whatsNew' "$config")}" '[.data[] | select(.attributes.locale == $config[0].locale)][0].attributes as $actual | ($config[0].version + {whatsNew: $notes}) | to_entries | all(.[]; $actual[.key] == .value)' "$RUNNER_TEMP/mac-version-listing.json" > /dev/null
echo "- Verified Teak for Mac listing ($locale) from apps/mac/store.config.json" >> "$GITHUB_STEP_SUMMARY"
bash apps/mac/scripts/publish-store-screenshots.sh "$VERSION_ID"
