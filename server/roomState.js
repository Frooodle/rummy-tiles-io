const { COLORS, handPoints } = require('./gameRules');

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function makeTiles() {
  const tiles = [];
  for (const color of COLORS) {
    for (let value = 1; value <= 13; value += 1) {
      for (let copy = 0; copy < 2; copy += 1) {
        tiles.push({ id: `${color}-${value}-${copy}`, color, value, joker: false });
      }
    }
  }
  tiles.push({ id: 'joker-0', color: 'joker', value: 0, joker: true });
  tiles.push({ id: 'joker-1', color: 'joker', value: 0, joker: true });
  return tiles;
}

function cloneTable(table) {
  return table.map((group) => ({
    id: group.id,
    tiles: group.tiles.map((tile) => ({ ...tile }))
  }));
}

function tableTileIds(table) {
  const ids = [];
  table.forEach((group) => {
    group.tiles.forEach((tile) => ids.push(tile.id));
  });
  return ids;
}

function tableSignature(table) {
  const map = new Map();
  table.forEach((group) => {
    const signature = group.tiles.map((tile) => tile.id).sort().join('|');
    map.set(signature, (map.get(signature) || 0) + 1);
  });
  return map;
}

function createRoom(roomId) {
  return {
    id: roomId,
    players: new Map(),
    order: [],
    hostName: null,
    started: false,
    roundOver: false,
    winner: null,
    table: [],
    deck: [],
    currentPlayer: null,
    turnId: 0,
    turnStartTable: [],
    nextGroupId: 1,
    noPlayTurns: 0,
    round: 0,
    scores: new Map(),
    aiCounter: 0,
    lastMove: null,
    draftTable: null,
    draftPlayer: null,
    moveHistory: [],
    moveHistoryDetailed: [],
    jokerLocked: false,
    chatHistory: [],
    lastActivity: Date.now()
  };
}

function startTurn(room, playerName) {
  room.currentPlayer = playerName;
  room.turnId += 1;
  room.turnStartTable = cloneTable(room.table);
  room.draftTable = null;
  room.draftPlayer = null;
}

function startGame(room) {
  const tiles = shuffle(makeTiles());
  room.table = [];
  room.deck = tiles;
  room.winner = null;
  room.roundOver = false;
  room.started = true;
  room.nextGroupId = 1;
  room.noPlayTurns = 0;
  room.round += 1;
  room.lastMove = null;
  room.moveHistory = [];
  room.moveHistoryDetailed = [];
  room.jokerLocked = Boolean(room.jokerLocked);
  room.chatHistory = room.chatHistory || [];

  room.order.forEach((name) => {
    const player = room.players.get(name);
    if (player) {
      player.hand = room.deck.splice(0, 13);
      player.hasMelded = false;
      if (!room.scores.has(name)) {
        room.scores.set(name, 0);
      }
    }
  });

  const randomIndex = Math.floor(Math.random() * room.order.length);
  startTurn(room, room.order[randomIndex]);
}

function applyScores(room, winnerName) {
  let total = 0;
  room.order.forEach((name) => {
    if (name === winnerName) {
      return;
    }
    const player = room.players.get(name);
    if (!player) {
      return;
    }
    const points = handPoints(player.hand);
    total += points;
    room.scores.set(name, (room.scores.get(name) || 0) - points);
  });
  room.scores.set(winnerName, (room.scores.get(winnerName) || 0) + total);
  room.winner = winnerName;
  room.roundOver = true;
  room.started = false;
}

function endRoundStalemate(room) {
  let winnerName = null;
  let bestScore = null;
  room.order.forEach((name) => {
    const player = room.players.get(name);
    if (!player) {
      return;
    }
    const points = handPoints(player.hand);
    if (bestScore === null || points < bestScore) {
      bestScore = points;
      winnerName = name;
    }
  });
  if (winnerName) {
    applyScores(room, winnerName);
  }
}

function findNextPlayer(room, fromName) {
  if (room.order.length === 0) {
    return null;
  }
  const startIndex = room.order.indexOf(fromName);
  for (let offset = 1; offset <= room.order.length; offset += 1) {
    const name = room.order[(startIndex + offset) % room.order.length];
    const player = room.players.get(name);
    if (player && player.connected) {
      return name;
    }
  }
  return room.order[startIndex] || null;
}

module.exports = {
  createRoom,
  startGame,
  startTurn,
  applyScores,
  endRoundStalemate,
  cloneTable,
  tableTileIds,
  tableSignature,
  findNextPlayer
};
