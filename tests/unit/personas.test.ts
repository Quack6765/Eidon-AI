import { describe, it, expect } from "vitest";
import { listPersonas, createPersona, getPersona, deletePersona, updatePersona } from "@/lib/personas";

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
});