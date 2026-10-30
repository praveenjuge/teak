---
description: Show the cards you saved most recently in Teak
argument-hint: "[how many, default 12]"
---

Show the user's most recently saved Teak cards.

Call `teak_v1_list_cards` with `sort: "newest"` and `limit` set to the number in "$ARGUMENTS" (12 when no number is given, at most 50). List each card's title and type, newest first, and point out any themes across them.
