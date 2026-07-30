import { createThinkingDelimiterInterceptor, stripThinkingDelimiters } from "@/lib/thinking-delimiter-parsing";
import { createTextToolCallInterceptor } from "@/lib/tool-call-text-parsing";

describe("createThinkingDelimiterInterceptor", () => {
  it("extracts a think block streamed in a single chunk", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    const result = interceptor.feed("<think>reasoning here</think>the answer");

    expect(result.thinking).toBe("reasoning here");
    expect(result.answer).toBe("the answer");
  });

  it("extracts a think block streamed token-by-token across many chunks", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    const tokens = [
      "<thi",
      "nk>",
      "let me reason ",
      "step by step",
      "</thin",
      "k>",
      "\n\nHere is the answer."
    ];

    let answer = "";
    let thinking = "";
    for (const token of tokens) {
      const result = interceptor.feed(token);
      answer += result.answer;
      thinking += result.thinking;
    }
    const tail = interceptor.flush();
    answer += tail.answer;
    thinking += tail.thinking;

    expect(thinking).toBe("let me reason step by step");
    expect(answer).toBe("\n\nHere is the answer.");
  });

  it("keeps text before and after a think block as answer", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    const result = interceptor.feed("before <think>hidden</think> after");
    interceptor.flush();

    expect(result.answer).toBe("before  after");
    expect(result.thinking).toBe("hidden");
  });

  it("passes ordinary answer text through unchanged when no tags are present", () => {
    const interceptor = createThinkingDelimiterInterceptor();

    expect(interceptor.feed("Hello ")).toEqual({ answer: "Hello ", thinking: "" });
    expect(interceptor.feed("world")).toEqual({ answer: "world", thinking: "" });
    const tail = interceptor.flush();

    expect(tail.answer).toBe("");
    expect(tail.thinking).toBe("");
  });

  it("does not treat the word 'think' in prose as a delimiter", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    const result = interceptor.feed("I think therefore I am");

    expect(result.answer).toBe("I think therefore I am");
    expect(result.thinking).toBe("");
  });

  it("holds back a partial open tag until it resolves", () => {
    const interceptor = createThinkingDelimiterInterceptor();

    expect(interceptor.feed("see <")).toEqual({ answer: "see ", thinking: "" });
    expect(interceptor.feed("thi")).toEqual({ answer: "", thinking: "" });
    expect(interceptor.feed("nk>")).toEqual({ answer: "", thinking: "" });
    const thinkResult = interceptor.feed("reasoning");
    expect(thinkResult).toEqual({ answer: "", thinking: "reasoning" });
    interceptor.feed("</think>");
    const tail = interceptor.flush();

    expect(tail.answer).toBe("");
  });

  it("keeps accumulated reasoning as thinking when the stream ends before the close tag", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    interceptor.feed("<think>partial reasoning with no close");

    const tail = interceptor.flush();

    expect(tail.thinking).toBe("");
    expect(tail.answer).toBe("");
  });

  it("restores a bare partial open tag as answer text on flush", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    interceptor.feed("if a <thin");
    const tail = interceptor.flush();

    expect(tail.answer).toBe("<thin");
    expect(tail.thinking).toBe("");
  });

  it("handles an open tag with attributes", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    const result = interceptor.feed('<think type="reasoning">hidden</think>visible');

    expect(result.thinking).toBe("hidden");
    expect(result.answer).toBe("visible");
  });

  it("handles multiple sequential think blocks", () => {
    const interceptor = createThinkingDelimiterInterceptor();
    let answer = "";
    let thinking = "";
    for (const token of [
      "<think>first</think>",
      "middle ",
      "<think>second</think>",
      "end"
    ]) {
      const result = interceptor.feed(token);
      answer += result.answer;
      thinking += result.thinking;
    }
    interceptor.flush();

    expect(thinking).toBe("firstsecond");
    expect(answer).toBe("middle end");
  });

  it("feeds extracted answer text through a downstream tool-call interceptor", () => {
    const thinking = createThinkingDelimiterInterceptor();
    const tools = createTextToolCallInterceptor();

    const stream = [
      "<think>I should run a command.</think>",
      "Let me try.\n<tool_call> <function=execute_shell_command> <parameter=command>pwd </tool_call>"
    ];

    let answer = "";
    for (const chunk of stream) {
      const split = thinking.feed(chunk);
      answer += tools.feed(split.answer);
    }
    const thinkingTail = thinking.flush();
    if (thinkingTail.answer) {
      answer += tools.feed(thinkingTail.answer);
    }
    answer += tools.flush();

    expect(tools.toolCalls).toEqual([
      {
        id: "text_call_0",
        name: "execute_shell_command",
        arguments: JSON.stringify({ command: "pwd" })
      }
    ]);
    expect(answer).toBe("Let me try.\n");
  });
});

describe("stripThinkingDelimiters", () => {
  it("removes a complete think block and returns only the answer", () => {
    expect(
      stripThinkingDelimiters("<think>internal reasoning</think>public answer")
    ).toBe("public answer");
  });

  it("strips a multi-line think block leaving the trailing answer", () => {
    const raw = "<think>\nThe user wants a title.\nOptions:\n- A\n- B\n</think>\nExplaining Gravity";
    expect(stripThinkingDelimiters(raw)).toBe("\nExplaining Gravity");
  });

  it("returns text unchanged when no think tags are present", () => {
    expect(stripThinkingDelimiters("just a normal answer")).toBe("just a normal answer");
  });

  it("returns empty string when the response is only a think block", () => {
    expect(stripThinkingDelimiters("<think>only reasoning</think>")).toBe("");
  });

  it("handles think tags split across the string", () => {
    expect(
      stripThinkingDelimiters("<thi" + "nk>half</thin" + "k>rest")
    ).toBe("rest");
  });

  it("returns falsy input unchanged", () => {
    expect(stripThinkingDelimiters("")).toBe("");
  });
});
