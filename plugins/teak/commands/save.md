---
description: Save a link, note or quote to Teak
argument-hint: <url or text> [#tag ...]
---

Save this to the user's Teak library: $ARGUMENTS

1. If it is a single URL, call `teak_v1_check_duplicate_url` first. When the link is already saved, say so and give its card instead of saving it again.
2. Call `teak_v1_create_card` with the URL as `url`, or the text as `content`. Words written as `#tag` become `tags` (without the `#`), not content.
3. Reply with one line naming what was saved and its type. If Teak answered `CARD_LIMIT_REACHED`, explain that the free plan's 200 cards are used up.
