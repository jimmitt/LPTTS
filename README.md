# LPTTS

[**Open the LPTTS app →**](https://jimmitt.github.io/LPTTS/)

LPTTS is a lightweight, browser-based 2D card table. It imports card decks from Tabletop Simulator JSON, keeps each player's hand private, and synchronizes the shared table directly between browsers with WebRTC. The host's browser is the authoritative game server—there is no backend.

## What it does

- Imports TTS save and saved-object JSON containing `Deck`, `Card`, or `CardCustom` objects
- Creates decks directly from a local face sheet and card-back image
- Displays TTS deck-sheet images using `CardID`, `CustomDeck`, `NumWidth`, and `NumHeight`
- Supports direct peer-to-peer tables for up to eight players
- Uses copy/paste connection codes, with no account, signaling server, or database
- Keeps card faces in a player's hand out of every other guest's network state
- Draws, shuffles, plays, flips, moves, and takes cards
- Runs as a responsive, dependency-free browser client
- Runs entirely as a static GitHub Pages site from `/docs`

## Run locally

Serve the `docs` directory with any static web server. WebRTC requires HTTPS or localhost. For example:

```bash
npx serve docs
```

Run the checks with:

```bash
npm test
```

## Connecting players

1. The host opens LPTTS, enters a name, and chooses **Host a table**.
2. The host clicks the table badge at the top, copies the offer code, and sends it to one player.
3. That player chooses **Join with a connection code**, pastes the offer, and creates an answer code.
4. The player sends the answer code to the host. The host pastes it and completes the connection.
5. Repeat with a fresh offer for each additional player.

The connection codes contain WebRTC session descriptions and network candidates. Treat them like temporary invitations. They do not contain cards or future game state.

The host must remain online. Closing or reloading the host tab ends the table. Players behind especially restrictive firewalls may be unable to connect because LPTTS intentionally does not operate a TURN relay.

## TTS compatibility

Use **Objects → Saved Objects** or a game save in Tabletop Simulator, then select its `.json` file in LPTTS. Card artwork remains hosted at the URLs recorded in the TTS file; LPTTS does not copy or redistribute those images. Remote image hosts must permit browsers to load the artwork over HTTPS.

TTS objects that reference `file:///` artwork cannot load those files from a web page. Choose **Create image deck**, select the local front sheet and back image, then enter the sheet's columns, rows, and actual card count. Uploaded images stay in browser memory and are transferred directly to connected players in cached chunks.

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
- WebRTC data channels are encrypted in transit by the browser.

## License

[MIT](LICENSE)
