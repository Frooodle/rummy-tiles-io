const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const INITIAL_MELD_POINTS = 30;

const rooms = new Map();

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
      initialMeld: INITIAL_MELD_POINTS,
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
    const current = room.players.get(room.currentPlayer);
    if (!isAiPlayer(current)) {
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
    if (meldPoints < INITIAL_MELD_POINTS) {
      return { ok: false, error: `Initial meld must be at least ${INITIAL_MELD_POINTS} points.` };
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
  const plan = createAiPlan(room, player, INITIAL_MELD_POINTS, aiLevel);
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
  let table = createAiTable(room, player, INITIAL_MELD_POINTS, 'basic');
  if (!table) {
    table = createAiTable(room, player, INITIAL_MELD_POINTS, 'advanced');
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
  const seen = new Set();
  const groups = [];
  for (const group of payload) {
    const groupId = String(group.id || '');
    const tileIds = Array.isArray(group.tileIds) ? group.tileIds : [];
    if (!groupId || tileIds.length === 0) {
      return { error: 'Group data invalid.' };
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

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      sendError(ws, 'Invalid message.');
      return;
    }

    if (data.type === 'createRoom') {
      const name = String(data.name || '').trim().slice(0, 12);
      if (!name) {
        sendError(ws, 'Name required.');
        return;
      }
      let roomId = null;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let attempts = 0; attempts < 40; attempts += 1) {
        let candidate = '';
        for (let i = 0; i < 4; i += 1) {
          candidate += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        if (!rooms.has(candidate)) {
          roomId = candidate;
          break;
        }
      }
      if (!roomId) {
        sendError(ws, 'Could not create room. Try again.');
        return;
      }
      const room = createRoom(roomId);
      rooms.set(roomId, room);
      const player = { name, ws, connected: true, hand: [], hasMelded: false, autoPlay: false, aiLevel: 'basic' };
      room.players.set(name, player);
      room.order.push(name);
      room.hostName = name;
      room.scores.set(name, 0);
      ws.roomId = roomId;
      ws.playerName = name;
      broadcastState(room);
      return;
    }

    if (data.type === 'join') {
      const roomId = String(data.roomId || '').trim();
      const name = String(data.name || '').trim().slice(0, 12);
      if (!roomId || !name) {
        sendError(ws, 'Room ID and name required.');
        return;
      }
      let room = rooms.get(roomId);
      if (!room) {
        room = createRoom(roomId);
        rooms.set(roomId, room);
      }
      let player = room.players.get(name);
      if (!player) {
        if (room.order.length >= MAX_PLAYERS) {
          sendError(ws, 'Room is full.');
          return;
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
          sendError(ws, 'Name reserved by AI player.');
          return;
        }
        player.ws = ws;
        player.connected = true;
      }
      ws.roomId = roomId;
      ws.playerName = name;
      broadcastState(room);
      return;
    }

    const roomId = ws.roomId;
    const playerName = ws.playerName;
    if (!roomId || !playerName) {
      sendError(ws, 'Join a room first.');
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      sendError(ws, 'Room not found.');
      return;
    }
    const player = room.players.get(playerName);
    if (!player) {
      sendError(ws, 'Player not found.');
      return;
    }

    if (data.type === 'startGame') {
      if (room.started) {
        sendError(ws, 'Game already started.');
        return;
      }
      if (room.hostName !== playerName) {
        sendError(ws, 'Only host can start.');
        return;
      }
      if (room.order.length < 2) {
        sendError(ws, 'Need at least 2 players to start.');
        return;
      }
      startGame(room);
      broadcastState(room);
      scheduleAiTurn(room);
      return;
    }

    if (data.type === 'addAi') {
      if (room.started) {
        sendError(ws, 'Game already started.');
        return;
      }
      if (room.hostName !== playerName) {
        sendError(ws, 'Only host can add AI.');
        return;
      }
      if (room.order.length >= MAX_PLAYERS) {
        sendError(ws, 'Room is full.');
        return;
      }
      const level = data.level === 'advanced' ? 'advanced' : 'basic';
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
        aiLevel: level
      };
      room.players.set(aiName, aiPlayer);
      room.order.push(aiName);
      broadcastState(room);
      return;
    }

    if (data.type === 'setRules') {
      if (room.started) {
        sendError(ws, 'Game already started.');
        return;
      }
      if (room.hostName !== playerName) {
        sendError(ws, 'Only host can change rules.');
        return;
      }
      room.jokerLocked = Boolean(data.jokerLocked);
      broadcastState(room);
      return;
    }

    if (data.type === 'removeAi') {
      if (room.started) {
        sendError(ws, 'Game already started.');
        return;
      }
      if (room.hostName !== playerName) {
        sendError(ws, 'Only host can remove AI.');
        return;
      }
      const targetName = data.name ? String(data.name) : null;
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
        sendError(ws, 'No AI player to remove.');
        return;
      }
      room.players.delete(removed);
      room.order = room.order.filter((name) => name !== removed);
      broadcastState(room);
      return;
    }

    if (data.type === 'sortTable') {
      if (room.hostName !== playerName) {
        sendError(ws, 'Only host can sort the table.');
        return;
      }
      sortRoomTable(room);
      broadcastState(room);
      return;
    }

    if (data.type === 'toggleAutoPlay') {
      if (player.isAi) {
        sendError(ws, 'AI players cannot toggle auto play.');
        return;
      }
      player.autoPlay = Boolean(data.enabled);
      if (!player.autoPlay && room.currentPlayer === playerName && room.aiTimer) {
        clearTimeout(room.aiTimer);
        room.aiTimer = null;
      }
      broadcastState(room);
      scheduleAiTurn(room);
      return;
    }

    if (data.type === 'hint') {
      const step = Number(data.step) || 1;
      const payload = buildHintPayload(room, player, step);
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
      const normalized = normalizeTablePayload(data.table);
      if (normalized.error) {
        sendError(ws, normalized.error);
        return;
      }
      room.draftTable = null;
      room.draftPlayer = null;
      const result = processSubmitTurn(room, playerName, normalized.table);
      if (!result.ok) {
        sendError(ws, result.error);
        return;
      }
      broadcastState(room);
      scheduleAiTurn(room);
      return;
    }

    if (data.type === 'endTurn') {
      const result = processDrawTurn(room, playerName);
      if (!result.ok) {
        sendError(ws, result.error);
        return;
      }
      broadcastState(room);
      scheduleAiTurn(room);
      return;
    }

    if (data.type === 'draftUpdate') {
      if (Number(data.turnId) !== room.turnId) {
        return;
      }
      if (room.currentPlayer !== playerName) {
        return;
      }
      const normalized = normalizeTablePayload(data.table);
      if (normalized.error) {
        return;
      }
      const draftCheck = sanitizeDraftTable(room, player, normalized.table);
      if (!draftCheck.ok) {
        return;
      }
      room.draftTable = normalized.table.map((group) => ({
        id: group.id,
        tiles: group.tiles.map((tile) => ({ ...tile }))
      }));
      room.draftPlayer = playerName;
      broadcastState(room);
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
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }
    const player = room.players.get(playerName);
    if (!player) {
      return;
    }
    player.connected = false;
    broadcastState(room);
  });
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
