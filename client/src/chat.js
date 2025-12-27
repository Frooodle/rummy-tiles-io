function scrollToBottom(list, banner, chatState) {
  chatState.stickToBottom = true;
  list.scrollTop = list.scrollHeight;
  banner.classList.remove('active');
}

export function createChatState() {
  return {
    stickToBottom: true,
    scrollTop: 0,
    lastCount: 0
  };
}

export function renderChatPanel({ state, handlers, chatState }) {
  const chatPanel = document.createElement('div');
  chatPanel.className = 'panel stack chat';
  const chatTitle = document.createElement('h2');
  chatTitle.textContent = 'Chat';
  chatPanel.appendChild(chatTitle);

  const chatList = document.createElement('div');
  chatList.className = 'chat-list';
  const chatBanner = document.createElement('div');
  chatBanner.className = 'chat-banner';
  chatBanner.textContent = 'New messages';
  chatBanner.addEventListener('click', () => {
    scrollToBottom(chatList, chatBanner, chatState);
  });
  (state.chatHistory || []).slice(-100).forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'chat-item';
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = entry.player;
    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = entry.text;
    row.appendChild(name);
    row.appendChild(text);
    chatList.appendChild(row);
  });
  chatList.addEventListener('scroll', () => {
    chatState.scrollTop = chatList.scrollTop;
    const nearBottom = chatList.scrollTop + chatList.clientHeight >= chatList.scrollHeight - 8;
    chatState.stickToBottom = nearBottom;
    if (nearBottom) {
      chatBanner.classList.remove('active');
    }
  });
  const chatCount = (state.chatHistory || []).length;
  if (chatCount > chatState.lastCount && chatState.stickToBottom) {
    chatList.scrollTop = chatList.scrollHeight;
  } else {
    chatList.scrollTop = Math.min(chatState.scrollTop, chatList.scrollHeight);
  }
  if (chatCount > chatState.lastCount && !chatState.stickToBottom) {
    chatBanner.classList.add('active');
  }
  chatState.lastCount = chatCount;
  chatPanel.appendChild(chatBanner);
  chatPanel.appendChild(chatList);

  const chatForm = document.createElement('form');
  chatForm.className = 'chat-form';
  const chatInput = document.createElement('input');
  chatInput.type = 'text';
  chatInput.maxLength = 240;
  chatInput.placeholder = 'Type a message...';
  const chatButton = document.createElement('button');
  chatButton.type = 'submit';
  chatButton.textContent = 'Send';
  chatForm.appendChild(chatInput);
  chatForm.appendChild(chatButton);
  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) {
      return;
    }
    handlers.sendChat(text);
    chatInput.value = '';
  });
  chatPanel.appendChild(chatForm);

  return chatPanel;
}
