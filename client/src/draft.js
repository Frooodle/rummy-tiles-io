export function cloneTable(table) {
  return table.map((group) => ({
    id: group.id,
    tiles: group.tiles.map((tile) => ({ ...tile }))
  }));
}

export function sortTiles(a, b) {
  const colorOrder = ['red', 'blue', 'black', 'orange', 'joker'];
  const colorDiff = colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color);
  if (colorDiff !== 0) {
    return colorDiff;
  }
  const valueA = a.joker ? 99 : a.value;
  const valueB = b.joker ? 99 : b.value;
  return valueA - valueB;
}

export function sortTilesByValue(a, b) {
  const valueA = a.joker ? 99 : a.value;
  const valueB = b.joker ? 99 : b.value;
  const valueDiff = valueA - valueB;
  if (valueDiff !== 0) {
    return valueDiff;
  }
  const colorOrder = ['red', 'blue', 'black', 'orange', 'joker'];
  return colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color);
}

function isSet(tiles) {
  const nonJokers = tiles.filter((tile) => !tile.joker);
  if (nonJokers.length === 0) {
    return true;
  }
  const value = nonJokers[0].value;
  return nonJokers.every((tile) => tile.value === value);
}

function isRun(tiles) {
  const nonJokers = tiles.filter((tile) => !tile.joker);
  if (nonJokers.length === 0) {
    return true;
  }
  const color = nonJokers[0].color;
  return nonJokers.every((tile) => tile.color === color);
}

export function normalizeGroupTilesForDisplay(tiles) {
  if (!tiles || tiles.length === 0) {
    return [];
  }
  if (isSet(tiles)) {
    const nonJokers = tiles.filter((tile) => !tile.joker).sort(sortTiles);
    const jokers = tiles.filter((tile) => tile.joker);
    return [...nonJokers, ...jokers];
  }
  if (isRun(tiles)) {
    const nonJokers = tiles.filter((tile) => !tile.joker).sort(sortTilesByValue);
    const jokers = tiles.filter((tile) => tile.joker).slice();
    if (nonJokers.length === 0) {
      return jokers;
    }
    let min = nonJokers[0].value;
    let max = nonJokers[nonJokers.length - 1].value;
    const tileByValue = new Map(nonJokers.map((tile) => [tile.value, tile]));
    for (let v = min; v <= max; v += 1) {
      if (!tileByValue.has(v) && jokers.length) {
        tileByValue.set(v, jokers.shift());
      }
    }
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

export function isValidGroupClient(tiles) {
  if (!tiles || tiles.length < 3) {
    return false;
  }
  return isValidSetClient(tiles) || isValidRunClient(tiles);
}

export function isValidTableClient(table) {
  if (!Array.isArray(table)) {
    return false;
  }
  for (const group of table) {
    if (!isValidGroupClient(group.tiles)) {
      return false;
    }
  }
  return true;
}

function isValidSetClient(tiles) {
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

function isValidRunClient(tiles) {
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

export function collectSelectedTiles(table, selection, hand) {
  const tiles = [];
  const tableMap = new Map();
  table.forEach((group) => {
    group.tiles.forEach((tile) => tableMap.set(tile.id, tile));
  });
  const handMap = new Map();
  hand.forEach((tile) => handMap.set(tile.id, tile));
  selection.forEach((id) => {
    if (tableMap.has(id)) {
      tiles.push(tableMap.get(id));
      return;
    }
    if (handMap.has(id)) {
      tiles.push(handMap.get(id));
    }
  });
  return tiles.sort(sortTiles);
}

export function findTileById(table, hand, tileId) {
  for (const group of table) {
    const tile = group.tiles.find((entry) => entry.id === tileId);
    if (tile) {
      return tile;
    }
  }
  return hand.find((tile) => tile.id === tileId) || null;
}

export function findGroupByTileId(table, tileId) {
  for (const group of table) {
    if (group.tiles.some((tile) => tile.id === tileId)) {
      return group;
    }
  }
  return null;
}

export function removeTileById(table, tileId) {
  return table.map((group) => ({
    id: group.id,
    tiles: group.tiles.filter((tile) => tile.id !== tileId)
  })).filter((group) => group.tiles.length > 0);
}

export function pushHistory(draft) {
  if (!draft.history) {
    draft.history = [];
  }
  draft.history.push({
    table: cloneTable(draft.table || []),
    selected: Array.from(draft.selectedTiles || [])
  });
  if (draft.history.length > 50) {
    draft.history.shift();
  }
}

export function undoHistory(draft) {
  if (!draft.history || draft.history.length === 0) {
    return false;
  }
  const entry = draft.history.pop();
  draft.table = entry.table || [];
  draft.selectedTiles = new Set(entry.selected || []);
  return true;
}

export function removeSelectedFromDraft(table, selection) {
  const next = table.map((group) => ({
    id: group.id,
    tiles: group.tiles.filter((tile) => !selection.has(tile.id))
  })).filter((group) => group.tiles.length > 0);
  return { table: next };
}

export function serializeTable(table) {
  return table.map((group) => ({
    id: group.id,
    tileIds: group.tiles.map((tile) => tile.id)
  }));
}

export function syncDraftState(state, draft) {
  if (!state || !state.you) {
    draft.table = null;
    draft.turnId = null;
    draft.history = [];
    draft.dragIds = [];
    return;
  }
  const yourTurn = state.started && !state.winner && state.currentPlayer === state.you.name;
  if (!yourTurn) {
    draft.table = null;
    draft.turnId = null;
    draft.history = [];
    draft.dragIds = [];
    return;
  }
  if (!draft.table || draft.turnId !== state.turnId) {
    draft.table = cloneTable(state.table);
    draft.turnId = state.turnId;
    draft.selectedTiles.clear();
    draft.groupCounter = 0;
    draft.history = [];
    draft.dragIds = [];
  }
}

export function pruneSelection(state, draft) {
  if (!draft.selectedTiles.size || !state || !state.you) {
    return;
  }
  const ids = new Set();
  state.you.hand.forEach((tile) => ids.add(tile.id));
  if (draft.table) {
    draft.table.forEach((group) => group.tiles.forEach((tile) => ids.add(tile.id)));
  }
  draft.selectedTiles.forEach((id) => {
    if (!ids.has(id)) {
      draft.selectedTiles.delete(id);
    }
  });
}

export function buildTableContext(state, draft) {
  const baseTableIds = new Set();
  state.table.forEach((group) => group.tiles.forEach((tile) => baseTableIds.add(tile.id)));
  const activeTable = draft.table ? draft.table : state.table;
  const draftIds = new Set();
  if (activeTable) {
    activeTable.forEach((group) => group.tiles.forEach((tile) => draftIds.add(tile.id)));
  }
  const stagedFromHand = new Set();
  draftIds.forEach((id) => {
    if (!baseTableIds.has(id)) {
      stagedFromHand.add(id);
    }
  });
  return { baseTableIds, activeTable, stagedFromHand };
}
