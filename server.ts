import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWebSocketHandler } from "@/lib/ws-handler";

const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev: process.env.NODE_ENV !== "production" });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  setupWebSocketHandler(wss);

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
