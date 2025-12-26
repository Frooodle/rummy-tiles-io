const { isValidGroup, groupMeldValue } = require('./gameRules');
const { cloneTable } = require('./roomState');

function generateGroups(hand, minSize, maxSize) {
  const results = [];
  const n = hand.length;

  function walk(start, count, size, bucket) {
    if (bucket.length === size) {
      if (isValidGroup(bucket)) {
        results.push({ tiles: bucket.slice(), value: groupMeldValue(bucket) });
      }
      return;
    }
    if (start >= n) {
      return;
    }
    for (let i = start; i < n; i += 1) {
      bucket.push(hand[i]);
      walk(i + 1, count + 1, size, bucket);
      bucket.pop();
    }
  }

  for (let size = minSize; size <= maxSize; size += 1) {
    walk(0, 0, size, []);
  }

  return results;
}

function pickInitialMeld(groups, threshold) {
  const sorted = groups.slice().sort((a, b) => b.value - a.value);

  function dfs(index, used, total, picks) {
    if (total >= threshold) {
      return picks.slice();
    }
    if (index >= sorted.length) {
      return null;
    }
    for (let i = index; i < sorted.length; i += 1) {
      const group = sorted[i];
      const overlap = group.tiles.some((tile) => used.has(tile.id));
      if (overlap) {
        continue;
      }
      group.tiles.forEach((tile) => used.add(tile.id));
      picks.push(group);
      const found = dfs(i + 1, used, total + group.value, picks);
      if (found) {
        return found;
      }
      picks.pop();
      group.tiles.forEach((tile) => used.delete(tile.id));
    }
    return null;
  }

  return dfs(0, new Set(), 0, []);
}

function addTilesToGroups(table, hand) {
  const remaining = [];
  const moved = [];

  hand.forEach((tile) => {
    let placed = false;
    for (const group of table) {
      const candidate = [...group.tiles, tile];
      if (isValidGroup(candidate)) {
        group.tiles.push(tile);
        moved.push(tile);
        placed = true;
        break;
      }
    }
    if (!placed) {
      remaining.push(tile);
    }
  });

  return { remaining, moved };
}

function addNewGroupsFromHand(table, hand) {
  const groups = generateGroups(hand, 3, 5).sort((a, b) => b.value - a.value);
  const used = new Set();
  const remaining = hand.slice();

  groups.forEach((group) => {
    const overlap = group.tiles.some((tile) => used.has(tile.id));
    if (overlap) {
      return;
    }
    group.tiles.forEach((tile) => used.add(tile.id));
    table.push({ id: `ai-${Date.now()}-${Math.random()}`, tiles: group.tiles.slice() });
  });

  const filtered = remaining.filter((tile) => !used.has(tile.id));
  return { remaining: filtered, used };
}

function buildInitialMeldPlan(room, picks) {
  const base = cloneTable(room.table);
  const steps = [];
  const working = cloneTable(base);
  picks.forEach((group) => {
    working.push({ id: `ai-${Date.now()}-${Math.random()}`, tiles: group.tiles.slice() });
    steps.push(cloneTable(working));
  });
  return { table: working, steps };
}

function scoreGroupPick(group, hand) {
  const handIds = new Set(hand.map((tile) => tile.id));
  const handUsed = group.tiles.filter((tile) => handIds.has(tile.id));
  return {
    value: groupMeldValue(group.tiles),
    handUsedCount: handUsed.length
  };
}

function buildTableWithMovedTiles(room, player, maxMoved = 2) {
  const baseTable = cloneTable(room.table);
  const hand = player.hand.slice();
  const tableRefs = [];
  baseTable.forEach((group, groupIndex) => {
    group.tiles.forEach((tile) => {
      tableRefs.push({ tile, groupIndex });
    });
  });

  let best = null;

  function evaluateCombo(refs) {
    const movedTiles = refs.map((ref) => ref.tile);
    const removals = new Map();
    refs.forEach((ref) => {
      const list = removals.get(ref.groupIndex) || [];
      list.push(ref.tile.id);
      removals.set(ref.groupIndex, list);
    });

    const nextTable = [];
    for (let i = 0; i < baseTable.length; i += 1) {
      const group = baseTable[i];
      const removeIds = removals.get(i);
      if (!removeIds) {
        nextTable.push({ id: group.id, tiles: group.tiles.slice() });
        continue;
      }
      const remaining = group.tiles.filter((tile) => !removeIds.includes(tile.id));
      if (remaining.length === 0) {
        continue;
      }
      if (!isValidGroup(remaining)) {
        return null;
      }
      nextTable.push({ id: group.id, tiles: remaining });
    }

    const pool = [...movedTiles, ...hand];
    const candidateGroups = generateGroups(pool, 3, 5)
      .filter((entry) => movedTiles.every((tile) => entry.tiles.some((cand) => cand.id === tile.id)))
      .filter((entry) => entry.tiles.some((tile) => hand.some((h) => h.id === tile.id)));

    if (candidateGroups.length === 0) {
      return null;
    }

    candidateGroups.sort((a, b) => {
      const scoreA = scoreGroupPick(a, hand);
      const scoreB = scoreGroupPick(b, hand);
      if (scoreB.value !== scoreA.value) {
        return scoreB.value - scoreA.value;
      }
      return scoreB.handUsedCount - scoreA.handUsedCount;
    });

    const bestGroup = candidateGroups[0];
    const usedHandIds = new Set(bestGroup.tiles.filter((tile) => hand.some((h) => h.id === tile.id)).map((tile) => tile.id));
    const tableWithGroup = cloneTable(nextTable);
    tableWithGroup.push({ id: `ai-${Date.now()}-${Math.random()}`, tiles: bestGroup.tiles.slice() });

    const remainingHand = hand.filter((tile) => !usedHandIds.has(tile.id));
    const tableAfterAdds = cloneTable(tableWithGroup);
    const added = addTilesToGroups(tableAfterAdds, remainingHand);
    const afterGroups = addNewGroupsFromHand(tableAfterAdds, added.remaining);

    const steps = [];
    steps.push(cloneTable(nextTable));
    steps.push(cloneTable(tableWithGroup));
    if (added.moved.length > 0 || afterGroups.used.size > 0) {
      steps.push(cloneTable(tableAfterAdds));
    }

    const score = scoreGroupPick(bestGroup, hand);
    return {
      table: tableAfterAdds,
      steps,
      value: score.value,
      handUsedCount: score.handUsedCount,
      movedCount: movedTiles.length
    };
  }

  for (let i = 0; i < tableRefs.length; i += 1) {
    const single = evaluateCombo([tableRefs[i]]);
    if (single) {
      if (!best || single.value > best.value || (single.value === best.value && single.handUsedCount > best.handUsedCount)) {
        best = single;
      }
    }
    if (maxMoved < 2) {
      continue;
    }
    for (let j = i + 1; j < tableRefs.length; j += 1) {
      const combo = evaluateCombo([tableRefs[i], tableRefs[j]]);
      if (combo) {
        if (!best
          || combo.value > best.value
          || (combo.value === best.value && combo.handUsedCount > best.handUsedCount)
          || (combo.value === best.value && combo.handUsedCount === best.handUsedCount && combo.movedCount > best.movedCount)) {
          best = combo;
        }
      }
    }
  }

  return best ? { table: best.table, steps: best.steps } : null;
}

function createAiTable(room, player, initialMeldPoints, level = 'basic') {
  const plan = createAiPlan(room, player, initialMeldPoints, level);
  if (!plan) {
    return null;
  }
  return plan.table;
}

function createAiPlan(room, player, initialMeldPoints, level = 'basic') {
  const hand = player.hand.slice();
  const table = cloneTable(room.table);

  if (!player.hasMelded) {
    const groups = generateGroups(hand, 3, 5);
    const picks = pickInitialMeld(groups, initialMeldPoints);
    if (!picks || picks.length === 0) {
      return null;
    }
    return buildInitialMeldPlan(room, picks);
  }

  const added = addTilesToGroups(table, hand);
  const afterGroups = addNewGroupsFromHand(table, added.remaining);

  if (added.moved.length === 0 && afterGroups.used.size === 0) {
    if (level === 'advanced') {
      return buildTableWithMovedTiles(room, player, 2);
    }
    return null;
  }

  const steps = [];
  steps.push(cloneTable(table));
  return { table, steps };
}

module.exports = {
  createAiTable,
  createAiPlan
};
