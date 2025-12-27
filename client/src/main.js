import './style.css';
import { createSocketManager } from './socket.js';
import {
  cloneTable,
  collectSelectedTiles,
  findTileById,
  findGroupByTileId,
  isValidGroupClient,
  normalizeGroupTilesForDisplay,
  removeTileById,
  removeSelectedFromDraft,
  pushHistory,
  undoHistory,
  serializeTable,
  syncDraftState,
  pruneSelection,
  buildTableContext
} from './draft.js';
import { renderJoin, renderGame } from './render.js';

const app = document.querySelector('#app');

let state = null;
let errorMessage = '';
let disconnectNoticeTimer = null;
let showHelp = false;

const draft = {
  table: null,
  turnId: null,
  groupCounter: 0,
  selectedTiles: new Set(),
  history: [],
  dragIds: []
};

let dragTileId = null;
let sortMode = 'color';
let handOrder = [];
let dragMode = null;
let dragGroupId = null;
let dragGroupOverId = null;
let dragGroupOverSide = null;
let lastHandIds = [];
let lastDrawnId = null;
let hintMessage = '';
let hintStep = 0;
let lastHintTurnId = null;
let draftDirty = false;
let groupFaceMode = localStorage.getItem('rummi-group-face') || 'transparent';
let colorBlindMode = localStorage.getItem('rummi-colorblind') !== 'false';
let themeMode = localStorage.getItem('rummi-theme') || 'light';
const debugEnabled = true;
let lastStateSummary = null;

const storedRoom = localStorage.getItem('rummi-room') || '';
const storedName = localStorage.getItem('rummi-name') || '';
const urlRoom = new URLSearchParams(window.location.search).get('room') || '';
const initialRoom = urlRoom || storedRoom;
let joinMode = initialRoom ? 'join' : 'create';

function onState(nextState) {
  state = nextState;
  errorMessage = '';
  hintMessage = '';
  if (disconnectNoticeTimer) {
    clearTimeout(disconnectNoticeTimer);
    disconnectNoticeTimer = null;
  }
  if (state && state.turnId !== lastHintTurnId) {
    hintStep = 0;
    lastHintTurnId = state.turnId;
  }
  debugStateDiff(nextState);
  if (state && state.roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomId);
    window.history.replaceState({}, '', url.toString());
    localStorage.setItem('rummi-room', state.roomId);
    socket.setReconnectPayload({ type: 'join', roomId: state.roomId, name: state.you.name });
  }
  syncDraftState(state, draft);
  pruneSelection(state, draft);
  updateDrawHighlight();
  syncHandOrder();
  draftDirty = false;
  render();
}

function onError(message) {
  errorMessage = message;
  render();
}

function onClose() {
  if (disconnectNoticeTimer) {
    clearTimeout(disconnectNoticeTimer);
  }
  disconnectNoticeTimer = setTimeout(() => {
    errorMessage = 'Disconnected. Trying to reconnect...';
    render();
  }, 1200);
  render();
}

const socket = createSocketManager({
  onState,
  onHint: (payload) => {
    hintMessage = buildHintMessage(payload, hintStep);
    render();
  },
  onError,
  onClose
});

function joinRoom(roomId, name, mode) {
  if (!name) {
    errorMessage = 'Name is required.';
    render();
    return;
  }
  if (mode === 'join' && !roomId) {
    errorMessage = 'Room ID is required to join.';
    render();
    return;
  }
  localStorage.setItem('rummi-name', name);
  const payload = mode === 'create'
    ? { type: 'createRoom', name }
    : { type: 'join', roomId, name };
  socket.connect(payload);
}

function startRound() {
  socket.send({ type: 'startGame' });
}

function drawTile() {
  if (hasDraftChanges()) {
    const ok = window.confirm('Are you sure you want to draw? You have changes in your draft.');
    if (!ok) {
      return;
    }
  }
  debugLog('draw', { turnId: state ? state.turnId : null });
  socket.send({ type: 'endTurn' });
  lastDrawnId = null;
}

function submitTurn() {
  if (!draft.table || !state) {
    return;
  }
  debugLog('submitTurn', { turnId: state.turnId, tiles: flattenTableIds(draft.table) });
  socket.send({
    type: 'submitTurn',
    turnId: state.turnId,
    table: serializeTable(draft.table)
  });
  draft.selectedTiles.clear();
  hintMessage = '';
  lastDrawnId = null;
  draftDirty = false;
}

function sortTable() {
  socket.send({ type: 'sortTable' });
}

function addAi(level = 'basic') {
  socket.send({ type: 'addAi', level });
}

function removeAi() {
  socket.send({ type: 'removeAi' });
}

function toggleAutoPlay(enabled) {
  socket.send({ type: 'toggleAutoPlay', enabled });
}

function setRules(jokerLocked) {
  socket.send({ type: 'setRules', jokerLocked });
}

function setSortMode(mode) {
  sortMode = mode;
  if (sortMode !== 'shuffle') {
    handOrder = [];
  }
  render();
}

function shuffleHand() {
  if (!state || !state.you) {
    return;
  }
  sortMode = 'shuffle';
  handOrder = state.you.hand.map((tile) => tile.id);
  for (let i = handOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [handOrder[i], handOrder[j]] = [handOrder[j], handOrder[i]];
  }
  render();
}

function cycleGroupFace() {
  const modes = ['classic', 'transparent', 'inset'];
  const index = modes.indexOf(groupFaceMode);
  groupFaceMode = modes[(index + 1) % modes.length];
  localStorage.setItem('rummi-group-face', groupFaceMode);
  render();
}

function toggleColorBlind() {
  colorBlindMode = !colorBlindMode;
  localStorage.setItem('rummi-colorblind', String(colorBlindMode));
  render();
}

function toggleTheme() {
  themeMode = themeMode === 'dark' ? 'light' : 'dark';
  localStorage.setItem('rummi-theme', themeMode);
  render();
}

function toggleHelp() {
  showHelp = !showHelp;
  render();
}

function sendChat(text) {
  if (!text) {
    return;
  }
  socket.send({ type: 'chat', text });
}

function resetDraft() {
  if (!state) {
    return;
  }
  draft.table = cloneTable(state.table);
  draft.selectedTiles.clear();
  draft.history = [];
  hintMessage = '';
  draftDirty = false;
  sendDraftUpdate();
  render();
}

function undoDraft() {
  if (undoHistory(draft)) {
    draftDirty = draft.history.length > 0;
    render();
  }
}


function createGroup() {
  if (!draft.table || !state) {
    return;
  }
  const selected = collectSelectedTiles(draft.table, draft.selectedTiles, state.you.hand);
  if (selected.length < 3 || !isValidGroupClient(selected)) {
    hintMessage = 'Selection does not make a valid group.';
    render();
    return;
  }
  const removalIssue = getRemovalIssue(draft.table, selected.map((tile) => tile.id));
  if (removalIssue) {
    hintMessage = `Removing those tiles would leave a group with ${removalIssue.remaining} tile${removalIssue.remaining === 1 ? '' : 's'}.`;
    render();
    return;
  }
  pushHistory(draft);
  const next = removeSelectedFromDraft(draft.table, draft.selectedTiles).table;
  draft.groupCounter += 1;
  next.push({ id: `draft-${draft.turnId}-${draft.groupCounter}`, tiles: normalizeGroupTilesForDisplay(selected) });
  draft.table = next;
  draft.selectedTiles.clear();
  draftDirty = true;
  hintMessage = '';
  sendDraftUpdate();
  render();
}

function addSelectedToGroup(groupId) {
  if (!draft.table || !state) {
    return;
  }
  const selected = collectSelectedTiles(draft.table, draft.selectedTiles, state.you.hand);
  if (selected.length === 0) {
    return;
  }
  const targetOriginal = draft.table.find((entry) => entry.id === groupId);
  if (targetOriginal) {
    const candidate = [...targetOriginal.tiles, ...selected];
    if (!isValidGroupClient(candidate)) {
      hintMessage = 'That move does not make a valid group.';
      debugLog('addSelectedRejected', {
        groupId,
        selected: selected.map((tile) => tile.id),
        targetBefore: targetOriginal.tiles.map((tile) => tile.id)
      });
      render();
      return;
    }
  }
  if (!canRemoveFromGroups(draft.table, selected.map((tile) => tile.id))) {
    hintMessage = 'Removing those tiles would leave a group under 3 tiles.';
    render();
    return;
  }
  debugLog('addSelected', {
    groupId,
    selected: selected.map((tile) => tile.id),
    selectedFrom: {
      hand: selected.filter((tile) => state.you.hand.some((h) => h.id === tile.id)).map((tile) => tile.id),
      table: selected.filter((tile) => !state.you.hand.some((h) => h.id === tile.id)).map((tile) => tile.id)
    }
  });
  pushHistory(draft);
  const next = removeSelectedFromDraft(draft.table, draft.selectedTiles).table;
  const target = next.find((entry) => entry.id === groupId);
  if (target) {
    debugLog('addSelectedTargetBefore', {
      groupId,
      tiles: target.tiles.map((tile) => tile.id)
    });
    target.tiles = normalizeGroupTilesForDisplay([...target.tiles, ...selected]);
    debugLog('addSelectedTargetAfter', {
      groupId,
      tiles: target.tiles.map((tile) => tile.id)
    });
  }
  draft.table = next;
  draft.selectedTiles.clear();
  draftDirty = true;
  hintMessage = '';
  sendDraftUpdate();
  render();
}

function toggleTile(id) {
  pushHistory(draft);
  if (draft.selectedTiles.has(id)) {
    draft.selectedTiles.delete(id);
  } else {
    draft.selectedTiles.add(id);
  }
  debugLog('toggleTile', { id, selected: Array.from(draft.selectedTiles) });
  render();
}

function startDrag(event, tileId) {
  dragTileId = tileId;
  dragMode = 'tile';
  dragGroupId = null;
  const ids = event.shiftKey && draft.selectedTiles.has(tileId)
    ? Array.from(draft.selectedTiles)
    : [tileId];
  draft.dragIds = ids;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/json', JSON.stringify(ids));
  const tile = state ? findTileById(draft.table || [], state.you.hand, tileId) : null;
  if (tile) {
    const ghost = document.createElement('div');
    ghost.className = `tile ${tile.color}`;
    ghost.textContent = ids.length > 1 ? `${ids.length}x` : (tile.joker ? 'J' : tile.value);
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    ghost.style.left = '-1000px';
    ghost.style.transform = 'rotate(-3deg)';
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 22, 32);
    requestAnimationFrame(() => ghost.remove());
  }
  render();
}

function endDrag() {
  dragTileId = null;
  draft.dragIds = [];
  dragMode = null;
  dragGroupId = null;
  dragGroupOverId = null;
  dragGroupOverSide = null;
  render();
}

function getDragIds(event) {
  if (dragMode === 'group') {
    return [];
  }
  if (draft.dragIds && draft.dragIds.length) {
    return draft.dragIds;
  }
  if (!event || !event.dataTransfer) {
    return [];
  }
  const payload = event.dataTransfer.getData('application/json');
  if (payload) {
    try {
      const ids = JSON.parse(payload);
      return Array.isArray(ids) ? ids : [];
    } catch (error) {
      return [];
    }
  }
  const single = event.dataTransfer.getData('text/plain');
  return single ? [single] : [];
}

function getGroupDragId(event) {
  if (dragMode === 'group' && dragGroupId) {
    return dragGroupId;
  }
  if (!event || !event.dataTransfer) {
    return null;
  }
  const payload = event.dataTransfer.getData('application/x-tile-rummy-group');
  if (payload) {
    return payload;
  }
  const plain = event.dataTransfer.getData('text/plain');
  return plain || null;
}

function dropOnGroup(groupId, event) {
  if (!draft.table || !state) {
    return;
  }
  const groupDragId = getGroupDragId(event);
  if (groupDragId) {
    if (groupDragId === groupId) {
      return;
    }
    pushHistory(draft);
    const next = draft.table.filter((group) => group.id !== groupDragId);
    let targetIndex = next.findIndex((group) => group.id === groupId);
    const dragged = draft.table.find((group) => group.id === groupDragId);
    if (!dragged || targetIndex === -1) {
      return;
    }
    if (dragGroupOverSide === 'after') {
      targetIndex += 1;
    }
    next.splice(targetIndex, 0, dragged);
    draft.table = next;
    draftDirty = true;
    hintMessage = '';
    dragGroupOverId = null;
    dragGroupOverSide = null;
    debugLog('moveGroup', {
      from: groupDragId,
      to: groupId,
      order: next.map((group) => group.id)
    });
    sendDraftUpdate();
    render();
    return;
  }
  const tileIds = getDragIds(event);
  dragTileId = null;
  draft.dragIds = [];
  if (!tileIds.length) {
    return;
  }
  const tiles = tileIds.map((id) => findTileById(draft.table, state.you.hand, id)).filter(Boolean);
  if (!tiles.length) {
    return;
  }
  if (!canRemoveFromGroups(draft.table, tileIds)) {
    const removalIssue = getRemovalIssue(draft.table, tileIds);
    hintMessage = removalIssue
      ? `Removing those tiles would leave a group with ${removalIssue.remaining} tile${removalIssue.remaining === 1 ? '' : 's'}.`
      : 'Removing those tiles would leave a group under 3 tiles.';
    render();
    return;
  }
  pushHistory(draft);
  let next = draft.table;
  tileIds.forEach((id) => {
    next = removeTileById(next, id);
  });
  const target = next.find((group) => group.id === groupId);
  if (target) {
    const candidate = [...target.tiles, ...tiles];
    if (!isValidGroupClient(candidate)) {
      hintMessage = 'That move does not make a valid group.';
      debugLog('dropRejected', { groupId, tiles: tileIds });
      render();
      return;
    }
    debugLog('dropTarget', {
      groupId,
      targetBefore: target.tiles.map((tile) => tile.id),
      moving: tileIds
    });
    target.tiles = normalizeGroupTilesForDisplay(candidate);
    debugLog('dropApplied', {
      groupId,
      targetAfter: target.tiles.map((tile) => tile.id),
      order: next.map((group) => group.id)
    });
  }
  draft.table = next;
  draft.selectedTiles.clear();
  draftDirty = true;
  hintMessage = '';
  dragGroupOverId = null;
  dragGroupOverSide = null;
  debugLog('dropTiles', { groupId, tiles: tileIds });
  sendDraftUpdate();
  render();
}

function dropOnNewGroup(event) {
  if (!draft.table || !state) {
    return;
  }
  const groupDragId = getGroupDragId(event);
  if (groupDragId) {
    pushHistory(draft);
    const next = draft.table.filter((group) => group.id !== groupDragId);
    const dragged = draft.table.find((group) => group.id === groupDragId);
    if (dragged) {
      next.push(dragged);
      draft.table = next;
      draftDirty = true;
      hintMessage = '';
      dragGroupOverId = null;
      dragGroupOverSide = null;
      debugLog('moveGroupToEnd', { groupId: groupDragId });
      sendDraftUpdate();
      render();
    }
    return;
  }
  const tileIds = getDragIds(event);
  dragTileId = null;
  draft.dragIds = [];
  if (!tileIds.length) {
    return;
  }
  const tiles = tileIds.map((id) => findTileById(draft.table, state.you.hand, id)).filter(Boolean);
  if (!tiles.length) {
    return;
  }
  if (!canRemoveFromGroups(draft.table, tileIds)) {
    const removalIssue = getRemovalIssue(draft.table, tileIds);
    hintMessage = removalIssue
      ? `Removing those tiles would leave a group with ${removalIssue.remaining} tile${removalIssue.remaining === 1 ? '' : 's'}.`
      : 'Removing those tiles would leave a group under 3 tiles.';
    render();
    return;
  }
  pushHistory(draft);
  let next = draft.table;
  tileIds.forEach((id) => {
    next = removeTileById(next, id);
  });
  draft.groupCounter += 1;
  next.push({ id: `draft-${draft.turnId}-${draft.groupCounter}`, tiles });
  draft.table = next;
  draft.selectedTiles.clear();
  draftDirty = true;
  hintMessage = '';
  dragGroupOverSide = null;
  debugLog('dropNewGroup', { tiles: tileIds });
  sendDraftUpdate();
  render();
}

function startGroupDrag(event, groupId) {
  dragMode = 'group';
  dragGroupId = groupId;
  dragGroupOverId = null;
  dragGroupOverSide = null;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-tile-rummy-group', groupId);
  event.dataTransfer.setData('text/plain', groupId);
}

function setGroupDragOver(groupId, event, rect) {
  if (dragMode !== 'group') {
    return;
  }
  if (!groupId) {
    dragGroupOverId = null;
    dragGroupOverSide = null;
    render();
    return;
  }
  let side = 'before';
  if (rect && typeof event?.clientX === 'number') {
    const mid = rect.left + rect.width / 2;
    side = event.clientX > mid ? 'after' : 'before';
  }
  if (dragGroupOverId !== groupId || dragGroupOverSide !== side) {
    dragGroupOverId = groupId;
    dragGroupOverSide = side;
    render();
  }
}

function render() {
  if (!state || !state.you) {
    renderJoin(app, {
      errorMessage,
      storedRoom: initialRoom,
      storedName,
      mode: joinMode,
      themeMode,
      onToggleTheme: toggleTheme,
      onModeChange: (mode) => {
        joinMode = mode;
        render();
      },
      onJoin: joinRoom
    });
    return;
  }

  syncDraftState(state, draft);

  renderGame(app, {
    state,
    errorMessage,
    draft,
    tableContext: buildTableContext(state, draft),
    sortMode,
    handOrder,
    highlightTileId: lastDrawnId,
    hintMessage,
    groupFaceMode,
    colorBlindMode,
    themeMode,
    showHelp,
    inviteLink: buildInviteLink(state.roomId),
    handlers: {
      startRound,
      addAi,
      removeAi,
      sortTable,
      drawTile,
      submitTurn,
      requestHint,
      copyInvite,
      setSortMode,
      shuffleHand,
      cycleGroupFace,
      toggleColorBlind,
      toggleTheme,
      toggleHelp,
      sendChat,
      toggleAutoPlay,
      setRules,
      resetDraft,
      undoDraft,
      createGroup,
      addSelectedToGroup,
      toggleTile,
      startDrag,
      startGroupDrag,
      endDrag,
      setGroupDragOver,
      dropOnGroup,
      dropOnNewGroup,
      refresh: render,
      getSelectedTiles: () => collectSelectedTiles(draft.table || [], draft.selectedTiles, state.you.hand),
      debugAddCheck,
      getGroupDragOverId: () => dragGroupOverId,
      getGroupDragOverSide: () => dragGroupOverSide
    }
  });
}

render();

function syncHandOrder() {
  if (sortMode !== 'shuffle' || !state || !state.you) {
    return;
  }
  const currentIds = state.you.hand.map((tile) => tile.id);
  const seen = new Set(currentIds);
  const nextOrder = handOrder.filter((id) => seen.has(id));
  currentIds.forEach((id) => {
    if (!nextOrder.includes(id)) {
      nextOrder.push(id);
    }
  });
  handOrder = nextOrder;
}

function updateDrawHighlight() {
  if (!state || !state.you) {
    lastHandIds = [];
    lastDrawnId = null;
    return;
  }
  const currentIds = state.you.hand.map((tile) => tile.id);
  if (currentIds.length === lastHandIds.length + 1) {
    const prev = new Set(lastHandIds);
    const added = currentIds.find((id) => !prev.has(id));
    if (added) {
      lastDrawnId = added;
    }
  }
  if (lastDrawnId && !currentIds.includes(lastDrawnId)) {
    lastDrawnId = null;
  }
  lastHandIds = currentIds;
}

async function copyInvite(link) {
  if (!link) {
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    hintMessage = 'Invite link copied.';
  } catch (error) {
    hintMessage = 'Copy failed. Use the link shown to share.';
  }
  render();
}

function buildInviteLink(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

function sendDraftUpdate() {
  if (!state || !draft.table) {
    return;
  }
  if (!state.started || state.winner || state.currentPlayer !== state.you.name) {
    return;
  }
  debugLog('draftUpdate', { turnId: state.turnId, tiles: flattenTableIds(draft.table) });
  socket.send({
    type: 'draftUpdate',
    turnId: state.turnId,
    table: serializeTable(draft.table)
  });
}

function hasDraftChanges() {
  if (draftDirty) {
    return true;
  }
  if (!state || !draft.table || !state.table) {
    return false;
  }
  return tableSignature(draft.table) !== tableSignature(state.table);
}

function tableSignature(table) {
  if (!Array.isArray(table)) {
    return '';
  }
  return table
    .map((group) => {
      const ids = Array.isArray(group.tiles) ? group.tiles.map((tile) => tile.id) : [];
      return `${group.id}:${ids.join(',')}`;
    })
    .join('|');
}

function requestHint() {
  if (!state || !state.you || !state.started || state.winner) {
    hintMessage = 'No moves available right now.';
    render();
    return;
  }
  hintStep += 1;
  socket.send({ type: 'hint', step: hintStep });
}

function canRemoveFromGroups(table, tileIds) {
  return !getRemovalIssue(table, tileIds);
}

function getRemovalIssue(table, tileIds) {
  const counts = new Map();
  tileIds.forEach((id) => {
    const group = findGroupByTileId(table, id);
    if (!group) {
      return;
    }
    counts.set(group.id, (counts.get(group.id) || 0) + 1);
  });
  for (const group of table) {
    const removed = counts.get(group.id) || 0;
    const remaining = group.tiles.length - removed;
    if (remaining > 0 && remaining < 3) {
      return { groupId: group.id, remaining, size: group.tiles.length };
    }
  }
  return null;
}

function formatTiles(tiles) {
  const colorNames = {
    red: 'Red',
    blue: 'Blue',
    black: 'Black',
    orange: 'Orange'
  };
  return tiles
    .map((tile) => {
      if (tile.joker) {
        return 'Joker';
      }
      const color = colorNames[tile.color] || tile.color;
      return `${color} ${tile.value}`;
    })
    .join(', ');
}

function buildHintMessage(payload, step) {
  if (payload.message) {
    return payload.message;
  }
  const tiles = payload.tiles || [];
  const stage = step;
  if (tiles.length === 0) {
    return 'Hint: You have a possible move.';
  }
  if (stage <= 1) {
    return 'Hint: You have a possible move.';
  }
  const prefix = 'Hint: ';
  const revealCount = stage <= 2 ? 1 : stage === 3 ? 2 : tiles.length;
  const unique = [];
  const seen = new Set();
  tiles.forEach((tile) => {
    if (seen.has(tile.id)) {
      return;
    }
    seen.add(tile.id);
    unique.push(tile);
  });
  const revealTiles = unique.slice(0, Math.min(revealCount, unique.length));
  if (revealTiles.length === 1) {
    return `${prefix}It involves ${formatTiles(revealTiles)}.`;
  }
  if (revealTiles.length === 2 && revealCount === 2 && unique.length > 2) {
    return `${prefix}It involves ${formatTiles(revealTiles)}.`;
  }
  if (revealTiles.length < unique.length) {
    return `${prefix}It involves ${formatTiles(revealTiles)}.`;
  }
  return `${prefix}It involves ${formatTiles(unique)}.`;
}

function debugLog(message, data) {
  if (!debugEnabled) {
    return;
  }
  console.log('[RUMMI DEBUG]', message, data || '');
}

function flattenTableIds(table) {
  const ids = [];
  (table || []).forEach((group) => {
    group.tiles.forEach((tile) => ids.push(tile.id));
  });
  return ids;
}

function summarizeState(nextState) {
  if (!nextState || !nextState.you) {
    return null;
  }
  return {
    roomId: nextState.roomId,
    player: nextState.you.name,
    turnId: nextState.turnId,
    currentPlayer: nextState.currentPlayer,
    handIds: nextState.you.hand.map((tile) => tile.id),
    tableIds: flattenTableIds(nextState.table),
    draftIds: nextState.draftTable ? flattenTableIds(nextState.draftTable) : []
  };
}

function diffIds(prev = [], next = []) {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((id) => !prevSet.has(id));
  const removed = prev.filter((id) => !nextSet.has(id));
  return { added, removed };
}

function debugStateDiff(nextState) {
  if (!debugEnabled) {
    return;
  }
  const summary = summarizeState(nextState);
  if (!summary) {
    return;
  }
  if (!lastStateSummary) {
    debugLog('stateInit', summary);
    lastStateSummary = summary;
    return;
  }
  const handDiff = diffIds(lastStateSummary.handIds, summary.handIds);
  const tableDiff = diffIds(lastStateSummary.tableIds, summary.tableIds);
  const draftDiff = diffIds(lastStateSummary.draftIds, summary.draftIds);
  const changed = handDiff.added.length || handDiff.removed.length
    || tableDiff.added.length || tableDiff.removed.length
    || draftDiff.added.length || draftDiff.removed.length
    || summary.turnId !== lastStateSummary.turnId
    || summary.currentPlayer !== lastStateSummary.currentPlayer;
  if (changed) {
    debugLog('stateDiff', {
      roomId: summary.roomId,
      player: summary.player,
      turnId: summary.turnId,
      currentPlayer: summary.currentPlayer,
      handCount: summary.handIds.length,
      tableCount: summary.tableIds.length,
      draftCount: summary.draftIds.length,
      handAdded: handDiff.added,
      handRemoved: handDiff.removed,
      tableAdded: tableDiff.added,
      tableRemoved: tableDiff.removed,
      draftAdded: draftDiff.added,
      draftRemoved: draftDiff.removed
    });
  }
  lastStateSummary = summary;
}

function debugAddCheck(groupId, groupTiles, selectedTiles, addValid) {
  if (!debugEnabled) {
    return;
  }
  debugLog('addCheck', {
    groupId,
    groupTiles: groupTiles.map((tile) => tile.id),
    selected: selectedTiles.map((tile) => tile.id),
    addValid
  });
}

window.addEventListener('keydown', (event) => {
  const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
  if (!isUndo) {
    return;
  }
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return;
  }
  if (!state || !state.you) {
    return;
  }
  const yourTurn = state.started && !state.winner && state.currentPlayer === state.you.name;
  if (!yourTurn || !draft.history || draft.history.length === 0) {
    return;
  }
  event.preventDefault();
  undoDraft();
});
