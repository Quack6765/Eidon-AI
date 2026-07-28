import http from "node:http";

const port = Number(process.env.PORT || 4010);
const failOnceAttempts = new Map();
const failedStreamRequestsBeforeRecovery = 9;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error("Request too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function promptText(body) {
  return JSON.stringify(body.messages ?? body.input ?? "");
}

function failureKey(body, prompt) {
  if (!Array.isArray(body.messages)) return prompt;
  const message = body.messages.findLast((item) =>
    item?.role === "user" && JSON.stringify(item.content).includes("[fail-once]")
  );
  return message ? JSON.stringify(message.content) : prompt;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    return json(response, 200, {
      object: "list",
      data: [{ id: "eidon-native-test", object: "model", owned_by: "eidon" }]
    });
  }

  if (request.method !== "POST" || !request.url?.startsWith("/v1/")) {
    return json(response, 404, { error: { message: "Not found" } });
  }

  try {
    const body = JSON.parse(await readBody(request));
    const prompt = promptText(body);
    const failureAttemptKey = failureKey(body, prompt);
    const promptFailureAttempts = failOnceAttempts.get(failureAttemptKey) ?? 0;
    if (
      body.stream
      && prompt.includes("[fail-once]")
      && promptFailureAttempts < failedStreamRequestsBeforeRecovery
    ) {
      failOnceAttempts.set(failureAttemptKey, promptFailureAttempts + 1);
      return json(response, 503, { error: { message: "Deterministic provider failure" } });
    }
    if (prompt.includes("[fail]")) {
      return json(response, 503, { error: { message: "Deterministic provider failure" } });
    }
    if (body.stream && prompt.includes("[slow]")) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const content = "Deterministic native-client integration response.";
    if (body.stream) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 } })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }

    return json(response, 200, {
      id: "native-test-completion",
      object: "chat.completion",
      model: "eidon-native-test",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 }
    });
  } catch {
    return json(response, 400, { error: { message: "Invalid request" } });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Native fake provider listening on ${port}`);
});
