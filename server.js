// server.js
// Simple per-origin WebSocket chat with history, security, and rate limiting

const WebSocket = require("ws");

// CONFIG
const PORT = 8080;

// Only these origins can use your chat.
// For local testing, you can temporarily allow "null" or "http://localhost",
// but for real sites you’ll put actual HTTPS origins here.
const ALLOWED_ORIGINS = [
  "https://www.youtube.com",
  "https://www.google.com"
];

const MAX_HISTORY = 50;           // messages per room
const MAX_MSG_PER_WINDOW = 10;    // messages
const RATE_WINDOW_MS = 10_000;    // 10 seconds
const SHARED_TOKEN = null;        // set to a string if you want a shared secret

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map(); // roomName -> { clients: Set<socket>, history: [] }

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, { clients: new Set(), history: [] });
  }
  return rooms.get(roomName);
}

function addToHistory(roomName, msg) {
  const room = getRoom(roomName);
  room.history.push(msg);
  if (room.history.length > MAX_HISTORY) {
    room.history.shift();
  }
}

function broadcastToRoom(roomName, payload, exceptSocket = null) {
  const room = getRoom(roomName);
  for (const client of room.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client === exceptSocket) continue;
    client.send(JSON.stringify(payload));
  }
}

wss.on("connection", (socket, req) => {
  const origin = req.headers.origin || "unknown";

  // Security: only allow certain origins
  if (!ALLOWED_ORIGINS.includes(origin)) {
    console.log("Blocked origin:", origin);
    socket.close(4001, "Origin not allowed");
    return;
  }

  // Optional token auth via query ?token=...
  if (SHARED_TOKEN) {
    try {
      const url = new URL(req.url, origin);
      const token = url.searchParams.get("token");
      if (token !== SHARED_TOKEN) {
        console.log("Bad token from", origin);
        socket.close(4002, "Invalid token");
        return;
      }
    } catch (e) {
      socket.close(4003, "Bad URL");
      return;
    }
  }

  const roomName = origin; // one room per website origin
  const room = getRoom(roomName);
  room.clients.add(socket);

  console.log("Client connected from", origin);

  // simple rate limiting
  socket._msgTimes = [];

  // send history on connect
  socket.send(JSON.stringify({
    type: "history",
    room: roomName,
    messages: room.history
  }));

  socket.on("message", raw => {
    let text = raw.toString().slice(0, 500); // limit length

    // rate limiting
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
      room: roomName,
      from: origin,
      text,
      time: now
    };

    addToHistory(roomName, msg);
    broadcastToRoom(roomName, msg, socket);
  });

  socket.on("close", () => {
    room.clients.delete(socket);
    console.log("Client disconnected from", origin);
  });
});

console.log(`Console chat server running on ws://localhost:${PORT}`);
