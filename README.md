# LPTTS

LPTTS is a lightweight, browser-based 2D card table. It imports card decks from Tabletop Simulator JSON, keeps each player's hand private on the server, and synchronizes the shared table over WebSockets.

## What it does

- Imports TTS save and saved-object JSON containing `Deck`, `Card`, or `CardCustom` objects
- Displays TTS deck-sheet images using `CardID`, `CustomDeck`, `NumWidth`, and `NumHeight`
- Supports rooms for up to eight players
- Keeps card faces in a player's hand out of every other player's network state
- Draws, shuffles, plays, flips, moves, and takes cards
- Runs as a responsive, dependency-free browser client
- Includes an offline demo that works on GitHub Pages

## Run locally

```bash
npm install
npm start
```

Open <http://localhost:8080>. The same Node process serves the client and WebSocket endpoint.

Run the checks with:

```bash
npm test
```

## Multiplayer deployment

GitHub Pages hosts only static files, so the hosted page's offline demo works without a backend, while online multiplayer needs this repository's server deployed to a Node host that supports WebSockets (for example Fly.io, Render, Railway, or a VPS).

Start the server with `npm start`; it honors the `PORT` environment variable. Enter its public `wss://` address on the LPTTS landing page. Invite links retain both the room and server address.

The server keeps rooms in memory by design. Restarting it clears active rooms, and empty rooms are immediately discarded.

## TTS compatibility

Use **Objects → Saved Objects** or a game save in Tabletop Simulator, then select its `.json` file in LPTTS. Card artwork remains hosted at the URLs recorded in the TTS file; LPTTS does not copy or redistribute those images. Remote image hosts must permit browsers to load the artwork over HTTPS.

Not currently implemented: TTS 3D objects, physics, scripting, hidden zones, counters, tokens, dice, or persistence. LPTTS intentionally stays focused on cards and a flat table.

## Security notes

- Other players receive only a hand count, player color/name, and public card backs—not private card objects.
- Imports accept only HTTP(S) artwork URLs and cap decks at 1,000 cards on the multiplayer server.
- The server limits WebSocket messages to 5 MB.

## License

[MIT](LICENSE)
