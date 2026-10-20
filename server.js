const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

// ... (paste the rest of your Map and wss.on logic here)
