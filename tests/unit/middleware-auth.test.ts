import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

const originalPasswordLogin = process.env.EIDON_PASSWORD_LOGIN_ENABLED;

afterEach(() => {
  if (originalPasswordLogin === undefined) {
    delete process.env.EIDON_PASSWORD_LOGIN_ENABLED;
  } else {
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = originalPasswordLogin;
  }
});

describe("middleware authentication defaults", () => {
  it.each([
    ["unset", undefined],
    ["set to true", "true"]
  ])("redirects to login when password login is %s", async (_label, value) => {
    if (value === undefined) {
      delete process.env.EIDON_PASSWORD_LOGIN_ENABLED;
    } else {
      process.env.EIDON_PASSWORD_LOGIN_ENABLED = value;
    }

    const response = await middleware(new NextRequest("http://localhost/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("keeps the explicit opt-out passthrough when password login is set to false", async () => {
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "false";

    const response = await middleware(new NextRequest("http://localhost/"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();

    const loginResponse = await middleware(new NextRequest("http://localhost/login"));

    expect(loginResponse.status).toBe(307);
    expect(loginResponse.headers.get("location")).toBe("http://localhost/");
  });
});
