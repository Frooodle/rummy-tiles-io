function createRoom(roomId) {
  return {
    id: roomId,
    players: new Map(),
    order: [],
    hostName: null,
    started: false,
    roundOver: false,
    scores: new Map(),
    chatHistory: [],
    lastActivity: Date.now()
  };
}

module.exports = {
  createRoom
};
