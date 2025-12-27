# Game Adapter Interface

Use this when you want to drop a new game into the server/room template.

## Concept

The WebSocket router delegates all game-specific behavior to a game adapter. The adapter owns:

- The room state shape
- Validation and turn logic
- Broadcast payloads
- Optional AI scheduling

## Required adapter functions

Implement these in your game adapter factory and return them as an object:

- `createRoomState(roomId)` -> room state object
- `addPlayer(room, name, ws)` -> `{ ok, error? }`
- `broadcastState(room)` -> send state to all connected players
- `buildHintPayload(room, player, step)` -> payload for `hint`
- `normalizeTablePayload(payload)` -> `{ table? , error? }`
- `sanitizeDraftTable(room, player, newTable)` -> `{ ok, error? }`
- `processSubmitTurn(room, playerName, table)` -> `{ ok, error?, roundOver? }`
- `processDrawTurn(room, playerName)` -> `{ ok, error?, roundOver? }`
- `scheduleAiTurn(room)` -> optional AI scheduling hook
- `startGameAction(room, playerName)` -> `{ ok, error? }`
- `addAiAction(room, playerName, level)` -> `{ ok, error? }`
- `removeAiAction(room, playerName, targetName)` -> `{ ok, error? }`
- `setRulesAction(room, playerName, jokerLocked)` -> `{ ok, error? }`
- `sortTableAction(room, playerName)` -> `{ ok, error? }`
- `toggleAutoPlayAction(room, playerName, enabled)` -> `{ ok, error? }`
- `addChatMessage(room, playerName, text)` -> mutate chat history
- `disconnectPlayer(room, playerName)` -> `{ ok }`

## Shared helpers

- `server/roomManager.js` handles room IDs + idle cleanup.
- `server/wsRouter.js` handles WebSocket message parsing and routes to your adapter.

## Usage

Wire your adapter into the server bootstrap:

```js
const { createRoomManager } = require('./roomManager');
const { createWsRouter } = require('./wsRouter');
const { createMyGameAdapter } = require('./myGameAdapter');

const adapter = createMyGameAdapter();
const roomManager = createRoomManager({
  createRoom: adapter.createRoomState,
  isRoomActive: (room) => room.order.some((name) => room.players.get(name)?.connected)
});

createWsRouter({ wss, roomManager, adapter });
```
