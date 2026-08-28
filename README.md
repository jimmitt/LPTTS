# LPTTS

[**Open the LPTTS app →**](https://jimmitt.github.io/LPTTS/)

LPTTS is a lightweight, browser-based 2D card table. It imports card decks from Tabletop Simulator JSON, keeps each player's hand private, and synchronizes the shared table through a small HTTPS polling relay. The host's browser remains the authoritative game server.

## What it does

- Imports TTS save and saved-object JSON containing `Deck`, `Card`, or `CardCustom` objects
- Creates decks directly from a local face sheet and card-back image
- Displays TTS deck-sheet images using `CardID`, `CustomDeck`, `NumWidth`, and `NumHeight`
- Supports relay-backed tables for up to eight players
- Uses a six-character table code or invite link, with no account required
- Includes table chat that can be minimized
- Keeps card faces in a player's hand out of every other guest's network state
- Draws, shuffles, plays, flips, moves, and takes cards
- Runs as a responsive, dependency-free browser client
- Runs its browser client as a static GitHub Pages site from `/docs`

## Run locally

Serve the `docs` directory with any static web server. For example:

```bash
npx serve docs
```

Run the checks with:

```bash
npm test
```

## Connecting players

1. The host opens LPTTS, enters a name, and chooses **Host a table**.
2. The host copies the six-character table code or invite link.
3. Other players choose **Join with a table code** and enter the code.
4. The relay connects them automatically. The same code works for up to seven guests.

The host must remain online, but refreshing the same tab resumes its table from session storage. Relay rooms, queued events, and uploaded artwork expire after six hours of inactivity.

## TTS compatibility

Use **Objects → Saved Objects** or a game save in Tabletop Simulator, then select its `.json` file in LPTTS. Card artwork remains hosted at the URLs recorded in the TTS file; LPTTS does not copy or redistribute those images. Remote image hosts must permit browsers to load the artwork over HTTPS.

TTS objects that reference `file:///` artwork cannot load those files from a web page. Choose **Create image deck**, select the local front sheet and back image, then enter the sheet's columns, rows, and actual card count. Images upload in resumable chunks to temporary relay storage and expire with the room.

For the Legendary Profiles output, use:

- Front: `legendary-profiles-faces.jpg`
- Back: `legendary-profiles-back.jpg`
- Columns: `7`
- Rows: `7`
- Cards: `43`

Not currently implemented: TTS 3D objects, physics, scripting, hidden zones, counters, tokens, dice, or persistence. LPTTS intentionally stays focused on cards and a flat table.

## Security notes

- Guests receive only a hand count, player color/name, and public card backs for other hands—not their private card objects.
- The host necessarily holds the complete game state, so players must trust the host.
- Imports accept only HTTP(S) artwork URLs and cap decks at 1,000 cards.
- Relay traffic is encrypted in transit with HTTPS and authenticated with random per-player session tokens.
- The relay temporarily stores queued state, chat messages, and uploaded artwork for room delivery.

## License

[MIT](LICENSE)
