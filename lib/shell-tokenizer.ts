export function tokenizeShellCommand(command: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    tokens.push(current);
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }

      if (character === "\\" && quote === '"') {
        escaped = true;
        continue;
      }

      current += character;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }

    if (character === ";" || character === "|" || character === "&") {
      pushCurrent();
      const nextCharacter = command[index + 1];
      if ((character === "|" || character === "&") && nextCharacter === character) {
        tokens.push(character + nextCharacter);
        index += 1;
      } else {
        tokens.push(character);
      }
      continue;
    }

    current += character;
  }

  pushCurrent();
  return tokens;
}

export function isAgentBrowserToken(token: string) {
  const normalized = token.trim().replace(/\\/g, "/");
  const basename = normalized.split("/").at(-1)?.toLowerCase();
  return basename === "agent-browser";
}

export function extractAgentBrowserScreenshotPaths(command: string) {
  const tokens = tokenizeShellCommand(command);
  const screenshotPaths = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isAgentBrowserToken(tokens[index] ?? "")) {
      continue;
    }

    if ((tokens[index + 1] ?? "").toLowerCase() !== "screenshot") {
      continue;
    }

    for (let candidateIndex = index + 2; candidateIndex < tokens.length; candidateIndex += 1) {
      const candidate = tokens[candidateIndex] ?? "";
      if (
        !candidate ||
        candidate === ";" ||
        candidate === "|" ||
        candidate === "||" ||
        candidate === "&" ||
        candidate === "&&"
      ) {
        break;
      }

      if (candidate.startsWith("-")) {
        continue;
      }

      screenshotPaths.add(candidate);
      break;
    }
  }

  return [...screenshotPaths];
}
