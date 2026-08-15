import fs from "node:fs";
import readline from "node:readline";

const STDERR_SPAM_BYTES = 256 * 1024;

function writeAllToStderr(buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    try {
      offset += fs.writeSync(2, buffer, offset, buffer.length - offset);
    } catch (error) {
      if (error?.code === "EAGAIN") {
        continue;
      }
      throw error;
    }
  }
}

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const tools = [
  {
    name: "spam_stderr",
    description: "Fills the stderr pipe and then succeeds",
    inputSchema: { type: "object", properties: {} }
  }
];

const lineReader = readline.createInterface({ input: process.stdin });

lineReader.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp-stdio-server", version: "1.0.0" }
      }
    });
    return;
  }

  if (message.method === "tools/list") {
    reply({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }

  if (message.method === "tools/call") {
    writeAllToStderr(Buffer.alloc(STDERR_SPAM_BYTES, 0x78));
    reply({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "stderr drained" }] }
    });
  }
});
