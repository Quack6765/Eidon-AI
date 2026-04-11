import { describe, it, expect } from "vitest";
import {
  listMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  getMemoryCount
} from "@/lib/memories";
import { createLocalUser } from "@/lib/users";

describe("memories", () => {
  describe("listMemories", () => {
    it("returns empty array when no memories exist", () => {
      expect(listMemories()).toEqual([]);
    });

    it("returns all memories without filter", () => {
      createMemory("User lives in Montreal", "location");
      createMemory("Prefers TypeScript", "preference");
      const memories = listMemories();
      expect(memories).toHaveLength(2);
    });

    it("filters by category", () => {
      createMemory("User lives in Montreal", "location");
      createMemory("Prefers TypeScript", "preference");
      const memories = listMemories({ category: "location" });
      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe("location");
    });

    it("filters by search text", () => {
      createMemory("User lives in Montreal", "location");
      createMemory("Prefers TypeScript", "preference");
      const memories = listMemories({ search: "Montreal" });
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toContain("Montreal");
    });

    it("filters by both category and search", () => {
      createMemory("User lives in Montreal", "location");
      createMemory("Prefers Montreal", "preference");
      const memories = listMemories({ category: "preference", search: "Montreal" });
      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe("preference");
    });
  });

  describe("getMemory", () => {
    it("returns null for non-existent memory", () => {
      expect(getMemory("nonexistent")).toBeNull();
    });

    it("returns a memory by id", () => {
      const created = createMemory("Test fact", "personal");
      const fetched = getMemory(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.content).toBe("Test fact");
      expect(fetched!.category).toBe("personal");
    });
  });

  describe("createMemory", () => {
    it("creates a memory with content and category", () => {
      const memory = createMemory("User is a developer", "work");
      expect(memory.id).toBeDefined();
      expect(memory.content).toBe("User is a developer");
      expect(memory.category).toBe("work");
      expect(memory.createdAt).toBeDefined();
      expect(memory.updatedAt).toBeDefined();
    });

    it("trims content on creation", () => {
      const memory = createMemory("  spaced content  ", "other");
      expect(memory.content).toBe("spaced content");
    });
  });

  describe("updateMemory", () => {
    it("updates memory content", () => {
      const created = createMemory("Original fact", "personal");
      const updated = updateMemory(created.id, { content: "Updated fact" });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("Updated fact");
      expect(updated!.category).toBe("personal");
    });

    it("updates memory category", () => {
      const created = createMemory("Some fact", "personal");
      const updated = updateMemory(created.id, { category: "work" });
      expect(updated).not.toBeNull();
      expect(updated!.category).toBe("work");
      expect(updated!.content).toBe("Some fact");
    });

    it("updates both content and category", () => {
      const created = createMemory("Old content", "personal");
      const updated = updateMemory(created.id, { content: "New content", category: "location" });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("New content");
      expect(updated!.category).toBe("location");
    });

    it("returns null for non-existent memory", () => {
      const result = updateMemory("nonexistent", { content: "Nope" });
      expect(result).toBeNull();
    });

    it("trims content on update", () => {
      const created = createMemory("Original", "other");
      const updated = updateMemory(created.id, { content: "  trimmed  " });
      expect(updated!.content).toBe("trimmed");
    });
  });

  describe("deleteMemory", () => {
    it("deletes a memory", () => {
      const created = createMemory("To delete", "other");
      deleteMemory(created.id);
      expect(getMemory(created.id)).toBeNull();
    });
  });

  describe("getMemoryCount", () => {
    it("returns 0 when no memories exist", () => {
      expect(getMemoryCount()).toBe(0);
    });

    it("returns the correct count after creating memories", () => {
      createMemory("Fact 1", "personal");
      createMemory("Fact 2", "work");
      expect(getMemoryCount()).toBeGreaterThanOrEqual(2);
    });
  });

  it("lists only memories owned by the requested user", async () => {
    const userA = await createLocalUser({
      username: "memory-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "memory-b",
      password: "Password123!",
      role: "user"
    });

    createMemory("Admin memory", "work", userA.id);
    createMemory("Member memory", "personal", userB.id);

    expect(listMemories(userA.id).map((memory) => memory.content)).toEqual(["Admin memory"]);
    expect(listMemories(userB.id).map((memory) => memory.content)).toEqual(["Member memory"]);
  });
});
