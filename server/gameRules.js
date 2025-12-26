const COLORS = ['red', 'blue', 'black', 'orange'];
const COLOR_ORDER = new Map(COLORS.map((color, index) => [color, index]));

function parseTileId(id) {
  if (typeof id !== 'string') {
    return null;
  }
  if (id.startsWith('joker-')) {
    return { id, color: 'joker', value: 0, joker: true };
  }
  const parts = id.split('-');
  if (parts.length !== 3) {
    return null;
  }
  const color = parts[0];
  const value = Number(parts[1]);
  const copy = Number(parts[2]);
  if (!COLORS.includes(color)) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > 13) {
    return null;
  }
  if (!Number.isInteger(copy) || (copy !== 0 && copy !== 1)) {
    return null;
  }
  return { id, color, value, joker: false };
}

function isValidGroup(tiles) {
  if (tiles.length < 3) {
    return false;
  }
  if (isValidSet(tiles)) {
    return true;
  }
  return isValidRun(tiles);
}

function isValidSet(tiles) {
  if (tiles.length > 4) {
    return false;
  }
  const nonJokers = tiles.filter((tile) => !tile.joker);
  if (nonJokers.length === 0) {
    return true;
  }
  const value = nonJokers[0].value;
  if (nonJokers.some((tile) => tile.value !== value)) {
    return false;
  }
  const colors = new Set(nonJokers.map((tile) => tile.color));
  return colors.size === nonJokers.length;
}

function isValidRun(tiles) {
  const nonJokers = tiles.filter((tile) => !tile.joker);
  if (nonJokers.length === 0) {
    return true;
  }
  const color = nonJokers[0].color;
  if (nonJokers.some((tile) => tile.color !== color)) {
    return false;
  }
  const values = nonJokers.map((tile) => tile.value).sort((a, b) => a - b);
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === values[i - 1]) {
      return false;
    }
  }
  const jokerCount = tiles.length - nonJokers.length;
  let neededJokers = 0;
  for (let i = 1; i < values.length; i += 1) {
    neededJokers += values[i] - values[i - 1] - 1;
  }
  if (neededJokers > jokerCount) {
    return false;
  }
  const remaining = jokerCount - neededJokers;
  const min = values[0];
  const max = values[values.length - 1];
  const roomToExtend = (min - 1) + (13 - max);
  return roomToExtend >= remaining;
}

function maxConsecutiveSum(length) {
  const start = 14 - length;
  return (length * (2 * start + length - 1)) / 2;
}

function maxRunValue(tiles) {
  const nonJokers = tiles.filter((tile) => !tile.joker);
  const length = tiles.length;
  if (nonJokers.length === 0) {
    return maxConsecutiveSum(length);
  }
  const values = nonJokers.map((tile) => tile.value).sort((a, b) => a - b);
  const minValue = values[0];
  const maxValue = values[values.length - 1];
  const startMin = Math.max(1, maxValue - length + 1);
  const startMax = Math.min(minValue, 14 - length);
  if (startMin > startMax) {
    return null;
  }
  const start = startMax;
  return (length * (2 * start + length - 1)) / 2;
}

function groupMeldValue(tiles) {
  if (isValidSet(tiles)) {
    const nonJokers = tiles.filter((tile) => !tile.joker);
    if (nonJokers.length === 0) {
      return 13 * tiles.length;
    }
    return nonJokers[0].value * tiles.length;
  }
  if (isValidRun(tiles)) {
    return maxRunValue(tiles) || 0;
  }
  return 0;
}

function handPoints(hand) {
  return hand.reduce((sum, tile) => sum + (tile.joker ? 30 : tile.value), 0);
}

function normalizeGroupTiles(tiles) {
  if (!tiles || tiles.length === 0) {
    return [];
  }
  if (isValidSet(tiles)) {
    const nonJokers = tiles.filter((tile) => !tile.joker);
    const jokers = tiles.filter((tile) => tile.joker);
    nonJokers.sort((a, b) => (COLOR_ORDER.get(a.color) ?? 99) - (COLOR_ORDER.get(b.color) ?? 99));
    return [...nonJokers, ...jokers];
  }
  if (isValidRun(tiles)) {
    const nonJokers = tiles.filter((tile) => !tile.joker).sort((a, b) => a.value - b.value);
    const jokers = tiles.filter((tile) => tile.joker).slice();
    if (nonJokers.length === 0) {
      return jokers;
    }
    let min = nonJokers[0].value;
    let max = nonJokers[nonJokers.length - 1].value;
    const tileByValue = new Map(nonJokers.map((tile) => [tile.value, tile]));

    const values = [];
    for (let v = min; v <= max; v += 1) {
      values.push(v);
    }
    const missing = values.filter((v) => !tileByValue.has(v));
    missing.forEach((value) => {
      if (jokers.length) {
        tileByValue.set(value, jokers.shift());
      }
    });
    while (jokers.length && max < 13) {
      max += 1;
      tileByValue.set(max, jokers.shift());
    }
    while (jokers.length && min > 1) {
      min -= 1;
      tileByValue.set(min, jokers.shift());
    }
    const ordered = [];
    for (let v = min; v <= max; v += 1) {
      if (tileByValue.has(v)) {
        ordered.push(tileByValue.get(v));
      }
    }
    ordered.push(...jokers);
    return ordered;
  }
  return tiles.slice();
}

module.exports = {
  COLORS,
  parseTileId,
  isValidGroup,
  isValidSet,
  isValidRun,
  groupMeldValue,
  handPoints,
  normalizeGroupTiles
};
