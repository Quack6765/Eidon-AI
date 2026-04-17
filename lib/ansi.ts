export type AnsiTextSegment = {
  text: string;
  foregroundColor:
    | "black"
    | "red"
    | "green"
    | "yellow"
    | "blue"
    | "magenta"
    | "cyan"
    | "white"
    | null;
  bold: boolean;
};

const ANSI_SGR_PATTERN = /\u001b\[([0-9;]*)m/g;

const STANDARD_FOREGROUND_COLOR_CODES = new Map<number, NonNullable<AnsiTextSegment["foregroundColor"]>>([
  [30, "black"],
  [31, "red"],
  [32, "green"],
  [33, "yellow"],
  [34, "blue"],
  [35, "magenta"],
  [36, "cyan"],
  [37, "white"],
  [90, "black"],
  [91, "red"],
  [92, "green"],
  [93, "yellow"],
  [94, "blue"],
  [95, "magenta"],
  [96, "cyan"],
  [97, "white"]
]);

type AnsiRenderState = Pick<AnsiTextSegment, "foregroundColor" | "bold">;

const DEFAULT_ANSI_STATE: AnsiRenderState = {
  foregroundColor: null,
  bold: false
};

function pushAnsiTextSegment(
  segments: AnsiTextSegment[],
  text: string,
  state: AnsiRenderState
) {
  if (!text) {
    return;
  }

  const previousSegment = segments[segments.length - 1];

  if (
    previousSegment &&
    previousSegment.foregroundColor === state.foregroundColor &&
    previousSegment.bold === state.bold
  ) {
    previousSegment.text += text;
    return;
  }

  segments.push({
    text,
    foregroundColor: state.foregroundColor,
    bold: state.bold
  });
}

function applyAnsiSgrCode(state: AnsiRenderState, code: number) {
  if (code === 0) {
    state.foregroundColor = null;
    state.bold = false;
    return;
  }

  if (code === 1) {
    state.bold = true;
    return;
  }

  if (code === 22) {
    state.bold = false;
    return;
  }

  if (code === 39) {
    state.foregroundColor = null;
    return;
  }

  const nextForegroundColor = STANDARD_FOREGROUND_COLOR_CODES.get(code);

  if (nextForegroundColor) {
    state.foregroundColor = nextForegroundColor;
  }
}

export function parseAnsiText(input: string) {
  const segments: AnsiTextSegment[] = [];
  const state: AnsiRenderState = { ...DEFAULT_ANSI_STATE };
  let lastIndex = 0;

  for (const match of input.matchAll(ANSI_SGR_PATTERN)) {
    const matchIndex = match.index ?? 0;
    pushAnsiTextSegment(segments, input.slice(lastIndex, matchIndex), state);

    const codes = match[1]
      ? match[1].split(";").map((code) => Number.parseInt(code, 10)).filter((code) => Number.isFinite(code))
      : [0];

    for (const code of codes) {
      applyAnsiSgrCode(state, code);
    }

    lastIndex = matchIndex + match[0].length;
  }

  pushAnsiTextSegment(segments, input.slice(lastIndex), state);

  return segments;
}
