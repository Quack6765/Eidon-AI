import WebSocket from "ws";

export const MAX_WS_BUFFERED_BYTES = 1024 * 1024;

export function sendWebSocketData(ws: WebSocket, data: string) {
  if (ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  const backlogBytes = ws.bufferedAmount ?? 0;
  if (backlogBytes > MAX_WS_BUFFERED_BYTES) {
    console.warn(
      `[ws-send] closing slow WebSocket client: ${backlogBytes} bytes still queued before a ${Buffer.byteLength(data, "utf8")}-byte send`
    );
    ws.close(1013, "WebSocket client is too slow");
    return false;
  }

  try {
    ws.send(data, (error) => {
      if (error && ws.readyState === WebSocket.OPEN) {
        ws.close(1011, "WebSocket send failed");
      }
    });
  } catch {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, "WebSocket send failed");
    }
    return false;
  }
  return true;
}
