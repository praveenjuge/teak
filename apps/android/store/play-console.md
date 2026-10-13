# Play Console answers

These are the answers for Teak's App content forms in Play Console (Policy and programs → App content). Keep them true to the app: when the app starts collecting something new, update this file and the form together.

## App details

- **App name:** Teak
- **Default language:** English (United States)
- **App or game:** App
- **Free or paid:** Free
- **Category:** Productivity
- **Contact email:** hello@praveenjuge.com
- **Website:** https://teakvault.com
- **Privacy policy:** https://teakvault.com/docs/privacy-policy

## Ads

The app contains no ads.

## App access

All functionality is behind sign-in, but anyone can create a free account in the app, so reviewers don't need a demo account (App Store review accepted the same). Choose "All or some functionality is restricted" and add one instruction with no username or password:

- **Name:** Create a free account
- **Instructions:** "Tap Continue with Google and pick any Google account, or tap Register with Email, to create a free Teak account. The library then opens. Use the Add tab to save a note or link, record a voice memo or upload a photo. Share a link to Teak from Chrome to test the share sheet. Settings has Delete Account."

If Google asks for credentials anyway, create a demo account with email sign-up on teakvault.com, add a few sample cards, and enter its email and password in the form only. Never commit them.

## Content rating

Use the IARC questionnaire:

- Category: Utility, Productivity, Communication, or Other.
- Violence, sexuality, language, controlled substances and gambling: none.
- User-generated content shared with other users: no. Cards are private to their owner.
- Shares the user's location: no.
- Digital purchases: no. The Pro plan is bought on the web, not in the app.

## Target audience

- **Age groups:** 18 and over.
- **Appeals to children:** no.

## News app

No.

## Account deletion

- **In the app:** Settings, Delete Account. It asks you to type "delete account" to confirm.
- **On the web:** https://app.teakvault.com, Settings, Delete account.
- **Deletion link for the Data safety form:** https://teakvault.com/docs/delete-account. It has the steps for every app and an email option for people who can't sign in.
- **What happens:** the account, cards, tags and uploaded files are deleted. Nothing is kept after deletion, apart from what the privacy policy describes for backups and legal requirements.

## Data safety

### Overview

- **Collects or shares any of the required data types:** yes.
- **All collected data is encrypted in transit:** yes (HTTPS and WSS only).
- **Users can request that data be deleted:** yes, in the app and on the web.
- **Shared with third parties:** none. Convex, WorkOS, Cloudflare and PostHog act as service providers on our behalf, which Play doesn't count as sharing.

### Data types collected

| Data type | Collected | Shared | Optional | Purposes |
| --- | --- | --- | --- | --- |
| Personal info: Name | Yes | No | No | Account management |
| Personal info: Email address | Yes | No | No | Account management, App functionality, Analytics |
| Personal info: User IDs | Yes | No | No | Account management, App functionality, Analytics |
| Photos and videos: Photos | Yes | No | Yes | App functionality |
| Photos and videos: Videos | Yes | No | Yes | App functionality |
| Audio: Voice or sound recordings | Yes | No | Yes | App functionality |
| Audio: Other audio files | Yes | No | Yes | App functionality |
| Files and docs | Yes | No | Yes | App functionality |
| App activity: Other user-generated content (notes, links, tags) | Yes | No | Yes | App functionality |
| App activity: App interactions | Yes | No | No | Analytics |
| App info and performance: Crash logs | Yes | No | No | Analytics (stability) |
| App info and performance: Diagnostics | Yes | No | No | Analytics (stability) |
| Device or other IDs | Yes | No | No | Analytics |

PostHog processes the analytics rows. Release builds send app open and close events and crash reports, linked to the Teak account ID with the email address as a person property, plus a random install ID that PostHog creates before sign-in. No advertising ID or hardware identifiers.

### Not collected

- Location
- Contacts
- Calendar
- Messages
- Health
- Financial info
- Web browsing history
- Search history (searches run on the server and aren't stored)
- Installed apps
- Advertising ID

### Is data processed ephemerally?

No. Cards are stored until the person deletes them.

## Permissions to declare

- **`RECORD_AUDIO`:** asked for only when recording a voice memo.
- **`CAMERA`:** asked for only when taking a photo from the Add screen.
- **`POST_NOTIFICATIONS`:** asked for once before the first upload, to show upload progress.
- **`FOREGROUND_SERVICE_DATA_SYNC`:** uploads a file the person chose, with a visible notification. Play's foreground service form asks for a description and a video. Use "Uploads files the user selected to their Teak library" and a short screen recording of an upload.

## Store listing assets

Assets live in `listing/en-US/`:

- `title.txt` (23 of 30 characters)
- `short_description.txt` (77 of 80)
- `full_description.txt` (under 4,000)
- `graphics/icon.png`, 512 × 512
- `graphics/feature_graphic.png`, 1024 × 500
- `graphics/phone-screenshots/`, five 1080 × 1920 phone screenshots, in order

The feature graphic and screenshots come from the store images pipeline in
`scripts/store-assets/README.md`. Upload them by hand in Play Console. Tablet
screenshots (7-inch and 10-inch, at least one each) are still to come.
