const http = require('http');
const WebSocket = require('ws');

const { createRoomManager } = require('../../server/roomManager');
const { createWsRouter } = require('../../server/wsRouter');
const { createBlankAdapter } = require('./adapter');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const adapter = createBlankAdapter();
const roomManager = createRoomManager({
  createRoom: adapter.createRoomState,
  isRoomActive: (room) => room.order.some((name) => room.players.get(name)?.connected)
});

createWsRouter({ wss, roomManager, adapter });

server.listen(3000, () => {
  console.log('Blank IO server listening on 3000');
});
