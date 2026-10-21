const MAX_ROOM_LENGTH = 64;
const MAX_SDP_LENGTH = 200_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json({ status: "ok", service: "mcf2f-signaling-server" });
    }

    if (url.pathname !== "/" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Not found", { status: 404 });
    }

    const id = env.RELAY.idFromName("mcf2f-global-relay");
    return env.RELAY.get(id).fetch(request);
  },
};

export class Relay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peerId: crypto.randomUUID(), room: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    if (typeof rawMessage !== "string") {
      ws.close(1003, "Text JSON messages required");
      return;
    }

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      ws.close(1007, "Invalid JSON");
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;

    const attachment = ws.deserializeAttachment() || { peerId: crypto.randomUUID(), room: null };
    const type = message.type;

    if (type === "join") {
      const roomName = message.room;
      if (typeof roomName !== "string" || roomName.length < 1 || roomName.length > MAX_ROOM_LENGTH || !/^[A-Za-z0-9_-]+$/.test(roomName)) {
        ws.close(1008, "Invalid room code");
        return;
      }

      if (attachment.room && attachment.room !== roomName) {
        await this.removeOfferOwnerIfNeeded(attachment.room, attachment.peerId);
      }

      const peers = this.peersInRoom(roomName);
      if (!peers.some((peer) => peer === ws) && peers.length >= 2) {
        ws.close(1013, "Room is full");
        return;
      }

      attachment.room = roomName;
      ws.serializeAttachment(attachment);
      ws.send(JSON.stringify({ type: "room", room: roomName }));

      const savedOffer = await this.ctx.storage.get(`offer:${roomName}`);
      if (savedOffer && savedOffer.ownerId !== attachment.peerId) {
        ws.send(JSON.stringify(savedOffer.message));
      }
      return;
    }

    if (type !== "offer" && type !== "answer") return;
    const roomName = attachment.room;
    if (!roomName || (message.room != null && message.room !== roomName)) return;
    if (typeof message.sdp !== "string" || message.sdp.length > MAX_SDP_LENGTH) return;

    const outgoing = { type, room: roomName, sdp: message.sdp };
    const peers = this.peersInRoom(roomName);

    if (type === "offer") {
      await this.ctx.storage.put(`offer:${roomName}`, { ownerId: attachment.peerId, message: outgoing });
      for (const peer of peers) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify(outgoing));
      }
      return;
    }

    const savedOffer = await this.ctx.storage.get(`offer:${roomName}`);
    if (savedOffer && savedOffer.ownerId !== attachment.peerId) {
      const owner = peers.find((peer) => {
        const peerAttachment = peer.deserializeAttachment();
        return peerAttachment?.peerId === savedOffer.ownerId;
      });
      if (owner && owner.readyState === WebSocket.OPEN) owner.send(JSON.stringify(outgoing));
    }
  }

  async webSocketClose(ws) {
    await this.handleClose(ws);
  }

  async webSocketError(ws) {
    await this.handleClose(ws);
  }

  async handleClose(ws) {
    const attachment = ws.deserializeAttachment();
    if (attachment?.room && attachment?.peerId) {
      await this.removeOfferOwnerIfNeeded(attachment.room, attachment.peerId);
    }
  }

  async removeOfferOwnerIfNeeded(roomName, peerId) {
    const key = `offer:${roomName}`;
    const savedOffer = await this.ctx.storage.get(key);
    if (savedOffer?.ownerId === peerId) await this.ctx.storage.delete(key);
  }

  peersInRoom(roomName) {
    return this.ctx.getWebSockets().filter((peer) => {
      const attachment = peer.deserializeAttachment();
      return attachment?.room === roomName && peer.readyState !== WebSocket.CLOSED;
    });
  }
}
