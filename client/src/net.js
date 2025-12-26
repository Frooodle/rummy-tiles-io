export function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const port = window.location.port;
  const wsPort = port === '5173' ? '3000' : port;
  const host = wsPort ? `${window.location.hostname}:${wsPort}` : window.location.hostname;
  return `${proto}://${host}`;
}

export function connect({ onOpen, onState, onHint, onError, onClose }) {
  const ws = new WebSocket(wsUrl());
  ws.addEventListener('open', () => {
    if (onOpen) {
      onOpen(ws);
    }
  });
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'state') {
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
    onClose();
  });
  return ws;
}

export function send(ws, data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(data));
}
