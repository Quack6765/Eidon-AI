import {
  createTextToolCallInterceptor,
  parseToolCallTextBlock
} from "@/lib/tool-call-text-parsing";

describe("parseToolCallTextBlock", () => {
  it("parses the <function=>/<parameter=> tool call format", () => {
    const body =
      " <function=execute_shell_command> <parameter=command>agent-browser screenshot /tmp/ia-quote2.png --full ";

    expect(parseToolCallTextBlock(body)).toEqual({
      name: "execute_shell_command",
      arguments: JSON.stringify({
        command: "agent-browser screenshot /tmp/ia-quote2.png --full"
      })
    });
  });

  it("parses multiple parameters in order", () => {
    const body =
      "<function=create_memory> <parameter=name>favorite-color <parameter=content>blue and green ";

    expect(parseToolCallTextBlock(body)).toEqual({
      name: "create_memory",
      arguments: JSON.stringify({
        name: "favorite-color",
        content: "blue and green"
      })
    });
  });

  it("coerces JSON-looking values and leaves plain text as strings", () => {
    const body =
      "<function=update> <parameter=count>3 <parameter=enabled>true <parameter=label>hello world";

    expect(parseToolCallTextBlock(body)).toEqual({
      name: "update",
      arguments: JSON.stringify({ count: 3, enabled: true, label: "hello world" })
    });
  });

  it("returns empty arguments object when there are no parameters", () => {
    expect(parseToolCallTextBlock("<function=ping> ")).toEqual({
      name: "ping",
      arguments: "{}"
    });
  });

  it("parses the JSON (hermes) tool call form", () => {
    expect(
      parseToolCallTextBlock('{"name":"search","arguments":{"query":"MCP"}}')
    ).toEqual({
      name: "search",
      arguments: JSON.stringify({ query: "MCP" })
    });
  });

  it("returns null for plain prose without a function or json body", () => {
    expect(parseToolCallTextBlock("nothing to see here")).toBeNull();
    expect(parseToolCallTextBlock("")).toBeNull();
    expect(parseToolCallTextBlock("   ")).toBeNull();
  });
});

describe("createTextToolCallInterceptor", () => {
  it("extracts a tool call streamed in a single chunk and strips it from the answer", () => {
    const interceptor = createTextToolCallInterceptor();
    const emitted = interceptor.feed(
      "<tool_call> <function=execute_shell_command> <parameter=command>echo hi </tool_call>"
    );

    expect(emitted).toBe("");
    interceptor.flush();

    expect(interceptor.answer).toBe("");
    expect(interceptor.toolCalls).toEqual([
      {
        id: "text_call_0",
        name: "execute_shell_command",
        arguments: JSON.stringify({ command: "echo hi" })
      }
    ]);
  });

  it("extracts a tool call streamed token-by-token across many chunks", () => {
    const interceptor = createTextToolCallInterceptor();
    const tokens = [
      "Let me run this.\n",
      "<tool_",
      "call>",
      " <function=execute_shell_",
      "command> <parameter=comm",
      "and>agent-browser screenshot /tmp/x.png --full ",
      "</tool_",
      "call>"
    ];

    let emitted = "";
    for (const token of tokens) {
      emitted += interceptor.feed(token);
    }
    emitted += interceptor.flush();

    expect(emitted).toBe("Let me run this.\n");
    expect(interceptor.answer).toBe("Let me run this.\n");
    expect(interceptor.toolCalls).toEqual([
      {
        id: "text_call_0",
        name: "execute_shell_command",
        arguments: JSON.stringify({
          command: "agent-browser screenshot /tmp/x.png --full"
        })
      }
    ]);
  });

  it("keeps leading and trailing answer text around an extracted tool call", () => {
    const interceptor = createTextToolCallInterceptor();
    interceptor.feed("before <tool_call> <function=noop> </tool_call> after");
    interceptor.flush();

    expect(interceptor.answer).toBe("before  after");
    expect(interceptor.toolCalls).toHaveLength(1);
  });

  it("passes ordinary answer text through unchanged", () => {
    const interceptor = createTextToolCallInterceptor();

    expect(interceptor.feed("Hello ")).toBe("Hello ");
    expect(interceptor.feed("world")).toBe("world");
    interceptor.flush();

    expect(interceptor.answer).toBe("Hello world");
    expect(interceptor.toolCalls).toEqual([]);
  });

  it("holds back a partial open tag until it resolves", () => {
    const interceptor = createTextToolCallInterceptor();

    expect(interceptor.feed("see <")).toBe("see ");
    expect(interceptor.feed("tool_")).toBe("");
    expect(interceptor.feed("call>")).toBe("");
    interceptor.feed(" <function=go> </tool_call>");
    interceptor.flush();

    expect(interceptor.toolCalls).toHaveLength(1);
    expect(interceptor.toolCalls[0].name).toBe("go");
  });

  it("restores an unparseable tool call block as answer text", () => {
    const interceptor = createTextToolCallInterceptor();
    interceptor.feed("<tool_call>not a real tool call</tool_call>");
    interceptor.flush();

    expect(interceptor.answer).toBe("<tool_call>not a real tool call</tool_call>");
    expect(interceptor.toolCalls).toEqual([]);
  });

  it("flushes a trailing bare open bracket as answer text", () => {
    const interceptor = createTextToolCallInterceptor();
    interceptor.feed("if a <");
    const tail = interceptor.flush();

    expect(tail).toBe("<");
    expect(interceptor.answer).toBe("if a <");
  });

  it("parses an unterminated tool call block on flush", () => {
    const interceptor = createTextToolCallInterceptor();
    interceptor.feed("<tool_call> <function=execute_shell_command> <parameter=command>pwd");
    interceptor.flush();

    expect(interceptor.toolCalls).toEqual([
      {
        id: "text_call_0",
        name: "execute_shell_command",
        arguments: JSON.stringify({ command: "pwd" })
      }
    ]);
    expect(interceptor.answer).toBe("");
  });
});
