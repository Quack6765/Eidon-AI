const CONTENT_DISPOSITION_PARAM_PATTERN = /;\s*([A-Za-z0-9*_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;

function sanitizeQuotedBytes(value: Buffer) {
  return Buffer.from(value.filter((byte) => byte !== 0x22 && byte !== 0x5c && byte !== 0x0d && byte !== 0x0a));
}

function percentDecodeToBytes(value: string) {
  const source = Buffer.from(value, "latin1");
  const decoded: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    if (
      source[index] === 0x25 &&
      index + 2 < source.length &&
      /^[0-9a-fA-F]{2}$/.test(source.subarray(index + 1, index + 3).toString("latin1"))
    ) {
      decoded.push(Number.parseInt(source.subarray(index + 1, index + 3).toString("latin1"), 16));
      index += 2;
      continue;
    }
    decoded.push(source[index]);
  }

  return Buffer.from(decoded);
}

function decodeExtendedValueBytes(value: string) {
  const separator = value.indexOf("'");
  const secondSeparator = separator >= 0 ? value.indexOf("'", separator + 1) : -1;
  return percentDecodeToBytes(secondSeparator >= 0 ? value.slice(secondSeparator + 1) : value);
}

function normalizeContentDispositionLine(line: string) {
  const params = new Map<string, Buffer>();

  for (const match of line.matchAll(CONTENT_DISPOSITION_PARAM_PATTERN)) {
    const key = match[1].toLowerCase();
    if (params.has(key)) continue;

    if (key.endsWith("*")) {
      params.set(key, decodeExtendedValueBytes(match[3] ?? ""));
    } else {
      params.set(key, Buffer.from(match[2] ?? match[3] ?? "", "latin1"));
    }
  }

  const dispositionType = line.split(";")[0].trim() || "form-data";
  const name = sanitizeQuotedBytes(params.get("name") ?? Buffer.alloc(0));
  const hasFilename = params.has("filename") || params.has("filename*");
  const filename = sanitizeQuotedBytes(
    params.get("filename*") ?? params.get("filename") ?? Buffer.alloc(0)
  );

  const chunks = [Buffer.from(`Content-Disposition: ${dispositionType}; name="`, "latin1"), name];

  if (hasFilename) {
    chunks.push(Buffer.from(`"; filename="`, "latin1"), filename);
  }

  chunks.push(Buffer.from(`"`, "latin1"));
  return Buffer.concat(chunks);
}

function normalizePartHeaders(headers: Buffer) {
  const lines = headers.toString("latin1").split("\r\n");
  const chunks: Buffer[] = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      chunks.push(Buffer.from("\r\n", "latin1"));
    }
    chunks.push(
      /^content-disposition\s*:/i.test(line.trim())
        ? normalizeContentDispositionLine(line.slice(line.indexOf(":") + 1).trim())
        : Buffer.from(line, "latin1")
    );
  });

  return Buffer.concat(chunks);
}

export function normalizeMultipartBody(body: Buffer, contentType: string | null): Buffer {
  const boundaryMatch = /boundary=(?:"([^"]*)"|([^;\s]+))/i.exec(contentType ?? "");
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return body;

  const dashBoundary = Buffer.from(`--${boundary}`);
  const replacements: Array<{ start: number; end: number; value: Buffer }> = [];

  let cursor = body.indexOf(dashBoundary);
  while (cursor !== -1) {
    const afterDelimiter = cursor + dashBoundary.length;

    if (body[afterDelimiter] === 0x2d && body[afterDelimiter + 1] === 0x2d) {
      break;
    }

    const partStart =
      body[afterDelimiter] === 0x0d && body[afterDelimiter + 1] === 0x0a
        ? afterDelimiter + 2
        : afterDelimiter;

    const nextDelimiter = body.indexOf(dashBoundary, partStart);
    const partEnd = nextDelimiter === -1 ? body.length : Math.max(partStart, nextDelimiter - 2);

    const headerEndSequence = body.indexOf("\r\n\r\n", partStart);
    if (headerEndSequence !== -1 && headerEndSequence < partEnd) {
      replacements.push({
        start: partStart,
        end: headerEndSequence,
        value: normalizePartHeaders(body.subarray(partStart, headerEndSequence))
      });
    }

    cursor = nextDelimiter;
  }

  if (!replacements.length) {
    return body;
  }

  const chunks: Buffer[] = [];
  let position = 0;
  for (const replacement of replacements) {
    chunks.push(body.subarray(position, replacement.start));
    chunks.push(replacement.value);
    position = replacement.end;
  }
  chunks.push(body.subarray(position));
  return Buffer.concat(chunks);
}

export async function parseMultipartFormData(
  body: ArrayBuffer,
  contentType: string | null
): Promise<FormData> {
  const normalized = normalizeMultipartBody(Buffer.from(body), contentType);
  return new Response(new Uint8Array(normalized), {
    headers: { "content-type": contentType ?? "multipart/form-data" }
  }).formData();
}
