/// <reference types="bun" />
import type { Server, ServerWebSocket } from "bun";
import { buildRouter } from "./http/router";
import { WebSocketHub } from "./ws/server";

const HOST = Bun.env.HOST || "0.0.0.0";
const PORT = Number(Bun.env.PORT || 3000);

const router = buildRouter();
const hub = new WebSocketHub();

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch(req: Request, server: Server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) {
        return new Response(null, { status: 101 });
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return router.handle(req);
  },
  websocket: {
    open: (ws: ServerWebSocket) => hub.onOpen(ws),
    message: (ws: ServerWebSocket, msg: string | Uint8Array) => hub.onMessage(ws, msg),
    close: (ws: ServerWebSocket) => hub.onClose(ws)
  }
});

console.log(`Server listening on http://${HOST}:${PORT}`);

