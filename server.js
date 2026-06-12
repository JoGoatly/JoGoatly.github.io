// ============================================================
//  Minecraft Enhanced — Local Network Multiplayer Server
//  Usage:
//    1. Install Node.js (nodejs.org)
//    2. npm install ws
//    3. node server.js
//    4. Open http://<your-local-ip>:3000 on all PCs
// ============================================================

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { WebSocketServer } = require('ws');
const os    = require('os');

const PORT = 3000;

// ---- Find local IP to display to user ----
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ---- HTTP server — serves index.html ----
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); res.end('index.html not found — put it next to server.js');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ---- WebSocket server ----
const wss = new WebSocketServer({ server: httpServer });

const rooms   = {};   // roomId -> { hostId, clients: Set<ws>, players: {} }
const sockets = new Map(); // ws -> { playerId, roomId }

function broadcast(room, data, excludeWs = null) {
  const msg = JSON.stringify(data);
  for (const client of room.clients) {
    if (client !== excludeWs && client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  }
}

function broadcastAll(room, data) {
  const msg = JSON.stringify(data);
  for (const client of room.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const info = sockets.get(ws) || {};

    // ---- HOST: create room ----
    if (msg.type === 'host_create') {
      const roomId = msg.roomId;
      if (!rooms[roomId]) {
        rooms[roomId] = { hostId: msg.playerId, clients: new Set(), players: {} };
      }
      const room = rooms[roomId];
      room.clients.add(ws);
      room.players[msg.playerId] = { name: msg.playerName, id: msg.playerId };
      sockets.set(ws, { playerId: msg.playerId, roomId });
      console.log(`Room ${roomId} created by ${msg.playerName}`);
      ws.send(JSON.stringify({ type: 'host_ack', roomId }));
      return;
    }

    // ---- CLIENT: join room ----
    if (msg.type === 'join_request') {
      const roomId = msg.roomId;
      const room   = rooms[roomId];
      if (!room) {
        ws.send(JSON.stringify({ type: 'join_rejected', reason: 'Room not found. Check the code — the host must create the room first.' }));
        return;
      }
      room.clients.add(ws);
      room.players[msg.playerId] = { name: msg.playerName, id: msg.playerId };
      sockets.set(ws, { playerId: msg.playerId, roomId });
      console.log(`${msg.playerName} joined room ${roomId}`);

      // Tell the host someone joined (host will send join_accepted back)
      broadcast(room, msg, ws); // forward join_request to host

      // Also tell the joiner who's already in the room
      ws.send(JSON.stringify({
        type: 'room_state',
        roomId,
        hostId: room.hostId,
        players: room.players
      }));
      return;
    }

    // ---- All other messages: relay to room ----
    const roomId = info.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    // Forward to everyone in the room (or just sender, as needed)
    if (msg.type === 'join_accepted' && msg.targetId) {
      // Send only to the target client
      for (const client of room.clients) {
        const ci = sockets.get(client);
        if (ci && ci.playerId === msg.targetId && client.readyState === 1) {
          client.send(JSON.stringify(msg));
          break;
        }
      }
      // Also update host's player list
      return;
    }

    // Relay all other messages to everyone except sender
    broadcast(room, msg, ws);
  });

  ws.on('close', () => {
    const info = sockets.get(ws);
    if (info) {
      const { playerId, roomId } = info;
      const room = rooms[roomId];
      if (room) {
        room.clients.delete(ws);
        delete room.players[playerId];
        broadcast(room, { type: 'player_disconnect', playerId });
        if (room.clients.size === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} closed (empty)`);
        } else {
          console.log(`${playerId} left room ${roomId}`);
        }
      }
      sockets.delete(ws);
    }
  });

  ws.on('error', console.error);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     Minecraft Enhanced — Multiplayer Server          ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Open this URL on ALL computers on your network:     ║`);
  console.log(`║                                                       ║`);
  console.log(`║    http://${ip.padEnd(14)}:${PORT}                       ║`);
  console.log(`║                                                       ║`);
  console.log('║  Then: one PC clicks "Host", shares the room code,   ║');
  console.log('║        the other PC clicks "Join" and enters it.     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});
