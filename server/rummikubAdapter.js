const WebSocket = require('ws');

const {
  parseTileId,
  isValidGroup,
  groupMeldValue,
  normalizeGroupTiles
} = require('./gameRules');
const {
  createRoom,
  startGame,
  startTurn,
  applyScores,
  endRoundStalemate,
  tableTileIds,
  tableSignature,
  findNextPlayer
} = require('./roomState');
const { createAiPlan, createAiTable } = require('./aiPlayer');

function createRummikubAdapter({
  maxPlayers = 5,
  initialMeldPoints = 30,
  maxGroups = 80,
  maxTableTiles = 120
} = {}) {
  function sendToPlayer(player, payload) {
    if (!player.ws || player.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    player.ws.send(JSON.stringify(payload));
  }

  function scoresPayload(room) {
    return room.order.map((name) => ({
      name,
      score: room.scores.get(name) || 0
    }));
  }

  function redactMoveHistoryDetails(room, playerName) {
    if (!Array.isArray(room.moveHistoryDetailed)) {
      return [];
    }
    return room.moveHistoryDetailed.map((entry) => {
      if (entry.type === 'draw' && entry.player !== playerName) {
        return { ...entry, drawnTile: null, hiddenDraw: true };
      }
      if (entry.type === 'submit' && entry.player !== playerName) {
        return { ...entry, playedTiles: null };
      }
      return entry;
    });
  }

  function broadcastState(room) {
    room.order.forEach((name) => {
      const player = room.players.get(name);
      if (!player) {
        return;
      }
      const payload = {
        type: 'state',
        roomId: room.id,
        hostName: room.hostName,
        started: room.started,
        roundOver: room.roundOver,
        winner: room.winner,
        currentPlayer: room.currentPlayer,
        deckCount: room.deck.length,
        round: room.round,
        turnId: room.turnId,
        initialMeld: initialMeldPoints,
        jokerLocked: Boolean(room.jokerLocked),
        players: room.order.map((playerName) => {
          const item = room.players.get(playerName);
          return {
            name: playerName,
            connected: item ? item.connected : false,
            handCount: item ? item.hand.length : 0,
            isAi: item ? Boolean(item.isAi) : false,
            autoPlay: item ? Boolean(item.autoPlay) : false,
            aiLevel: item ? item.aiLevel || 'basic' : 'basic'
          };
        }),
        scores: scoresPayload(room),
        lastMove: room.lastMove,
        moveHistory: room.moveHistory,
        moveHistoryDetailed: redactMoveHistoryDetails(room, name),
        chatHistory: room.chatHistory,
        draftTable: room.draftTable,
        draftPlayer: room.draftPlayer,
        table: room.table,
        you: {
          name: name,
          hand: player.hand,
          hasMelded: player.hasMelded,
          autoPlay: Boolean(player.autoPlay)
        }
      };
      sendToPlayer(player, payload);
    });
    scheduleAiTurn(room);
  }

  function jokerGroupMap(table) {
    const map = new Map();
    table.forEach((group) => {
      group.tiles.forEach((tile) => {
        if (tile.joker) {
          map.set(tile.id, group.id);
        }
      });
    });
    return map;
  }

  function jokerGroupTiles(table) {
    const map = new Map();
    table.forEach((group) => {
      group.tiles.forEach((tile) => {
        if (tile.joker) {
          map.set(tile.id, group.tiles);
        }
      });
    });
    return map;
  }

  function tableGroupSignature(group) {
    return group.tiles.map((tile) => tile.id).sort().join('|');
  }

  function diffTableGroups(prevTable, nextTable) {
    const prevCounts = new Map();
    const nextCounts = new Map();
    prevTable.forEach((group) => {
      const signature = tableGroupSignature(group);
      prevCounts.set(signature, (prevCounts.get(signature) || 0) + 1);
    });
    nextTable.forEach((group) => {
      const signature = tableGroupSignature(group);
      nextCounts.set(signature, (nextCounts.get(signature) || 0) + 1);
    });

    const before = [];
    const after = [];

    prevTable.forEach((group) => {
      const signature = tableGroupSignature(group);
      const count = nextCounts.get(signature) || 0;
      if (count > 0) {
        nextCounts.set(signature, count - 1);
      } else {
        before.push(group);
      }
    });

    nextTable.forEach((group) => {
      const signature = tableGroupSignature(group);
      const count = prevCounts.get(signature) || 0;
      if (count > 0) {
        prevCounts.set(signature, count - 1);
      } else {
        after.push(group);
      }
    });

    return { before, after };
  }

  function isTableOnlyExtended(prevTable, nextTable) {
    const prevCounts = new Map();
    const nextCounts = new Map();
    prevTable.forEach((group) => {
      const signature = tableGroupSignature(group);
      prevCounts.set(signature, (prevCounts.get(signature) || 0) + 1);
    });
    nextTable.forEach((group) => {
      const signature = tableGroupSignature(group);
      nextCounts.set(signature, (nextCounts.get(signature) || 0) + 1);
    });
    for (const [signature, count] of prevCounts.entries()) {
      if ((nextCounts.get(signature) || 0) < count) {
        return false;
      }
    }
    return true;
  }

  function collectHintTilesAdvanced(prevTable, nextTable) {
    const byId = new Map();
    prevTable.forEach((group) => group.tiles.forEach((tile) => byId.set(tile.id, tile)));
    nextTable.forEach((group) => group.tiles.forEach((tile) => byId.set(tile.id, tile)));

    const tiles = new Map();
    const prevIds = new Set(tableTileIds(prevTable));
    nextTable.forEach((group) => {
      group.tiles.forEach((tile) => {
        if (!prevIds.has(tile.id)) {
          tiles.set(tile.id, tile);
        }
      });
    });

    const changes = diffTableGroups(prevTable, nextTable);
    [...changes.before, ...changes.after].forEach((group) => {
      group.tiles.forEach((tile) => {
        const entry = byId.get(tile.id);
        if (entry) {
          tiles.set(entry.id, entry);
        }
      });
    });

    return Array.from(tiles.values());
  }

  function isAiPlayer(player) {
    return player && (player.isAi || player.autoPlay);
  }

  function scheduleAiTurn(room) {
    if (room.aiTimer) {
      return;
    }
    if (room.aiSequenceTimer) {
      return;
    }
    if (room.aiSequenceActive) {
      return;
    }
    if (!room.started || room.roundOver) {
      return;
    }
    const current = room.players.get(room.currentPlayer);
    if (!isAiPlayer(current)) {
      return;
    }
    const baseDelay = current && current.isAi ? 650 : 900;
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;
    room.aiTimer = setTimeout(() => {
      room.aiTimer = null;
      if (room.aiFallbackTimer) {
        clearTimeout(room.aiFallbackTimer);
        room.aiFallbackTimer = null;
      }
      runAiTurn(room);
    }, delay);

    if (room.aiFallbackTimer) {
      clearTimeout(room.aiFallbackTimer);
    }
    room.aiFallbackTimer = setTimeout(() => {
      room.aiFallbackTimer = null;
      if (!room.started || room.roundOver) {
        return;
      }
      const currentPlayer = room.players.get(room.currentPlayer);
      if (!isAiPlayer(currentPlayer)) {
        return;
      }
      const result = processDrawTurn(room, room.currentPlayer);
      if (result.ok) {
        broadcastState(room);
      }
    }, 10000);
  }

  function processSubmitTurn(room, playerName, newTable) {
    const player = room.players.get(playerName);
    if (!player) {
      return { ok: false, error: 'Player not found.' };
    }
    const prevTable = room.turnStartTable;
    const prevIds = new Set(tableTileIds(prevTable));
    const handIds = new Set(player.hand.map((tile) => tile.id));
    const newIds = new Set();
    const playedIds = new Set();

    for (const group of newTable) {
      if (!isValidGroup(group.tiles)) {
        return { ok: false, error: 'One or more groups are invalid.' };
      }
      for (const tile of group.tiles) {
        if (newIds.has(tile.id)) {
          return { ok: false, error: 'Duplicate tile in table.' };
        }
        newIds.add(tile.id);
        if (prevIds.has(tile.id)) {
          continue;
        }
        if (handIds.has(tile.id)) {
          playedIds.add(tile.id);
          continue;
        }
        return { ok: false, error: 'Table uses tiles not available.' };
      }
    }

    for (const id of prevIds) {
      if (!newIds.has(id)) {
        return { ok: false, error: 'You must keep all existing table tiles.' };
      }
    }

    if (playedIds.size === 0) {
      return { ok: false, error: 'You did not play any tiles. Draw instead.' };
    }

    const prevJokers = jokerGroupMap(prevTable);
    const nextJokers = jokerGroupMap(newTable);
    if (room.jokerLocked) {
      for (const [jokerId, prevGroupId] of prevJokers.entries()) {
        if (nextJokers.get(jokerId) !== prevGroupId) {
          return { ok: false, error: 'Jokers are locked and cannot be moved.' };
        }
      }
    } else {
      const prevJokerTiles = jokerGroupTiles(prevTable);
      for (const [jokerId, prevGroupId] of prevJokers.entries()) {
        const nextGroupId = nextJokers.get(jokerId);
        if (!nextGroupId || nextGroupId === prevGroupId) {
          continue;
        }
        const prevTiles = prevJokerTiles.get(jokerId) || [];
        const remaining = prevTiles.filter((tile) => tile.id !== jokerId);
        if (!isValidGroup(remaining)) {
          return { ok: false, error: 'Joker can only move if its original group stays valid.' };
        }
      }
    }

    if (!player.hasMelded) {
      const prevSig = tableSignature(prevTable);
      const nextSig = tableSignature(newTable);
      for (const [signature, count] of prevSig.entries()) {
        if ((nextSig.get(signature) || 0) < count) {
          return { ok: false, error: 'You cannot change the table before your initial meld.' };
        }
      }
      let meldPoints = 0;
      newTable.forEach((group) => {
        const hasPlayedTile = group.tiles.some((tile) => playedIds.has(tile.id));
        if (hasPlayedTile) {
          meldPoints += groupMeldValue(group.tiles);
        }
      });
      if (meldPoints < initialMeldPoints) {
        return { ok: false, error: `Initial meld must be at least ${initialMeldPoints} points.` };
      }
    }

    const playedTiles = player.hand.filter((tile) => playedIds.has(tile.id));
    player.hand = player.hand.filter((tile) => !playedIds.has(tile.id));
    player.hasMelded = true;
    room.table = newTable.map((group) => ({
      id: group.id,
      tiles: normalizeGroupTiles(group.tiles).map((tile) => ({ ...tile }))
    }));
    room.draftTable = null;
    room.draftPlayer = null;
    const moveText = `${playerName} played ${playedIds.size} tile${playedIds.size === 1 ? '' : 's'}.`;
    room.lastMove = moveText;
    room.moveHistory.push(moveText);
    const changedGroups = diffTableGroups(prevTable, newTable);
    room.moveHistoryDetailed.push({
      text: moveText,
      type: 'submit',
      player: playerName,
      playedTiles,
      tableBefore: changedGroups.before,
      tableAfter: changedGroups.after
    });
    if (room.moveHistory.length > 200) {
      room.moveHistory.shift();
    }
    if (room.moveHistoryDetailed.length > 200) {
      room.moveHistoryDetailed.shift();
    }
    room.noPlayTurns = 0;

    if (player.hand.length === 0) {
      applyScores(room, playerName);
      return { ok: true, roundOver: true };
    }

    const nextPlayer = findNextPlayer(room, playerName);
    if (nextPlayer) {
      startTurn(room, nextPlayer);
    }
    return { ok: true, roundOver: false };
  }

  function processDrawTurn(room, playerName) {
    const player = room.players.get(playerName);
    if (!player) {
      return { ok: false, error: 'Player not found.' };
    }
    if (room.deck.length > 0) {
      const drawnTile = room.deck.shift();
      player.hand.push(drawnTile);
      const moveText = `${playerName} drew a tile.`;
      room.lastMove = moveText;
      room.moveHistory.push(moveText);
      room.moveHistoryDetailed.push({
        text: moveText,
        type: 'draw',
        player: playerName,
        drawnTile
      });
      if (room.moveHistory.length > 200) {
        room.moveHistory.shift();
      }
      if (room.moveHistoryDetailed.length > 200) {
        room.moveHistoryDetailed.shift();
      }
      room.draftTable = null;
      room.draftPlayer = null;
      room.noPlayTurns = 0;
    } else {
      room.noPlayTurns += 1;
      const moveText = `${playerName} passed (deck empty).`;
      room.lastMove = moveText;
      room.moveHistory.push(moveText);
      room.moveHistoryDetailed.push({
        text: moveText,
        type: 'pass',
        player: playerName
      });
      if (room.moveHistory.length > 200) {
        room.moveHistory.shift();
      }
      if (room.moveHistoryDetailed.length > 200) {
        room.moveHistoryDetailed.shift();
      }
      room.draftTable = null;
      room.draftPlayer = null;
      if (room.noPlayTurns >= room.order.length) {
        endRoundStalemate(room);
        return { ok: true, roundOver: true };
      }
    }
    const nextPlayer = findNextPlayer(room, playerName);
    if (nextPlayer) {
      startTurn(room, nextPlayer);
    }
    return { ok: true, roundOver: false };
  }

  function runAiTurn(room) {
    if (!room.started || room.roundOver) {
      return;
    }
    const playerName = room.currentPlayer;
    const player = room.players.get(playerName);
    if (!isAiPlayer(player)) {
      return;
    }
    const aiLevel = player && player.aiLevel ? player.aiLevel : 'basic';
    const plan = createAiPlan(room, player, initialMeldPoints, aiLevel);
    if (!plan) {
      processDrawTurn(room, playerName);
      broadcastState(room);
      scheduleAiTurn(room);
      return;
    }
    if (isTableOnlyExtended(room.table, plan.table)) {
      const result = processSubmitTurn(room, playerName, plan.table);
      if (!result.ok) {
        processDrawTurn(room, playerName);
      }
      broadcastState(room);
      scheduleAiTurn(room);
      return;
    }
    runAiPlanSequence(room, playerName, plan);
  }

  function runAiPlanSequence(room, playerName, plan) {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const delay = 1200 + Math.floor(Math.random() * 600);
    let index = 0;
    room.aiSequenceActive = true;

    function advance() {
      if (!room.started || room.roundOver || room.currentPlayer !== playerName) {
        room.aiSequenceTimer = null;
        room.aiSequenceActive = false;
        return;
      }
      if (index < steps.length) {
        room.draftTable = steps[index];
        room.draftPlayer = playerName;
        index += 1;
        room.aiSequenceTimer = setTimeout(advance, delay);
        broadcastState(room);
        return;
      }
      room.aiSequenceTimer = null;
      room.aiSequenceActive = false;
      room.draftTable = null;
      room.draftPlayer = null;
      const result = processSubmitTurn(room, playerName, plan.table);
      if (!result.ok) {
        processDrawTurn(room, playerName);
      }
      broadcastState(room);
      scheduleAiTurn(room);
    }

    if (room.aiSequenceTimer) {
      clearTimeout(room.aiSequenceTimer);
      room.aiSequenceTimer = null;
    }
    if (room.aiFallbackTimer) {
      clearTimeout(room.aiFallbackTimer);
      room.aiFallbackTimer = null;
    }
    advance();
  }

  function collectHintTiles(baseTable, newTable) {
    const baseIds = new Set(tableTileIds(baseTable));
    const used = new Map();
    newTable.forEach((group) => {
      group.tiles.forEach((tile) => {
        if (!baseIds.has(tile.id)) {
          used.set(tile.id, tile);
        }
      });
    });
    return Array.from(used.values());
  }

  function buildHintPayload(room, player, step) {
    if (!room.started || room.roundOver || room.winner) {
      return { message: 'No moves available right now.' };
    }
    if (room.currentPlayer !== player.name) {
      return { message: 'Not your turn.' };
    }
    if (player.autoPlay) {
      return { message: 'Auto play is enabled.' };
    }
    let usedAdvanced = false;
    let table = createAiTable(room, player, initialMeldPoints, 'basic');
    if (!table) {
      table = createAiTable(room, player, initialMeldPoints, 'advanced');
      usedAdvanced = Boolean(table);
    }
    if (!table) {
      return { message: 'No moves found.' };
    }
    let tiles = collectHintTiles(room.table, table);
    if (usedAdvanced) {
      const advancedTiles = collectHintTilesAdvanced(room.table, table);
      if (advancedTiles.length > 0) {
        tiles = advancedTiles;
      }
    }
    return { tiles, usedAdvanced };
  }

  function sortRoomTable(room) {
    room.table = room.table.map((group) => ({
      id: group.id,
      tiles: normalizeGroupTiles(group.tiles).map((tile) => ({ ...tile }))
    }));
  }

  function normalizeTablePayload(payload) {
    if (!Array.isArray(payload)) {
      return { error: 'Table data missing.' };
    }
    if (payload.length > maxGroups) {
      return { error: 'Too many groups submitted.' };
    }
    const seen = new Set();
    const groups = [];
    let totalTiles = 0;
    for (const group of payload) {
      const groupId = String(group.id || '');
      const tileIds = Array.isArray(group.tileIds) ? group.tileIds : [];
      if (!groupId || tileIds.length === 0) {
        return { error: 'Group data invalid.' };
      }
      totalTiles += tileIds.length;
      if (totalTiles > maxTableTiles) {
        return { error: 'Too many tiles submitted.' };
      }
      const tiles = [];
      for (const id of tileIds) {
        if (seen.has(id)) {
          return { error: 'Duplicate tile in table.' };
        }
        const tile = parseTileId(id);
        if (!tile) {
          return { error: 'Invalid tile.' };
        }
        seen.add(id);
        tiles.push(tile);
      }
      groups.push({ id: groupId, tiles });
    }
    return { table: groups };
  }

  function sanitizeDraftTable(room, player, newTable) {
    const prevIds = new Set(tableTileIds(room.table));
    const handIds = new Set(player.hand.map((tile) => tile.id));
    const seen = new Set();
    for (const group of newTable) {
      for (const tile of group.tiles) {
        if (seen.has(tile.id)) {
          return { ok: false, error: 'Duplicate tile in draft.' };
        }
        seen.add(tile.id);
        if (!prevIds.has(tile.id) && !handIds.has(tile.id)) {
          return { ok: false, error: 'Draft uses tiles not available.' };
        }
      }
    }
    return { ok: true };
  }

  function addPlayer(room, name, ws) {
    let player = room.players.get(name);
    const isNew = !player;
    if (!player) {
      if (room.order.length >= maxPlayers) {
        return { ok: false, error: 'Room is full.' };
      }
      player = { name, ws, connected: true, hand: [], hasMelded: false, autoPlay: false, aiLevel: 'basic' };
      room.players.set(name, player);
      room.order.push(name);
      if (!room.hostName) {
        room.hostName = name;
      }
      if (!room.scores.has(name)) {
        room.scores.set(name, 0);
      }
    } else {
      if (player.isAi) {
        return { ok: false, error: 'Name reserved by AI player.' };
      }
      player.ws = ws;
      player.connected = true;
    }
    return { ok: true, player, isNew };
  }

  function startGameAction(room, playerName) {
    if (room.started) {
      return { ok: false, error: 'Game already started.' };
    }
    if (room.hostName !== playerName) {
      return { ok: false, error: 'Only host can start.' };
    }
    if (room.order.length < 2) {
      return { ok: false, error: 'Need at least 2 players to start.' };
    }
    startGame(room);
    return { ok: true };
  }

  function addAiAction(room, playerName, level) {
    if (room.started) {
      return { ok: false, error: 'Game already started.' };
    }
    if (room.hostName !== playerName) {
      return { ok: false, error: 'Only host can add AI.' };
    }
    if (room.order.length >= maxPlayers) {
      return { ok: false, error: 'Room is full.' };
    }
    const aiLevel = level === 'advanced' ? 'advanced' : 'basic';
    room.aiCounter += 1;
    let aiName = `AI-${room.aiCounter}`;
    while (room.players.has(aiName)) {
      room.aiCounter += 1;
      aiName = `AI-${room.aiCounter}`;
    }
    const aiPlayer = {
      name: aiName,
      ws: null,
      connected: true,
      hand: [],
      hasMelded: false,
      isAi: true,
      autoPlay: false,
      aiLevel
    };
    room.players.set(aiName, aiPlayer);
    room.order.push(aiName);
    return { ok: true };
  }

  function removeAiAction(room, playerName, targetName) {
    if (room.started) {
      return { ok: false, error: 'Game already started.' };
    }
    if (room.hostName !== playerName) {
      return { ok: false, error: 'Only host can remove AI.' };
    }
    let removed = null;
    if (targetName) {
      const candidate = room.players.get(targetName);
      if (candidate && candidate.isAi) {
        removed = targetName;
      }
    } else {
      for (let i = room.order.length - 1; i >= 0; i -= 1) {
        const name = room.order[i];
        const candidate = room.players.get(name);
        if (candidate && candidate.isAi) {
          removed = name;
          break;
        }
      }
    }
    if (!removed) {
      return { ok: false, error: 'No AI player to remove.' };
    }
    room.players.delete(removed);
    room.order = room.order.filter((name) => name !== removed);
    return { ok: true };
  }

  function setRulesAction(room, playerName, jokerLocked) {
    if (room.started) {
      return { ok: false, error: 'Game already started.' };
    }
    if (room.hostName !== playerName) {
      return { ok: false, error: 'Only host can change rules.' };
    }
    room.jokerLocked = Boolean(jokerLocked);
    return { ok: true };
  }

  function sortTableAction(room, playerName) {
    if (room.hostName !== playerName) {
      return { ok: false, error: 'Only host can sort the table.' };
    }
    sortRoomTable(room);
    return { ok: true };
  }

  function toggleAutoPlayAction(room, playerName, enabled) {
    const player = room.players.get(playerName);
    if (!player) {
      return { ok: false, error: 'Player not found.' };
    }
    if (player.isAi) {
      return { ok: false, error: 'AI players cannot toggle auto play.' };
    }
    player.autoPlay = Boolean(enabled);
    if (!player.autoPlay && room.currentPlayer === playerName && room.aiTimer) {
      clearTimeout(room.aiTimer);
      room.aiTimer = null;
    }
    return { ok: true };
  }

  function addChatMessage(room, playerName, text) {
    room.chatHistory.push({
      player: playerName,
      text,
      ts: Date.now()
    });
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

  function createRoomState(roomId) {
    return createRoom(roomId);
  }

  return {
    maxPlayers,
    initialMeldPoints,
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
  createRummikubAdapter
};
