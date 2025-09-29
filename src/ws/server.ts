/// <reference types="bun" />
import type { ServerWebSocket } from "bun";
type Client = {
  id: string;
  socket: ServerWebSocket<unknown>;
};

export class WebSocketHub {
  private clients: Map<string, Client> = new Map();

  constructor(private opts: { heartbeatMs?: number } = {}) {}

  onOpen(ws: ServerWebSocket<unknown>) {
    const id = crypto.randomUUID();
    this.clients.set(id, { id, socket: ws });
    ws.subscribe("broadcast");
    ws.send(JSON.stringify({ type: "welcome", id }));
  }

  onMessage(ws: ServerWebSocket<unknown>, message: string | Uint8Array) {
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      const data = JSON.parse(text);
      if (data?.type === "echo") {
        ws.send(JSON.stringify({ type: "echo", payload: data.payload }));
        return;
      }
      if (data?.type === "broadcast") {
        ws.publish("broadcast", JSON.stringify({ type: "broadcast", payload: data.payload }));
        return;
      }
      ws.send(JSON.stringify({ type: "error", error: "unknown message" }));
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", error: "invalid json" }));
    }
  }

  onClose(ws: ServerWebSocket<unknown>) {
    for (const [id, c] of this.clients) {
      if (c.socket === ws) this.clients.delete(id);
    }
  }
}

