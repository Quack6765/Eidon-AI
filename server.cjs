const { createServer } = require("node:http");
const next = require("next");
const { WebSocketServer } = require("ws");

const port = parseInt(process.env.PORT ?? "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  const { setupWebSocketHandler } = require("./ws-handler-compiled.cjs");
  setupWebSocketHandler(wss);

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
