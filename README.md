# PT Done

Installable PT tracker with optional Airtable sync for cross-device use.

## Airtable Setup

Create one Airtable table named `PT Sync` with these fields:

- `Key` as a single line text field
- `Data` as a long text field

Set these environment variables wherever the app is hosted:

- `AIRTABLE_TOKEN`: Airtable personal access token with read/write access to the base
- `AIRTABLE_BASE_ID`: Airtable base ID, starting with `app...`
- `AIRTABLE_TABLE_NAME`: optional, defaults to `PT Sync`

The app keeps working locally if sync is not configured. Once configured, open the app and tap `Sync` on each device.

The sync stores the app state in one Airtable row with `Key` set to `pt-state`.
Routine edits, day changes, resets, completed sessions, and manual `Sync` pushes are treated as notable changes. Individual set taps stay local until the session is complete or `Sync` is tapped.
