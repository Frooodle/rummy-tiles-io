export function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const port = window.location.port;
  const wsPort = port === '5173' ? '3000' : port;
  const host = wsPort ? `${window.location.hostname}:${wsPort}` : window.location.hostname;
  return `${proto}://${host}`;
}

export function createSocketManager({ onState, onHint, onError, onClose, onOpen }) {
  let ws = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let lastPayload = null;

  function resetReconnect() {
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer || !lastPayload) {
      return;
    }
    const delay = Math.min(1000 * (2 ** reconnectAttempts), 8000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(lastPayload);
    }, delay);
  }

  function connect(payload) {
    lastPayload = payload;
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      if (payload) {
        ws.send(JSON.stringify(payload));
      }
      if (onOpen) {
        onOpen(ws);
      }
    });
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'state') {
        resetReconnect();
        onState(data);
      } else if (data.type === 'hint') {
        if (onHint) {
          onHint(data);
        }
      } else if (data.type === 'error') {
        onError(data.message);
      }
    });
    ws.addEventListener('close', () => {
      if (onClose) {
        onClose();
      }
      scheduleReconnect();
    });
    return ws;
  }

  function setReconnectPayload(payload) {
    lastPayload = payload;
  }

  function send(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(data));
  }

  function disconnect() {
    lastPayload = null;
    resetReconnect();
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  return {
    connect,
    setReconnectPayload,
    send,
    disconnect
  };
}
