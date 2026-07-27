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
