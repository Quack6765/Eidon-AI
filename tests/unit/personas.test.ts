import { describe, it, expect } from "vitest";
import { listPersonas, createPersona, getPersona, deletePersona, updatePersona } from "@/lib/personas";
import { createLocalUser } from "@/lib/users";
import { getDb } from "@/lib/db";

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

    it("keeps dependent automations and removes their persona reference", async () => {
      const user = await createLocalUser({
        username: "persona-delete-owner",
        password: "Password123!",
        role: "user"
      });
      const persona = createPersona({ name: "Temporary", content: "Instructions" }, user.id);
      const defaultProvider = getDb()
        .prepare("SELECT id FROM provider_profiles ORDER BY created_at LIMIT 1")
        .get() as { id: string };
      const timestamp = new Date().toISOString();
      getDb().prepare(
        `INSERT INTO automations (
          id, name, prompt, provider_profile_id, persona_id, user_id,
          schedule_kind, interval_minutes, calendar_frequency, time_of_day,
          days_of_week, enabled, next_run_at, last_scheduled_for, last_started_at,
          last_finished_at, last_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'interval', 60, NULL, NULL, '[]', 1, NULL, NULL, NULL, NULL, NULL, ?, ?)`
      ).run(
        "auto_persona_delete",
        "Persona automation",
        "Run",
        defaultProvider.id,
        persona.id,
        user.id,
        timestamp,
        timestamp
      );

      deletePersona(persona.id, user.id);

      expect(getDb().prepare("SELECT persona_id FROM automations WHERE id = ?").get("auto_persona_delete"))
        .toEqual({ persona_id: null });
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
