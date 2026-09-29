import { buildCreateMemoryDescription, buildMemorySystemGuidance } from "@/lib/memory-guidance";
import type { MemoryRigor } from "@/lib/types";

const RIGORS: MemoryRigor[] = ["low", "balanced", "high"];

describe("buildMemorySystemGuidance", () => {
  it.each(RIGORS)("applies the global gate at %s rigor", (rigor) => {
    const guidance = buildMemorySystemGuidance(rigor);

    expect(guidance).toContain("Memory is global, not tied to this conversation");
    expect(guidance).toContain(
      "Propose a memory only when it would change your answer in a future conversation unrelated to this one"
    );
    expect(guidance).toContain("About the user, not the topic");
    expect(guidance).toContain("Never propose a memory for");
  });

  it.each(RIGORS)("names the worth-remembering class at %s rigor", (rigor) => {
    const guidance = buildMemorySystemGuidance(rigor);

    expect(guidance).toContain("birthday");
    expect(guidance).toContain("dislikes");
    expect(guidance).toContain("allergies");
  });

  it.each(RIGORS)("describes the tool call as the offer at %s rigor", (rigor) => {
    expect(buildMemorySystemGuidance(rigor)).toContain("Calling these tools is how you offer");
  });

  it("changes how broadly the model hunts, never whether the gate applies", () => {
    const [low, balanced, high] = RIGORS.map((rigor) => buildMemorySystemGuidance(rigor));

    expect(low).not.toBe(balanced);
    expect(balanced).not.toBe(high);
    expect(low).not.toBe(high);

    for (const guidance of [low, balanced, high]) {
      expect(guidance).toContain("future conversation unrelated to this one");
    }
  });

  it("falls back to the balanced guidance for unknown rigor", () => {
    expect(buildMemorySystemGuidance("nonsense" as MemoryRigor)).toBe(buildMemorySystemGuidance("balanced"));
  });
});

describe("buildCreateMemoryDescription", () => {
  it.each(RIGORS)("frames the call itself as the offer at %s rigor", (rigor) => {
    const description = buildCreateMemoryDescription(rigor);

    expect(description).toContain("the call itself is the offer");
    expect(description).toContain("this conversation");
  });

  it("keeps the worth-remembering class at the strictest rigor", () => {
    expect(buildCreateMemoryDescription("low")).toContain("birthday");
  });

  it.each(RIGORS)("keeps the memorable cases in the balanced and high descriptions", (rigor) => {
    if (rigor === "low") return;
    expect(buildCreateMemoryDescription(rigor)).toContain("dislikes");
  });

  it("falls back to the balanced description for unknown rigor", () => {
    expect(buildCreateMemoryDescription("nonsense" as MemoryRigor)).toBe(buildCreateMemoryDescription("balanced"));
  });
});

describe("instructions-vs-memory split", () => {
  it.each(RIGORS)("states the split and the duplication gate at %s rigor", (rigor) => {
    const guidance = buildMemorySystemGuidance(rigor);

    expect(guidance).toContain("Your instructions say how you work; memory says who you are working for");
    expect(guidance).toContain("memory adds to your instructions, never copies them");
    expect(guidance).toContain("never rewrite a memory to mirror your instructions");
    expect(guidance).toContain("is an instruction change, not a memory");
    expect(guidance).toContain("Memory never holds behavior rules");
    expect(guidance).toContain("belongs there instead of remembering it");
  });

  it("places the split after the relevance gate and before the worth-remembering list", () => {
    const guidance = buildMemorySystemGuidance("balanced");
    const gate = guidance.indexOf("Propose a memory only when it would change your answer");
    const split = guidance.indexOf("Your instructions say how you work");
    const worth = guidance.indexOf("worth remembering precisely");

    expect(gate).toBeGreaterThanOrEqual(0);
    expect(split).toBeGreaterThan(gate);
    expect(worth).toBeGreaterThan(split);
  });

  it.each(RIGORS)("keeps the instructions line in the create_memory description at %s rigor", (rigor) => {
    expect(buildCreateMemoryDescription(rigor)).toContain("Never propose what your instructions already state");
  });
});
