const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const { createRoomManager } = require('./roomManager');
const { createRummikubAdapter } = require('./rummikubAdapter');
const { createWsRouter } = require('./wsRouter');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

const adapter = createRummikubAdapter({
  maxPlayers: 5,
  initialMeldPoints: 30,
  maxGroups: 80,
  maxTableTiles: 120
});

const roomManager = createRoomManager({
  createRoom: adapter.createRoomState,
  isRoomActive: (room) => room.order.some((name) => {
    const player = room.players.get(name);
    return player && player.connected;
  }),
  idleMs: 30 * 60 * 1000,
  cleanupIntervalMs: 5 * 60 * 1000
});

createWsRouter({
  wss,
  roomManager,
  adapter,
  maxMessageBytes: 64 * 1024
});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`Tile Rummy server listening on ${PORT}`);
});
