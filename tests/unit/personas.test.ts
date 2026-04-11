import { describe, it, expect } from "vitest";
import { listPersonas, createPersona, getPersona, deletePersona, updatePersona } from "@/lib/personas";
import { createLocalUser } from "@/lib/users";

describe("personas", () => {
  describe("listPersonas", () => {
    it("returns empty array when no personas exist", () => {
      const personas = listPersonas();
      expect(personas).toEqual([]);
    });
  });

  describe("createPersona", () => {
    it("creates a persona with name and content", () => {
      const persona = createPersona({
        name: "Finance Expert",
        content: "You are a financial advisor specializing in tax optimization."
      });
      expect(persona.id).toBeDefined();
      expect(persona.name).toBe("Finance Expert");
      expect(persona.content).toBe("You are a financial advisor specializing in tax optimization.");
      expect(persona.createdAt).toBeDefined();
      expect(persona.updatedAt).toBeDefined();
    });
  });

  describe("updatePersona", () => {
    it("updates persona name and content", () => {
      const created = createPersona({ name: "Test", content: "Initial" });
      const updated = updatePersona(created.id, { name: "Updated", content: "New content" });
      expect(updated?.name).toBe("Updated");
      expect(updated?.content).toBe("New content");
    });

    it("returns null for non-existent persona", () => {
      expect(updatePersona("nonexistent", { name: "Nope" })).toBeNull();
    });

    it("updates only name when content is not provided", () => {
      const created = createPersona({ name: "Test", content: "Original" });
      const updated = updatePersona(created.id, { name: "Renamed" });
      expect(updated?.name).toBe("Renamed");
      expect(updated?.content).toBe("Original");
    });

    it("updates only content when name is not provided", () => {
      const created = createPersona({ name: "Test", content: "Original" });
      const updated = updatePersona(created.id, { content: "New content" });
      expect(updated?.name).toBe("Test");
      expect(updated?.content).toBe("New content");
    });
  });

  describe("deletePersona", () => {
    it("deletes a persona", () => {
      const created = createPersona({ name: "To Delete", content: "Delete me" });
      deletePersona(created.id);
      expect(getPersona(created.id)).toBeNull();
    });
  });

  it("lists only personas owned by the requested user", async () => {
    const userA = await createLocalUser({
      username: "persona-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "persona-b",
      password: "Password123!",
      role: "user"
    });

    createPersona({ name: "Admin Persona", content: "A" }, userA.id);
    createPersona({ name: "Member Persona", content: "B" }, userB.id);

    expect(listPersonas(userA.id).map((persona) => persona.name)).toEqual(["Admin Persona"]);
    expect(listPersonas(userB.id).map((persona) => persona.name)).toEqual(["Member Persona"]);
  });
});
