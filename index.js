/**
 * Cloudflare Worker entry point for Friend-to-Friend WebRTC signaling.
 * Room traffic is routed through a Durable Object so both players share one
 * room even when Cloudflare serves their WebSocket connections on different
 * Worker instances.
 *
 * Requires the existing Durable Object binding: env.RELAY (class Relay).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "mcf2f-srelay" });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }

    const room = (url.searchParams.get("room") ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(room)) {
      return new Response("A valid room code is required in ?room=CODE", { status: 400 });
    }

    const id = env.RELAY.idFromName(room);
    return env.RELAY.get(id).fetch(request);
  },
};

/** One Durable Object instance handles every signaling socket for one room. */
export class Relay {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const url = new URL(request.url);

    server.serializeAttachment({ role: url.searchParams.get("role") ?? "guest" });
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(sender, rawMessage) {
    let message;
    try {
      message = JSON.parse(
        typeof rawMessage === "string"
          ? rawMessage
          : new TextDecoder().decode(rawMessage)
      );
    } catch {
      sender.send(JSON.stringify({ type: "error", message: "Invalid signaling message" }));
      return;
    }

    if (!["join", "offer", "answer", "candidate"].includes(message.type)) {
      sender.send(JSON.stringify({ type: "error", message: "Unknown signaling message type" }));
      return;
    }

    if (message.type === "join") {
      const cachedOffer = await this.state.storage.get("lastOffer");
      if (cachedOffer && Date.now() - cachedOffer.createdAt < 5 * 60 * 1000) {
        sender.send(cachedOffer.payload);
      }

      const cachedCandidates =
        (await this.state.storage.get("hostCandidates")) ?? [];

      for (const candidate of cachedCandidates) {
        if (Date.now() - candidate.createdAt < 5 * 60 * 1000) {
          sender.send(candidate.payload);
        }
      }
      return;
    }

    const payload = JSON.stringify(message);

    if (message.type === "offer") {
      await this.state.storage.put("lastOffer", {
        payload,
        createdAt: Date.now(),
      });
    }

    if (
      message.type === "candidate" &&
      sender.deserializeAttachment()?.role === "host"
    ) {
      const cutoff = Date.now() - 5 * 60 * 1000;
      const candidates =
        (await this.state.storage.get("hostCandidates") ?? [])
          .filter((candidate) => candidate.createdAt >= cutoff);

      candidates.push({ payload, createdAt: Date.now() });
      await this.state.storage.put("hostCandidates", candidates);
    }

    for (const socket of this.state.getWebSockets()) {
      if (socket === sender) continue;

      try {
        socket.send(payload);
      } catch {
        // A closed peer will be removed by Cloudflare's WebSocket lifecycle.
      }
    }
  }

  async webSocketClose(_socket, code, reason) {
    console.log(`Signaling socket closed (${code}): ${reason}`);
  }

  async webSocketError(_socket, error) {
    console.error("Signaling WebSocket error", error);
  }
}
