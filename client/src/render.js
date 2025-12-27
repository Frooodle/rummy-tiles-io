import { isValidGroupClient, isValidTableClient, sortTiles, sortTilesByValue } from './draft.js';
import { renderJoinView, buildRoomShell } from './ui/roomShell.js';
const jokerUrl = '/favicon.svg';

let historyStickToBottom = true;
let historyScrollTop = 0;
let lastHistoryCount = 0;

export function renderJoin(app, { errorMessage, storedRoom, storedName, mode, onModeChange, onJoin, themeMode, onToggleTheme }) {
  renderJoinView(app, { errorMessage, storedRoom, storedName, mode, onModeChange, onJoin, themeMode, onToggleTheme });
}

export function renderGame(app, context) {
  const {
    state,
    errorMessage,
    draft,
    tableContext,
    sortMode,
    handOrder,
    highlightTileId,
    hintMessage,
    groupFaceMode,
    colorBlindMode,
    themeMode,
    showHelp,
    inviteLink,
    handlers
  } = context;

  const you = state.you;
  const isHost = state.hostName === you.name;
  const autoPlay = Boolean(you.autoPlay);
  const yourTurn = state.started && !state.winner && state.currentPlayer === you.name && !autoPlay;
  const { baseTableIds, activeTable, stagedFromHand } = tableContext;
  const showDraft = !yourTurn && state.draftTable && state.draftPlayer === state.currentPlayer;
  const tableToShow = showDraft ? state.draftTable : activeTable;

  const shell = buildRoomShell({
    app,
    state,
    title: 'Tile Rummy',
    themeMode,
    handlers,
    showChat: state.started
  });
  app.appendChild(shell.header);

  document.body.dataset.groupFace = groupFaceMode || 'classic';
  document.body.dataset.colorblind = colorBlindMode ? 'on' : 'off';
  document.body.dataset.theme = themeMode || 'light';

  const helpButton = document.createElement('button');
  helpButton.className = 'secondary';
  helpButton.textContent = 'How to play';
  helpButton.addEventListener('click', () => handlers.toggleHelp());
  shell.headerActions.appendChild(helpButton);

  if (yourTurn) {
    const banner = document.createElement('div');
    banner.className = 'turn-banner';
    banner.textContent = 'YOUR TURN';
    app.appendChild(banner);
  }

  if (errorMessage) {
    const err = document.createElement('div');
    err.className = 'error';
    err.textContent = errorMessage;
    app.appendChild(err);
  }

  if (state.roundOver) {
    const modalWrap = document.createElement('div');
    modalWrap.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal panel';
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    for (let i = 0; i < 18; i += 1) {
      const piece = document.createElement('span');
      confetti.appendChild(piece);
    }
    modal.appendChild(confetti);
    const title = document.createElement('h2');
    title.textContent = 'Round over';
    modal.appendChild(title);
    if (state.winner) {
      const banner = document.createElement('div');
      banner.className = 'winner-banner';
      banner.textContent = 'Champion';
      modal.appendChild(banner);
      const winnerName = document.createElement('div');
      winnerName.className = 'winner-name';
      winnerName.textContent = state.winner;
      modal.appendChild(winnerName);
      const winnerText = document.createElement('div');
      winnerText.className = 'notice';
      winnerText.textContent = 'Took the round with a clean hand.';
      modal.appendChild(winnerText);
    } else {
      const winnerText = document.createElement('div');
      winnerText.className = 'notice';
      winnerText.textContent = 'Round ended in a stalemate.';
      modal.appendChild(winnerText);
    }

    if (Array.isArray(state.scores) && state.scores.length > 0) {
      const scoreTitle = document.createElement('div');
      scoreTitle.className = 'notice';
      scoreTitle.textContent = 'Scores';
      modal.appendChild(scoreTitle);
      const scoreList = document.createElement('div');
      scoreList.className = 'score-list';
      [...state.scores]
        .sort((a, b) => b.score - a.score)
        .forEach((entry) => {
          const row = document.createElement('div');
          row.className = 'score-row';
          const name = document.createElement('span');
          name.textContent = entry.name;
          const score = document.createElement('span');
          score.textContent = entry.score;
          row.appendChild(name);
          row.appendChild(score);
          scoreList.appendChild(row);
        });
      modal.appendChild(scoreList);
    }
    const actions = document.createElement('div');
    actions.className = 'controls modal-actions';
    const nextButton = document.createElement('button');
    nextButton.textContent = 'Start next round';
    nextButton.disabled = !isHost;
    nextButton.addEventListener('click', () => handlers.startRound());
    actions.appendChild(nextButton);
    if (!isHost) {
      const wait = document.createElement('div');
      wait.className = 'notice';
      wait.textContent = 'Waiting for host to start the next round.';
      modal.appendChild(wait);
    }
    modal.appendChild(actions);
    modalWrap.appendChild(modal);
    app.appendChild(modalWrap);
  }

  if (showHelp) {
    const helpWrap = document.createElement('div');
    helpWrap.className = 'modal-backdrop';
    const helpModal = document.createElement('div');
    helpModal.className = 'modal panel help-modal';

    const title = document.createElement('h2');
    title.textContent = 'How to play';
    helpModal.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'help-tabs';
    tabs.innerHTML = `
      <button class="active" data-tab="rules">Game rules</button>
      <button data-tab="controls">Playing online</button>
    `;
    helpModal.appendChild(tabs);

    const rules = document.createElement('div');
    rules.className = 'help-panel rules active';
    rules.innerHTML = `
      <h3>Goal</h3>
      <p>Be the first to empty your hand by creating sets (same number, different colors) and runs (same color, consecutive numbers).</p>
      <div class="help-tiles">
        <div class="help-pair">
          <div class="help-group">
            <div class="help-group-title">Set example</div>
            <div class="help-tiles-row">
              <span class="tile tile-mini red">7</span>
              <span class="tile tile-mini blue">7</span>
              <span class="tile tile-mini black">7</span>
            </div>
          </div>
          <div class="help-group">
            <div class="help-group-title">Invalid set</div>
            <div class="help-tiles-row">
              <span class="tile tile-mini red">9</span>
              <span class="tile tile-mini red">9</span>
              <span class="tile tile-mini blue">9</span>
            </div>
            <div class="help-group-note">Sets cannot repeat a color.</div>
          </div>
        </div>
        <div class="help-pair">
          <div class="help-group">
            <div class="help-group-title">Run example</div>
            <div class="help-tiles-row">
              <span class="tile tile-mini orange">9</span>
              <span class="tile tile-mini orange">10</span>
              <span class="tile tile-mini orange">11</span>
            </div>
          </div>
          <div class="help-group">
            <div class="help-group-title">Not allowed</div>
            <div class="help-tiles-row">
              <span class="tile tile-mini red">5</span>
              <span class="tile tile-mini blue">6</span>
              <span class="tile tile-mini red">7</span>
            </div>
            <div class="help-group-note">Runs must stay in one color.</div>
          </div>
        </div>
        <div class="help-group">
          <div class="help-group-title">Joker example</div>
          <div class="help-tiles-row">
            <span class="tile tile-mini blue">4</span>
            <span class="tile tile-mini joker">J</span>
            <span class="tile tile-mini blue">6</span>
          </div>
          <div class="help-group-note">Joker stands in for the missing 5.</div>
        </div>
      </div>
      <h3>Initial meld</h3>
      <p>Your first meld must total at least ${state.initialMeld} points. Until you reach that, you cannot change any existing table tiles.</p>
      <h3>Table rules</h3>
      <p>After your initial meld, you may rearrange the table, but all tiles already on the table must remain on the table.</p>
      <p>Every group on the table must always be valid (sets or runs of 3+). You can split and merge groups, but you cannot temporarily break groups below 3 while rearranging.</p>
      <p>Direct tile swapping isn’t allowed unless it’s done through valid splits/merges that keep all groups legal throughout.</p>
      <div class="help-tiles">
        <div class="help-pair">
          <div class="help-group">
            <div class="help-group-title">Valid rearrange</div>
            <div class="help-tiles-row">
              <span class="tile tile-mini blue">7</span>
              <span class="tile tile-mini blue">8</span>
              <span class="tile tile-mini blue">9</span>
              <span class="tile tile-mini blue">10</span>
              <span class="tile tile-mini blue">11</span>
              <span class="tile tile-mini blue">12</span>
              <span class="tile tile-mini blue">13</span>
            </div>
            <div class="help-group-note">Split into 7-8-9 and 10-11-12-13. Now the 10 (or 13) can be moved into another valid group, and you can insert a different blue 10 if you have one.</div>
          </div>
          <div class="help-group">
            <div class="help-group-title">Invalid rearrange</div>
            <div class="help-tiles-row">
              <span class="tile tile-mini red">3</span>
              <span class="tile tile-mini red">4</span>
              <span class="tile tile-mini red">5</span>
              <span class="tile tile-mini red">6</span>
            </div>
            <div class="help-group-note">Cannot leave a 2-tile group (e.g., 3-4) at any step. You could still take the 3 or 6 since 4-5-6 stays valid.</div>
          </div>
        </div>
      </div>
      <p>You must add at least one tile from your hand when you submit your turn.</p>
      <h3>Sets & runs</h3>
      <p>Sets are 3–4 tiles of the same value in different colors. Runs are 3+ consecutive tiles in the same color.</p>
      <h3>Jokers</h3>
      <p>Jokers can stand in for any tile. This room uses ${state.jokerLocked ? 'locked jokers (cannot move them)' : 'replaceable jokers (you may move them if the original group stays valid)'}.</p>
      <h3>End of round</h3>
      <p>The round ends when someone goes out or the deck runs dry and everyone passes.</p>
    `;
    helpModal.appendChild(rules);

    const controls = document.createElement('div');
    controls.className = 'help-panel controls';
    controls.innerHTML = `
      <h3>Select & build</h3>
      <p>Click tiles to select, then use <strong>Create group</strong> or <strong>Add selected tiles</strong>.</p>
      <h3>Draft view</h3>
      <p>Your moves stay in draft until you hit <strong>Submit plays</strong>. Use <strong>Reset turn</strong> or <strong>Undo</strong> if needed.</p>
      <h3>Drawing</h3>
      <p><strong>Draw tile (no play)</strong> ends your turn without playing. You’ll be prompted if you have unsent draft changes.</p>
      <h3>Hints</h3>
      <p>Use <strong>Hint</strong> for a staged nudge. Each click reveals more about a possible move.</p>
      <h3>Auto play</h3>
      <p>Toggle <strong>Auto play</strong> to let the AI finish your turns until you disable it.</p>
      <h3>Sorting</h3>
      <p>Toggle color or number sorting to organize your hand. Shuffle is available for quick scanning.</p>
    `;
    helpModal.appendChild(controls);

    const actions = document.createElement('div');
    actions.className = 'controls modal-actions';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.className = 'secondary';
    close.addEventListener('click', () => handlers.toggleHelp());
    actions.appendChild(close);
    helpModal.appendChild(actions);

    helpWrap.addEventListener('click', (event) => {
      if (event.target === helpWrap) {
        handlers.toggleHelp();
      }
    });

    helpWrap.appendChild(helpModal);
    app.appendChild(helpWrap);

    helpWrap.querySelectorAll('.help-tabs button').forEach((tab) => {
      tab.addEventListener('click', () => {
        helpWrap.querySelectorAll('.help-tabs button').forEach((btn) => btn.classList.remove('active'));
        helpWrap.querySelectorAll('.help-panel').forEach((panel) => panel.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        helpWrap.querySelector(`.help-panel.${target}`)?.classList.add('active');
      });
    });
  }

  const { side, center, layout, chatPanel } = shell;

  // Scores panel removed for simpler UI.

  if (!state.started) {
      const lobbyPanel = document.createElement('div');
      lobbyPanel.className = 'panel stack';
      const lobbyTitle = document.createElement('h2');
      lobbyTitle.textContent = 'Lobby';
      lobbyPanel.appendChild(lobbyTitle);

    const lobbyCta = document.createElement('div');
    lobbyCta.className = 'lobby-cta';

    const startButton = document.createElement('button');
    startButton.textContent = state.roundOver ? 'Start next round' : 'Start game';
    startButton.disabled = !isHost || state.players.length < 2;
    if (!startButton.disabled) {
      startButton.classList.add('primary-good');
    }
    startButton.addEventListener('click', () => handlers.startRound());
    lobbyCta.appendChild(startButton);

    const controls = document.createElement('div');
    controls.className = 'controls';

    const addAiButton = document.createElement('button');
    addAiButton.textContent = 'Add AI';
    addAiButton.className = 'secondary';
    addAiButton.disabled = !isHost;
    addAiButton.addEventListener('click', () => handlers.addAi('basic'));
    controls.appendChild(addAiButton);

    const addSmartAiButton = document.createElement('button');
    addSmartAiButton.textContent = 'Add AI+';
    addSmartAiButton.className = 'secondary';
    addSmartAiButton.disabled = !isHost;
    addSmartAiButton.addEventListener('click', () => handlers.addAi('advanced'));
    controls.appendChild(addSmartAiButton);

    const removeAiButton = document.createElement('button');
    removeAiButton.textContent = 'Remove AI';
    removeAiButton.className = 'secondary';
    removeAiButton.disabled = !isHost;
    removeAiButton.addEventListener('click', () => handlers.removeAi());
    controls.appendChild(removeAiButton);

      lobbyPanel.appendChild(lobbyCta);
      lobbyPanel.appendChild(controls);

      const rulesRow = document.createElement('div');
      rulesRow.className = 'controls';
      const jokerRule = document.createElement('button');
      const jokerLocked = Boolean(state.jokerLocked);
      jokerRule.textContent = jokerLocked ? 'Joker rule: Locked' : 'Joker rule: Replaceable';
      jokerRule.className = jokerLocked ? '' : 'secondary';
      jokerRule.disabled = !isHost;
      jokerRule.addEventListener('click', () => handlers.setRules(!jokerLocked));
      rulesRow.appendChild(jokerRule);
      lobbyPanel.appendChild(rulesRow);

      const note = document.createElement('div');
      note.className = 'notice';
      note.textContent = isHost
        ? 'Add AI players and start when ready.'
        : 'Waiting for host to start.';
    lobbyPanel.appendChild(note);

    if (inviteLink) {
      const inviteWrap = document.createElement('div');
      inviteWrap.className = 'stack';

      const inviteLabel = document.createElement('div');
      inviteLabel.className = 'notice';
      inviteLabel.textContent = 'Invite link';
      inviteWrap.appendChild(inviteLabel);

      const inviteInput = document.createElement('input');
      inviteInput.value = inviteLink;
      inviteInput.readOnly = true;
      inviteInput.addEventListener('click', () => inviteInput.select());
      inviteWrap.appendChild(inviteInput);

      const inviteButton = document.createElement('button');
      inviteButton.textContent = 'Copy invite link';
      inviteButton.className = 'secondary';
      inviteButton.addEventListener('click', () => handlers.copyInvite(inviteLink));
      inviteWrap.appendChild(inviteButton);

      lobbyPanel.appendChild(inviteWrap);
    }

    side.appendChild(lobbyPanel);
  }

  if (state.moveHistory && state.moveHistory.length > 0) {
    const historyPanel = document.createElement('div');
    historyPanel.className = 'panel stack';
    const historyTitle = document.createElement('h2');
    historyTitle.textContent = 'Move History';
    historyPanel.appendChild(historyTitle);

    const historyList = document.createElement('div');
    historyList.className = 'history-list';
    const entries = state.moveHistory.slice(-50);
    const details = Array.isArray(state.moveHistoryDetailed) ? state.moveHistoryDetailed.slice(-50) : [];
    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.textContent = entry;
      const detail = details[index];
      if (detail) {
        const preview = document.createElement('div');
        preview.className = 'history-preview';
        preview.innerHTML = buildHistoryPreview(detail);
        row.addEventListener('mouseenter', () => {
          const rect = row.getBoundingClientRect();
          const previewWidth = preview.offsetWidth || 320;
          const previewHeight = preview.offsetHeight || 200;
          let left = rect.right + 12;
          if (left + previewWidth > window.innerWidth - 12) {
            left = window.innerWidth - previewWidth - 12;
          }
          if (left < 12) {
            left = 12;
          }
          let top = rect.top;
          if (top + previewHeight > window.innerHeight - 12) {
            top = window.innerHeight - previewHeight - 12;
          }
          if (top < 12) {
            top = 12;
          }
          preview.style.left = `${left}px`;
          preview.style.top = `${top}px`;
          preview.style.transform = 'none';
        });
        row.addEventListener('mouseleave', () => {
          preview.style.left = '';
          preview.style.top = '';
          preview.style.transform = '';
        });
        row.appendChild(preview);
      }
      historyList.appendChild(row);
    });
    historyList.addEventListener('scroll', () => {
      historyScrollTop = historyList.scrollTop;
      const nearBottom = historyList.scrollTop + historyList.clientHeight >= historyList.scrollHeight - 8;
      historyStickToBottom = nearBottom;
    });
    if (entries.length > lastHistoryCount && historyStickToBottom) {
      historyList.scrollTop = historyList.scrollHeight;
    } else {
      historyList.scrollTop = Math.min(historyScrollTop, historyList.scrollHeight);
    }
    lastHistoryCount = entries.length;
    historyPanel.appendChild(historyList);
    side.appendChild(historyPanel);
  }

  if (!state.started) {
    layout.classList.add('lobby-layout');
    app.appendChild(layout);
    return;
  }
  if (chatPanel) {
    side.appendChild(chatPanel);
  }

  const tablePanel = document.createElement('div');
  tablePanel.className = 'panel table';
  const tableTitle = document.createElement('h2');
  tableTitle.textContent = yourTurn ? 'Table (your draft)' : 'Table';
  tablePanel.appendChild(tableTitle);

  if (state.started) {
    const tableTools = document.createElement('div');
    tableTools.className = 'controls table-tools';

    const statusText = document.createElement('div');
    statusText.className = 'notice table-status';
    if (autoPlay && state.currentPlayer === you.name) {
      statusText.textContent = 'Auto play active.';
    } else {
      statusText.textContent = yourTurn ? 'Your turn.' : `Turn: ${state.currentPlayer}`;
    }
    tableTools.appendChild(statusText);

    if (isHost) {
      const sortTable = document.createElement('button');
      sortTable.textContent = 'Sort table';
      sortTable.className = 'secondary';
      sortTable.addEventListener('click', () => handlers.sortTable());
      tableTools.appendChild(sortTable);
    }

    tablePanel.appendChild(tableTools);

    if (!you.hasMelded) {
      const note = document.createElement('div');
      note.className = 'notice';
      note.textContent = `Initial meld: play ${state.initialMeld} points from hand before rearranging the table.`;
      tablePanel.appendChild(note);
    }
  }
  if (state.lastMove) {
    const lastMove = document.createElement('div');
    lastMove.className = 'notice';
    lastMove.textContent = `Last move: ${state.lastMove}`;
    tablePanel.appendChild(lastMove);
  }

  const tableGrid = document.createElement('div');
  tableGrid.className = 'table-grid';
  tablePanel.appendChild(tableGrid);

  if (!tableToShow || !tableToShow.length) {
    const empty = document.createElement('div');
    empty.className = 'notice';
    empty.textContent = 'No groups yet.';
    tableGrid.appendChild(empty);
  }

  if (showDraft) {
    const draftNote = document.createElement('div');
    draftNote.className = 'notice';
    draftNote.textContent = `Viewing ${state.draftPlayer}'s draft...`;
    tablePanel.insertBefore(draftNote, tableGrid);
  }

  (tableToShow || []).forEach((group) => {
    const groupEl = document.createElement('div');
    const isDragOver = handlers.getGroupDragOverId && handlers.getGroupDragOverId() === group.id;
    const dragSide = handlers.getGroupDragOverSide ? handlers.getGroupDragOverSide() : null;
    const dragMarker = isDragOver ? `drop-target-group drop-target-${dragSide || 'before'}` : '';
    groupEl.className = `group ${showDraft ? 'ghost' : ''} ${dragMarker}`;
  if (yourTurn) {
      groupEl.addEventListener('dragenter', (event) => {
        event.preventDefault();
        groupEl.classList.add('drop-target');
        handlers.setGroupDragOver(group.id, event, groupEl.getBoundingClientRect());
      });
      groupEl.addEventListener('dragover', (event) => {
        event.preventDefault();
        groupEl.classList.add('drop-target');
        handlers.setGroupDragOver(group.id, event, groupEl.getBoundingClientRect());
      });
      groupEl.addEventListener('dragleave', () => {
        groupEl.classList.remove('drop-target');
      });
      groupEl.addEventListener('drop', (event) => {
        event.preventDefault();
        groupEl.classList.remove('drop-target');
        handlers.dropOnGroup(group.id, event);
      });
    }

    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    if (yourTurn) {
      const handle = document.createElement('div');
      handle.className = 'group-handle';
      handle.textContent = 'Move';
      handle.setAttribute('draggable', 'true');
      handle.addEventListener('dragstart', (event) => handlers.startGroupDrag(event, group.id));
      handle.addEventListener('dragend', () => handlers.endDrag());
      groupHeader.appendChild(handle);
    }
    if (groupHeader.childNodes.length > 0) {
      groupEl.appendChild(groupHeader);
    }

    const tilesEl = document.createElement('div');
    tilesEl.className = 'tiles';

    group.tiles.forEach((tile) => {
      const selectable = yourTurn && (you.hasMelded || !baseTableIds.has(tile.id));
      tilesEl.appendChild(renderTile(tile, selectable, draft, highlightTileId, handlers));
    });

    if (yourTurn && draft.dragIds && draft.dragIds.length) {
      const preview = document.createElement('div');
      preview.className = 'drop-preview';
      preview.textContent = `Drop ${draft.dragIds.length} tile${draft.dragIds.length > 1 ? 's' : ''}`;
      groupEl.appendChild(preview);
    }

    if (yourTurn) {
      const selectedTiles = handlers.getSelectedTiles();
      const uniqueSelected = selectedTiles.filter((tile) => !group.tiles.some((entry) => entry.id === tile.id));
      const addValid = uniqueSelected.length > 0 && isValidGroupClient([...group.tiles, ...uniqueSelected]);
      if (handlers.debugAddCheck && selectedTiles.length > 0) {
        handlers.debugAddCheck(group.id, group.tiles, uniqueSelected, addValid);
      }
      if (addValid) {
        groupEl.classList.add('can-add');
        const addButton = document.createElement('button');
        addButton.textContent = 'Add selected tiles';
        addButton.title = 'Add selected tiles to this group';
        addButton.addEventListener('click', () => handlers.addSelectedToGroup(group.id));
        groupEl.appendChild(addButton);
      } else if (selectedTiles.length > 0) {
        groupEl.title = 'Selection does not make a valid group here.';
      }
    }

    groupEl.appendChild(tilesEl);
    tableGrid.appendChild(groupEl);
  });

  center.appendChild(tablePanel);

  const handPanel = document.createElement('div');
  handPanel.className = 'panel hand';
  const handTitle = document.createElement('h2');
  handTitle.textContent = yourTurn ? 'Your hand (your turn)' : 'Your hand';
  handPanel.appendChild(handTitle);

  const handControls = document.createElement('div');
  handControls.className = 'controls';

  const actionBar = document.createElement('div');
  actionBar.className = 'panel controls action-bar';

  const drawButton = document.createElement('button');
  drawButton.textContent = 'Draw tile (no play)';
  drawButton.disabled = !yourTurn || state.winner;
  drawButton.addEventListener('click', () => handlers.drawTile());
  actionBar.appendChild(drawButton);

  const submitButton = document.createElement('button');
  submitButton.textContent = 'Submit plays';
  const playedCount = stagedFromHand.size;
  submitButton.disabled = !yourTurn || playedCount === 0 || state.winner;
  const canSubmit = yourTurn && playedCount > 0 && isValidTableClient(activeTable || []);
  if (canSubmit) {
    submitButton.classList.add('primary-good');
  }
  submitButton.addEventListener('click', () => handlers.submitTurn());
  actionBar.appendChild(submitButton);

  const hintButton = document.createElement('button');
  hintButton.textContent = 'Hint';
  hintButton.className = 'secondary';
  hintButton.disabled = !yourTurn || state.winner;
  hintButton.addEventListener('click', () => handlers.requestHint());
  actionBar.appendChild(hintButton);

  const resetButton = document.createElement('button');
  resetButton.textContent = 'Reset turn';
  resetButton.className = 'ghost';
  resetButton.disabled = !yourTurn;
  resetButton.addEventListener('click', () => handlers.resetDraft());
  handControls.appendChild(resetButton);

  const undoButton = document.createElement('button');
  undoButton.textContent = 'Undo';
  undoButton.className = 'ghost';
  undoButton.disabled = !yourTurn || !draft.history || draft.history.length === 0;
  undoButton.addEventListener('click', () => handlers.undoDraft());
  handControls.appendChild(undoButton);

  const createGroup = document.createElement('button');
  createGroup.textContent = 'Create group from selection';
  const selectedForGroup = handlers.getSelectedTiles();
  const createValid = selectedForGroup.length >= 3 && isValidGroupClient(selectedForGroup);
  createGroup.disabled = !yourTurn || !createValid;
  createGroup.addEventListener('click', () => handlers.createGroup());
  actionBar.appendChild(createGroup);

  const sortColor = document.createElement('button');
  sortColor.textContent = sortMode === 'color' ? 'Color sort ✓' : 'Sort by color';
  sortColor.className = 'secondary';
  sortColor.disabled = !state.started;
  sortColor.addEventListener('click', () => handlers.setSortMode(sortMode === 'color' ? 'none' : 'color'));
  handControls.appendChild(sortColor);

  const sortNumber = document.createElement('button');
  sortNumber.textContent = sortMode === 'number' ? 'Number sort ✓' : 'Sort by number';
  sortNumber.className = 'secondary';
  sortNumber.disabled = !state.started;
  sortNumber.addEventListener('click', () => handlers.setSortMode(sortMode === 'number' ? 'none' : 'number'));
  handControls.appendChild(sortNumber);

  const shuffleButton = document.createElement('button');
  shuffleButton.textContent = 'Shuffle hand';
  shuffleButton.className = 'secondary';
  shuffleButton.disabled = !state.started;
  shuffleButton.addEventListener('click', () => handlers.shuffleHand());
  handControls.appendChild(shuffleButton);

  const groupFaceButton = document.createElement('button');
  const groupFaceLabel = groupFaceMode === 'transparent'
    ? 'Group boxes: Transparent'
    : groupFaceMode === 'inset'
      ? 'Group boxes: Inset'
      : 'Group boxes: Classic';
  groupFaceButton.textContent = groupFaceLabel;
  groupFaceButton.className = 'secondary';
  groupFaceButton.addEventListener('click', () => handlers.cycleGroupFace());
  handControls.appendChild(groupFaceButton);

  const colorBlindButton = document.createElement('button');
  colorBlindButton.textContent = colorBlindMode ? 'Colorblind: On' : 'Colorblind: Off';
  colorBlindButton.className = colorBlindMode ? '' : 'secondary';
  colorBlindButton.addEventListener('click', () => handlers.toggleColorBlind());
  handControls.appendChild(colorBlindButton);

  const themeButton = document.createElement('button');
  themeButton.textContent = themeMode === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  themeButton.className = 'secondary';
  themeButton.addEventListener('click', () => handlers.toggleTheme());
  handControls.appendChild(themeButton);

  const autoPlayButton = document.createElement('button');
  autoPlayButton.textContent = autoPlay ? 'Auto play: On' : 'Auto play: Off';
  autoPlayButton.className = autoPlay ? '' : 'secondary';
  autoPlayButton.addEventListener('click', () => handlers.toggleAutoPlay(!autoPlay));
  handControls.appendChild(autoPlayButton);

  center.appendChild(actionBar);

  handPanel.appendChild(handControls);
  const handHelp = document.createElement('div');
  handHelp.className = 'notice';
  if (hintMessage) {
    handHelp.textContent = hintMessage;
  } else if (autoPlay && state.currentPlayer === you.name) {
    handHelp.textContent = 'Auto play is taking your turn.';
  } else {
    handHelp.textContent = yourTurn
      ? 'Submit plays to end your turn. Draw tile ends your turn with no plays.'
      : 'Wait for your turn to play.';
  }
  handPanel.appendChild(handHelp);

  const tilesWrap = document.createElement('div');
  tilesWrap.className = 'tiles';
  const handTiles = resolveHandTiles(you.hand, sortMode, handOrder);
  handTiles.forEach((tile) => {
    if (yourTurn && stagedFromHand.has(tile.id)) {
      return;
    }
    tilesWrap.appendChild(renderTile(tile, yourTurn, draft, highlightTileId, handlers));
  });

  handPanel.appendChild(tilesWrap);
  center.appendChild(handPanel);

  layout.appendChild(center);
  app.appendChild(layout);
}

function renderTile(tile, selectable, draft, highlightTileId, handlers) {
  const tileEl = document.createElement('div');
  const draggingClass = draft.dragIds && draft.dragIds.includes(tile.id) ? 'dragging' : '';
  const newClass = highlightTileId === tile.id ? 'new' : '';
  tileEl.className = `tile ${tile.color} ${draft.selectedTiles.has(tile.id) ? 'selected' : ''} ${draggingClass} ${newClass}`;
  if (tile.joker) {
    const img = document.createElement('img');
    img.src = jokerUrl;
    img.alt = 'Joker';
    img.className = 'joker-icon';
    img.setAttribute('draggable', 'false');
    tileEl.appendChild(img);
  } else {
    tileEl.textContent = tile.value;
  }
  if (!tile.joker) {
    const suit = document.createElement('span');
    suit.className = `tile-suit ${tile.color}`;
    suit.setAttribute('aria-hidden', 'true');
    tileEl.appendChild(suit);
  }
  if (selectable) {
    tileEl.addEventListener('click', () => handlers.toggleTile(tile.id));
    tileEl.setAttribute('draggable', 'true');
    tileEl.addEventListener('dragstart', (event) => handlers.startDrag(event, tile.id));
    tileEl.addEventListener('dragend', () => handlers.endDrag());
  }
  return tileEl;
}

function resolveHandTiles(hand, sortMode, handOrder) {
  if (sortMode === 'color') {
    return [...hand].sort(sortTiles);
  }
  if (sortMode === 'number') {
    return [...hand].sort(sortTilesByValue);
  }
  if (sortMode === 'shuffle' && Array.isArray(handOrder) && handOrder.length) {
    const byId = new Map(hand.map((tile) => [tile.id, tile]));
    const ordered = handOrder.map((id) => byId.get(id)).filter(Boolean);
    const remaining = hand.filter((tile) => !handOrder.includes(tile.id));
    return [...ordered, ...remaining];
  }
  return hand;
}

function buildHistoryPreview(detail) {
  const sections = [];
  const playedTiles = Array.isArray(detail.playedTiles) ? detail.playedTiles : [];
  if (playedTiles.length > 0) {
    sections.push({
      label: 'Played from hand',
      tiles: playedTiles
    });
  }
  if (detail.drawnTile) {
    sections.push({
      label: 'Drawn',
      tiles: [detail.drawnTile]
    });
  } else if (detail.hiddenDraw) {
    sections.push({
      label: 'Drawn',
      tiles: []
    });
  }
  const showTableDiffs = shouldShowTableDiffs(detail, playedTiles);
  if (showTableDiffs && detail.tableBefore && detail.tableBefore.length > 0) {
    sections.push({
      label: 'Table before',
      groups: detail.tableBefore
    });
  }
  if (showTableDiffs && detail.tableAfter && detail.tableAfter.length > 0) {
    sections.push({
      label: 'Table after',
      groups: detail.tableAfter
    });
  }
  if (sections.length === 0) {
    return '<div class="history-preview-section">No additional details.</div>';
  }
  return sections.map((section) => renderHistorySection(section)).join('');
}

function shouldShowTableDiffs(detail, playedTiles) {
  if (!detail.tableBefore && !detail.tableAfter) {
    return false;
  }
  const afterGroups = Array.isArray(detail.tableAfter) ? detail.tableAfter : [];
  const beforeGroups = Array.isArray(detail.tableBefore) ? detail.tableBefore : [];
  if (playedTiles.length === 0) {
    return afterGroups.length > 0 || beforeGroups.length > 0;
  }
  if (beforeGroups.length > 0) {
    return true;
  }
  if (afterGroups.length !== 1) {
    return true;
  }
  const afterTiles = afterGroups[0].tiles || [];
  if (afterTiles.length !== playedTiles.length) {
    return true;
  }
  const playedIds = new Set(playedTiles.map((tile) => tile.id));
  return afterTiles.some((tile) => !playedIds.has(tile.id));
}

function renderHistorySection(section) {
  const label = `<div class="history-preview-label">${section.label}</div>`;
  if (section.tiles) {
    if (!section.tiles.length) {
      return `<div class="history-preview-section">${label}<div class="history-preview-note">Hidden</div></div>`;
    }
    const tiles = section.tiles.map((tile) => renderPreviewTile(tile)).join('');
    return `<div class="history-preview-section">${label}<div class="history-preview-tiles">${tiles}</div></div>`;
  }
  const groups = section.groups
    .map((group) => `<div class="history-preview-group">${group.tiles.map((tile) => renderPreviewTile(tile)).join('')}</div>`)
    .join('');
  return `<div class="history-preview-section">${label}<div class="history-preview-groups">${groups}</div></div>`;
}

function renderPreviewTile(tile) {
  if (!tile) {
    return '';
  }
  const colorClass = tile.joker ? 'joker' : tile.color;
  const value = tile.joker ? 'J' : tile.value;
  return `<span class="tile tile-mini ${colorClass}">${value}</span>`;
}
