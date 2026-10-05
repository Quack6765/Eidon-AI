import { createServer } from "node:http";

const port = Number(process.argv[2]);
const origin = `http://127.0.0.1:${port}`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign in · Example Payments</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f9; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; color: #151826; }
  main { width: 380px; padding: 36px; border-radius: 16px; background: #fff; box-shadow: 0 12px 40px rgba(30, 40, 90, 0.12); }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; }
  .mark { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #7c5cff, #4f8cff); }
  h1 { margin: 28px 0 6px; font-size: 22px; }
  p { margin: 0 0 22px; color: #5b6075; font-size: 14px; line-height: 1.5; }
  label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: #5b6075; }
  .code { display: flex; gap: 8px; margin-bottom: 22px; }
  .code span { flex: 1; height: 52px; border: 1.5px solid #d9dcea; border-radius: 10px; }
  .code span:first-child { border-color: #7c5cff; }
  button { width: 100%; height: 44px; border: 0; border-radius: 10px; background: #5b3df5; color: #fff; font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="mark"></span>Example Payments</div>
  <h1>Two-factor verification</h1>
  <p>Enter the 6-digit code from your authenticator app to open your payouts dashboard.</p>
  <label>Verification code</label>
  <div class="code"><span></span><span></span><span></span><span></span><span></span><span></span></div>
  <button>Verify and continue</button>
</main>
</body>
</html>`;

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")));
  });
}

function send(response, delta, finishReason = null) {
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl_readme",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "readme-mock",
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\n\n`
  );
}

function streamTurn(response, text, toolCall) {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
  send(response, { role: "assistant", content: text });
  send(response, {
    tool_calls: [
      {
        index: 0,
        id: `call_${toolCall.name}`,
        type: "function",
        function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) }
      }
    ]
  });
  send(response, {}, "tool_calls");
  response.write("data: [DONE]\n\n");
  response.end();
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/payouts") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }

  const body = await readBody(request);

  if (body.stream !== true) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl_readme_title",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "readme-mock",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Payouts check" } }]
      })
    );
    return;
  }

  const toolResults = (body.messages ?? []).filter((message) => message.role === "tool").length;

  if (toolResults === 0) {
    streamTurn(response, "Opening the payments dashboard in my browser.", {
      name: "execute_shell_command",
      arguments: { command: "agent-browser set viewport 1280 400" }
    });
    return;
  }

  if (toolResults === 1) {
    streamTurn(response, "", {
      name: "execute_shell_command",
      arguments: { command: `agent-browser open ${origin}/payouts` }
    });
    return;
  }

  streamTurn(response, "The dashboard is asking for a two-factor code, which only you have.", {
    name: "request_takeover",
    arguments: { reason: "Enter the two-factor code from your authenticator app to open the payouts dashboard." }
  });
}).listen(port, "127.0.0.1");
