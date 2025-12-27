import { createChatState, renderChatPanel } from '../chat.js';

const chatState = createChatState();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderJoinView(app, { errorMessage, storedRoom, storedName, mode, onModeChange, onJoin, themeMode, onToggleTheme }) {
  const roomValue = storedRoom || '';
  const safeRoom = escapeHtml(roomValue);
  const safeName = escapeHtml(storedName || '');
  const safeError = errorMessage ? escapeHtml(errorMessage) : '';
  document.body.dataset.theme = themeMode || 'light';
  app.innerHTML = `
    <div class="join">
      <div class="join-theme">
        <button id="toggle-theme" class="secondary">${themeMode === 'dark' ? 'Dark mode' : 'Light mode'}</button>
      </div>
      <div class="join-hero">
        <div class="brand-mark">TR</div>
        <div>
          <h1>Tile Rummy</h1>
          <p class="tagline">Completely free. Create a room, invite friends, up to 5 players, have fun!</p>
        </div>
      </div>
      ${safeError ? `<div class="error">${safeError}</div>` : ''}
      <div class="join-card">
        <div class="mode-tabs">
          <button id="mode-create" class="${mode === 'create' ? 'active' : ''}">Create</button>
          <button id="mode-join" class="${mode === 'join' ? 'active' : ''}">Join</button>
        </div>
        ${mode === 'join' ? `
          <label for="room">Room code</label>
          <input id="room" value="${safeRoom}" placeholder="4-character code or link" />
        ` : `<div class="notice">A 4-character room code will be created for you.</div>`}
        <label for="name">Player name</label>
        <input id="name" value="${safeName}" placeholder="Your name" maxlength="12" />
        <button id="join" class="cta">${mode === 'create' ? 'Create room' : 'Join room'}</button>
        <p class="notice">Reconnect by using the same room code + name.</p>
      </div>
      <div class="join-meta">
        <div class="meta-pill">Play on desktop or laptop</div>
        <a class="meta-link" href="https://github.com/Frooodle/rummy-tiles-io" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </div>
  `;
  app.querySelector('#mode-create').addEventListener('click', () => onModeChange('create'));
  app.querySelector('#mode-join').addEventListener('click', () => onModeChange('join'));
  app.querySelector('#toggle-theme').addEventListener('click', () => onToggleTheme());
  app.querySelector('#join').addEventListener('click', () => {
    const roomId = mode === 'join' ? app.querySelector('#room').value.trim() : '';
    const name = app.querySelector('#name').value.trim();
    onJoin(roomId, name, mode);
  });
}

function buildHeader({ title, state }) {
  const header = document.createElement('header');
  const headerLeft = document.createElement('div');
  const headerTitle = document.createElement('h1');
  headerTitle.textContent = title;
  const headerMeta = document.createElement('div');
  headerMeta.className = 'room-meta';
  headerMeta.textContent = `Room ${state.roomId} · Host ${state.hostName} · Deck ${state.deckCount} · Round ${state.round}${state.winner ? ` · Winner: ${state.winner}` : ''}`;
  headerLeft.appendChild(headerTitle);
  headerLeft.appendChild(headerMeta);
  header.appendChild(headerLeft);
  const headerActions = document.createElement('div');
  headerActions.className = 'room-meta';
  header.appendChild(headerActions);
  return { header, headerActions };
}

function buildPlayersPanel(state) {
  const playerPanel = document.createElement('div');
  playerPanel.className = 'panel stack players';

  const playersTitle = document.createElement('h2');
  playersTitle.textContent = 'Players';
  playerPanel.appendChild(playersTitle);

  state.players.forEach((player) => {
    const row = document.createElement('div');
    row.className = `player ${state.currentPlayer === player.name ? 'current' : ''}`;
    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name;
    const status = document.createElement('div');
    status.className = 'player-status';
    const aiTag = player.isAi ? ` · ${player.aiLevel === 'advanced' ? 'AI+' : 'AI'}` : '';
    status.textContent = `${player.connected ? 'Connected' : 'Offline'}${aiTag}${player.autoPlay ? ' · Auto' : ''}`;
    left.appendChild(name);
    left.appendChild(status);
    const right = document.createElement('div');
    right.className = 'player-status';
    right.textContent = `Tiles ${player.handCount}`;
    row.appendChild(left);
    row.appendChild(right);
    playerPanel.appendChild(row);
  });

  return playerPanel;
}

export function buildRoomShell({ app, state, title = 'Room', themeMode, handlers, showChat }) {
  app.innerHTML = '';
  document.body.dataset.theme = themeMode || 'light';

  const { header, headerActions } = buildHeader({ title, state });

  const layout = document.createElement('div');
  layout.className = 'layout';

  const side = document.createElement('div');
  side.className = 'side stack';

  const center = document.createElement('div');
  center.className = 'center stack';

  side.appendChild(buildPlayersPanel(state));

  const chatPanel = showChat ? renderChatPanel({ state, handlers, chatState }) : null;

  layout.appendChild(side);
  layout.appendChild(center);

  return {
    header,
    headerActions,
    layout,
    side,
    center,
    chatPanel
  };
}
