import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = Number.parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res);
});

wss.on("connection", (ws) => {
  sendJson(ws, {
    type: "status",
    status: "connected",
    transport: "local-websocket",
  });

  ws.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      sendJson(ws, { type: "error", error: "Invalid JSON message." });
      return;
    }

    if (payload.type !== "observation") {
      sendJson(ws, { type: "error", error: "Unsupported live message type." });
      return;
    }

    sendJson(ws, {
      type: "status",
      status: "processing",
      timestamp: payload.timestamp ?? 0,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/live/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      sendJson(ws, {
        type: res.ok ? "observation" : "error",
        ...body,
      });
    } catch (error) {
      sendJson(ws, {
        type: "error",
        error:
          error instanceof Error
            ? error.message
            : "Live proxy request failed.",
      });
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url || "/", `http://${req.headers.host}`);
  if (pathname !== "/api/live") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(port, () => {
  console.log(`Lens cockpit ready at http://${hostname}:${port}`);
});
