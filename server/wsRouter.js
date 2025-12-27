const WebSocket = require('ws');
const { sanitizeName, sanitizeChat, parseAiLevel } = require('./schema');

function createWsRouter({
  wss,
  roomManager,
  adapter,
  maxMessageBytes = 64 * 1024
}) {
  function sendError(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: 'error', message }));
  }

  function sendHint(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: 'hint', ...payload }));
  }

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let data = null;
      let rawText = null;
      try {
        rawText = typeof raw === 'string' ? raw : raw.toString('utf8');
        if (rawText.length > maxMessageBytes) {
          sendError(ws, 'Message too large.');
          return;
        }
        data = JSON.parse(rawText);
      } catch (error) {
        sendError(ws, 'Invalid message.');
        return;
      }

      if (data.type === 'createRoom') {
        const name = sanitizeName(data.name);
        if (!name) {
          sendError(ws, 'Name required.');
          return;
        }
        const room = roomManager.createNewRoom();
        if (!room) {
          sendError(ws, 'Could not create room. Try again.');
          return;
        }
        const addResult = adapter.addPlayer(room, name, ws);
        if (!addResult.ok) {
          sendError(ws, addResult.error);
          return;
        }
        ws.roomId = room.id;
        ws.playerName = name;
        roomManager.touchRoom(room);
        adapter.broadcastState(room);
        return;
      }

      if (data.type === 'join') {
        const roomId = roomManager.normalizeRoomId(data.roomId);
        const name = sanitizeName(data.name);
        if (!roomId || !name) {
          sendError(ws, 'Room ID and name required.');
          return;
        }
        if (!roomManager.isValidRoomId(roomId)) {
          sendError(ws, 'Invalid room ID.');
          return;
        }
        const room = roomManager.getRoom(roomId);
        if (!room) {
          sendError(ws, 'Room not found.');
          return;
        }
        const addResult = adapter.addPlayer(room, name, ws);
        if (!addResult.ok) {
          sendError(ws, addResult.error);
          return;
        }
        ws.roomId = roomId;
        ws.playerName = name;
        roomManager.touchRoom(room);
        adapter.broadcastState(room);
        return;
      }

      const roomId = ws.roomId;
      const playerName = ws.playerName;
      if (!roomId || !playerName) {
        sendError(ws, 'Join a room first.');
        return;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        sendError(ws, 'Room not found.');
        return;
      }
      const player = room.players.get(playerName);
      if (!player) {
        sendError(ws, 'Player not found.');
        return;
      }

      roomManager.touchRoom(room);

      if (data.type === 'startGame') {
        const result = adapter.startGameAction(room, playerName);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        return;
      }

      if (data.type === 'addAi') {
        const level = parseAiLevel(data.level);
        const result = adapter.addAiAction(room, playerName, level);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        return;
      }

      if (data.type === 'setRules') {
        const result = adapter.setRulesAction(room, playerName, data.jokerLocked);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        return;
      }

      if (data.type === 'chat') {
        const text = sanitizeChat(data.text);
        if (!text) {
          return;
        }
        adapter.addChatMessage(room, playerName, text);
        adapter.broadcastState(room);
        return;
      }

      if (data.type === 'removeAi') {
        const targetName = data.name ? String(data.name) : null;
        const result = adapter.removeAiAction(room, playerName, targetName);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        return;
      }

      if (data.type === 'sortTable') {
        const result = adapter.sortTableAction(room, playerName);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        return;
      }

      if (data.type === 'toggleAutoPlay') {
        const result = adapter.toggleAutoPlayAction(room, playerName, data.enabled);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        adapter.scheduleAiTurn(room);
        return;
      }

      if (data.type === 'hint') {
        const step = Number(data.step) || 1;
        const payload = adapter.buildHintPayload(room, player, step);
        sendHint(ws, payload);
        return;
      }

      if (!room.started) {
        sendError(ws, 'Game has not started.');
        return;
      }

      if (room.roundOver) {
        sendError(ws, 'Round ended.');
        return;
      }

      const isTurn = room.currentPlayer === playerName;
      if (!isTurn && data.type !== 'join') {
        sendError(ws, 'Not your turn.');
        return;
      }

      if (player.autoPlay) {
        sendError(ws, 'Auto play is enabled.');
        return;
      }

      if (data.type === 'submitTurn') {
        if (Number(data.turnId) !== room.turnId) {
          sendError(ws, 'Turn is out of date.');
          return;
        }
        const normalized = adapter.normalizeTablePayload(data.table);
        if (normalized.error) {
          sendError(ws, normalized.error);
          return;
        }
        room.draftTable = null;
        room.draftPlayer = null;
        const result = adapter.processSubmitTurn(room, playerName, normalized.table);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        adapter.scheduleAiTurn(room);
        return;
      }

      if (data.type === 'endTurn') {
        const result = adapter.processDrawTurn(room, playerName);
        if (!result.ok) {
          sendError(ws, result.error);
          return;
        }
        adapter.broadcastState(room);
        adapter.scheduleAiTurn(room);
        return;
      }

      if (data.type === 'draftUpdate') {
        if (Number(data.turnId) !== room.turnId) {
          return;
        }
        if (room.currentPlayer !== playerName) {
          return;
        }
        const normalized = adapter.normalizeTablePayload(data.table);
        if (normalized.error) {
          return;
        }
        const draftCheck = adapter.sanitizeDraftTable(room, player, normalized.table);
        if (!draftCheck.ok) {
          return;
        }
        room.draftTable = normalized.table.map((group) => ({
          id: group.id,
          tiles: group.tiles.map((tile) => ({ ...tile }))
        }));
        room.draftPlayer = playerName;
        adapter.broadcastState(room);
        return;
      }

      sendError(ws, 'Unknown action.');
    });

    ws.on('close', () => {
      const roomId = ws.roomId;
      const playerName = ws.playerName;
      if (!roomId || !playerName) {
        return;
      }
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return;
      }
      const result = adapter.disconnectPlayer(room, playerName);
      if (!result.ok) {
        return;
      }
      roomManager.touchRoom(room);
      adapter.broadcastState(room);
    });
  });
}

module.exports = {
  createWsRouter
};
