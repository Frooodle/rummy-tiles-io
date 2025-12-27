const DEFAULT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createRoomManager({
  createRoom,
  isRoomActive,
  alphabet = DEFAULT_ALPHABET,
  codeLength = 4,
  idleMs = 30 * 60 * 1000,
  cleanupIntervalMs = 5 * 60 * 1000
}) {
  const rooms = new Map();
  const alphabetSet = new Set(alphabet.split(''));

  function normalizeRoomId(roomId) {
    return String(roomId || '').trim().toUpperCase();
  }

  function isValidRoomId(roomId) {
    if (typeof roomId !== 'string' || roomId.length !== codeLength) {
      return false;
    }
    for (const char of roomId) {
      if (!alphabetSet.has(char)) {
        return false;
      }
    }
    return true;
  }

  function generateRoomId() {
    for (let attempts = 0; attempts < 40; attempts += 1) {
      let candidate = '';
      for (let i = 0; i < codeLength; i += 1) {
        candidate += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!rooms.has(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function touchRoom(room) {
    room.lastActivity = Date.now();
  }

  function createNewRoom() {
    const roomId = generateRoomId();
    if (!roomId) {
      return null;
    }
    const room = createRoom(roomId);
    touchRoom(room);
    rooms.set(roomId, room);
    return room;
  }

  function getRoom(roomId) {
    return rooms.get(roomId);
  }

  function deleteRoom(roomId) {
    rooms.delete(roomId);
  }

  function cleanupIdleRooms() {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      if (isRoomActive(room)) {
        continue;
      }
      if (now - (room.lastActivity || 0) > idleMs) {
        rooms.delete(roomId);
      }
    }
  }

  setInterval(cleanupIdleRooms, cleanupIntervalMs);

  return {
    rooms,
    normalizeRoomId,
    isValidRoomId,
    touchRoom,
    createNewRoom,
    getRoom,
    deleteRoom
  };
}

module.exports = {
  createRoomManager
};
