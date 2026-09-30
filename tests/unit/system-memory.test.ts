import { availableMemoryMb, cgroupMemoryLimitMb } from "@/lib/system-memory";

const { readFileMock, totalmemMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  totalmemMock: vi.fn()
}));

vi.mock("node:fs", () => ({ readFileSync: readFileMock }));
vi.mock("node:os", () => ({ totalmem: totalmemMock }));

const MB = 1024 * 1024;

function cgroupFiles(files: Record<string, string>) {
  readFileMock.mockImplementation((path: string) => {
    if (path in files) return files[path];
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
}

describe("system memory", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    totalmemMock.mockReset();
    totalmemMock.mockReturnValue(64 * 1024 * MB);
  });

  it("uses the cgroup v2 limit instead of the host memory", () => {
    cgroupFiles({ "/sys/fs/cgroup/memory.max": `${4 * 1024 * MB}\n` });

    expect(cgroupMemoryLimitMb()).toBe(4096);
    expect(availableMemoryMb()).toBe(4096);
  });

  it("uses the cgroup v1 limit when the v2 file is missing", () => {
    cgroupFiles({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": `${2048 * MB}` });

    expect(cgroupMemoryLimitMb()).toBe(2048);
  });

  it("prefers the v2 limit when both layouts are present", () => {
    cgroupFiles({
      "/sys/fs/cgroup/memory.max": `${1024 * 1024}`,
      "/sys/fs/cgroup/memory/memory.limit_in_bytes": `${8192 * MB}`
    });

    expect(cgroupMemoryLimitMb()).toBe(1);
  });

  it("ignores an unlimited v2 limit", () => {
    cgroupFiles({ "/sys/fs/cgroup/memory.max": "max\n" });

    expect(cgroupMemoryLimitMb()).toBeNull();
    expect(availableMemoryMb()).toBe(64 * 1024);
  });

  it("ignores the sentinel value an unlimited v1 limit reports", () => {
    cgroupFiles({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712" });

    expect(cgroupMemoryLimitMb()).toBeNull();
    expect(availableMemoryMb()).toBe(64 * 1024);
  });

  it("falls back to host memory when neither cgroup file can be read", () => {
    cgroupFiles({});

    expect(cgroupMemoryLimitMb()).toBeNull();
    expect(availableMemoryMb()).toBe(64 * 1024);
  });

  it.each([
    ["empty", ""],
    ["not a number", "unlimited\n"],
    ["zero", "0"],
    ["negative", `-${1024 * MB}`]
  ])("ignores a %s limit value", (_label, contents) => {
    cgroupFiles({
      "/sys/fs/cgroup/memory.max": contents,
      "/sys/fs/cgroup/memory/memory.limit_in_bytes": contents
    });

    expect(cgroupMemoryLimitMb()).toBeNull();
  });

  it("never reports more than the host has", () => {
    cgroupFiles({ "/sys/fs/cgroup/memory.max": `${128 * 1024 * MB}` });

    expect(availableMemoryMb()).toBe(64 * 1024);
  });

  it("rounds a partial megabyte limit down", () => {
    cgroupFiles({ "/sys/fs/cgroup/memory.max": `${1536 * MB + 512 * 1024}` });

    expect(cgroupMemoryLimitMb()).toBe(1536);
  });
});