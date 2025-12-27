const { createRoom } = require('./roomState');

function createBlankAdapter() {
  function createRoomState(roomId) {
    return createRoom(roomId);
  }

  function addPlayer(room, name, ws) {
    let player = room.players.get(name);
    if (!player) {
      player = { name, ws, connected: true };
      room.players.set(name, player);
      room.order.push(name);
      if (!room.hostName) {
        room.hostName = name;
      }
      if (!room.scores.has(name)) {
        room.scores.set(name, 0);
      }
    } else {
      player.ws = ws;
      player.connected = true;
    }
    return { ok: true, player };
  }

  function broadcastState(room) {
    room.order.forEach((name) => {
      const player = room.players.get(name);
      if (!player || !player.ws) {
        return;
      }
      player.ws.send(JSON.stringify({
        type: 'state',
        roomId: room.id,
        hostName: room.hostName,
        started: room.started,
        roundOver: room.roundOver,
        players: room.order.map((playerName) => {
          const item = room.players.get(playerName);
          return {
            name: playerName,
            connected: item ? item.connected : false
          };
        }),
        chatHistory: room.chatHistory,
        you: { name }
      }));
    });
  }

  function buildHintPayload() {
    return { message: 'No hints available in blank template.' };
  }

  function normalizeTablePayload() {
    return { error: 'No table actions in blank template.' };
  }

  function sanitizeDraftTable() {
    return { ok: false, error: 'Drafts not supported.' };
  }

  function processSubmitTurn() {
    return { ok: false, error: 'Turns not supported.' };
  }

  function processDrawTurn() {
    return { ok: false, error: 'Turns not supported.' };
  }

  function scheduleAiTurn() {}

  function startGameAction(room, playerName) {
    if (room.hostName !== playerName) {
      return { ok: false, error: 'Only host can start.' };
    }
    room.started = true;
    room.roundOver = false;
    return { ok: true };
  }

  function addAiAction() {
    return { ok: false, error: 'AI not supported.' };
  }

  function removeAiAction() {
    return { ok: false, error: 'AI not supported.' };
  }

  function setRulesAction() {
    return { ok: false, error: 'Rules not supported.' };
  }

  function sortTableAction() {
    return { ok: false, error: 'Sorting not supported.' };
  }

  function toggleAutoPlayAction() {
    return { ok: false, error: 'Auto play not supported.' };
  }

  function addChatMessage(room, playerName, text) {
    room.chatHistory.push({ player: playerName, text, ts: Date.now() });
    if (room.chatHistory.length > 200) {
      room.chatHistory.shift();
    }
  }

  function disconnectPlayer(room, playerName) {
    const player = room.players.get(playerName);
    if (!player) {
      return { ok: false };
    }
    player.connected = false;
    return { ok: true };
  }

  return {
    createRoomState,
    addPlayer,
    broadcastState,
    buildHintPayload,
    normalizeTablePayload,
    sanitizeDraftTable,
    processSubmitTurn,
    processDrawTurn,
    scheduleAiTurn,
    startGameAction,
    addAiAction,
    removeAiAction,
    setRulesAction,
    sortTableAction,
    toggleAutoPlayAction,
    addChatMessage,
    disconnectPlayer
  };
}

module.exports = {
  createBlankAdapter
};
