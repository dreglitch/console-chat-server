// server.js
// Global WebSocket chat server with history + rate limiting

const WebSocket = require("ws");

// Works locally AND on Railway
const PORT = process.env.PORT || 8080;

// One global room for everyone
const ROOM_NAME = "global";

const MAX_HISTORY = 50;           // messages stored
const MAX_MSG_PER_WINDOW = 10;    // messages allowed
const RATE_WINDOW_MS = 10_000;    // 10 seconds

const wss = new WebSocket.Server({ port: PORT });

wss.on("error", error => {
  console.error("WebSocket server error:", error.message);
});

const room = {
  clients: new Set(),
  history: []
};

function addToHistory(msg) {
  room.history.push(msg);
  if (room.history.length > MAX_HISTORY) {
    room.history.shift();
  }
}

function broadcast(payload, exceptSocket = null) {
  for (const client of room.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client === exceptSocket) continue;
    client.send(JSON.stringify(payload));
  }
}

wss.on("connection", (socket, req) => {
  const origin = req.headers.origin || "unknown";

  console.log("Client connected from", origin);
  room.clients.add(socket);

  // rate limiting
  socket._msgTimes = [];

  // send history
  socket.send(JSON.stringify({
    type: "history",
    room: ROOM_NAME,
    messages: room.history
  }));

  socket.on("message", raw => {
    let text = raw.toString().slice(0, 500); // limit length

    // rate limit check
    const now = Date.now();
    socket._msgTimes = socket._msgTimes.filter(t => now - t < RATE_WINDOW_MS);
    if (socket._msgTimes.length >= MAX_MSG_PER_WINDOW) {
      socket.send(JSON.stringify({
        type: "system",
        text: "Rate limit: too many messages, slow down."
      }));
      return;
    }
    socket._msgTimes.push(now);

    const msg = {
      type: "chat",
      room: ROOM_NAME,
      from: origin,
      text,
      time: now
    };

    addToHistory(msg);
    broadcast(msg, socket);
  });

  socket.on("close", () => {
    room.clients.delete(socket);
    console.log("Client disconnected from", origin);
  });

  socket.on("error", error => {
    console.error(`WebSocket client error from ${origin}:`, error.message);
  });
});

console.log(`Global chat server running on ws://0.0.0.0:${PORT}`);
