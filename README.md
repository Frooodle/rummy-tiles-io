# Tile Rummy Multiplayer

Browser-based multiplayer Tile Rummy with room IDs and reconnects (same room ID + name).

Demo link: https://rummy-tiles-io.onrender.com/

## Dev setup

```bash
npm install
npm run dev:server
npm run dev:client
```

- Server runs on `http://localhost:3000`
- Vite client runs on `http://localhost:5173`
- The client auto-connects to port 3000 when running on 5173.

## Rules implemented

- Classic 106 tiles (two of each 1-13 in 4 colors + 2 jokers)
- Up to 5 players, 13 tiles each
- Initial meld: play at least 30 points from your hand before rearranging the table
- Full table rearrangement after initial meld (must keep all existing table tiles)
- Valid sets (same value, different colors) and runs (same color, consecutive)
- Jokers can represent any tile; scoring treats jokers as 30 points
- Round ends when a player empties their hand, or stalemate with empty deck

## Production build

```bash
npm install
npm run build
npm start
```

## Docker

```bash
docker build -t tile-rummy .
docker run -p 3000:3000 tile-rummy
```
