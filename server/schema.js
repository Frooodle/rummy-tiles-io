const MAX_NAME_LEN = 12;
const MAX_CHAT_LEN = 240;

function sanitizeName(name) {
  return String(name || '').trim().slice(0, MAX_NAME_LEN);
}

function sanitizeChat(text) {
  return String(text || '').trim().slice(0, MAX_CHAT_LEN);
}

function coerceBoolean(value) {
  return Boolean(value);
}

function parseAiLevel(level) {
  return level === 'advanced' ? 'advanced' : 'basic';
}

module.exports = {
  sanitizeName,
  sanitizeChat,
  coerceBoolean,
  parseAiLevel,
  MAX_NAME_LEN,
  MAX_CHAT_LEN
};
