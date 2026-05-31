/**
 * Unit tests for clarifyAndRefineUserInput.
 *
 * These tests cover the parser-failure regression that caused the multi-turn
 * comparison bug: the previous regexes required a single `\n` between sections
 * (e.g. `\nLanguage:`), but the model emits blank lines between sections, so
 * every match returned null and the fallback used the raw `userInput` — which
 * on multi-turn requests contains the prepended `Previous context:` blob from
 * prior assistant turns. The polluted refinedQuery/entities then leaked into
 * the planner, RAG entity matching, and the final-answer synthesizer.
 *
 * The fix:
 *   1. Per-line, blank-line-tolerant regexes.
 *   2. Fallback uses `currentQuery` (extracted from the `Previous context:` /
 *      `Current query:` envelope), NOT the raw `userInput`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpenaiChatCompletion = vi.fn();
vi.mock("../utils/aiHandler", () => ({
  openaiChatCompletion: (...args: unknown[]) => mockOpenaiChatCompletion(...args),
}));

// Import after the mock is registered so the module picks up the mocked dep.
import { clarifyAndRefineUserInput } from "../utils/queryRefinement";

describe("clarifyAndRefineUserInput parser", () => {
  beforeEach(() => {
    mockOpenaiChatCompletion.mockReset();
  });

  it("parses blank-line-separated LLM output (the bug case from the trace)", async () => {
    mockOpenaiChatCompletion.mockResolvedValueOnce(
      `Refined Query: What is the base attack stat of Charizard?\n\n` +
        `Language: en\n\n` +
        `Concepts: ["pokemon stats", "base attack stat", "Charizard", "pokemon details"]\n\n` +
        `API Needs: ["GET pokemon details", "retrieve base stats", "fetch specific stat value"]\n\n` +
        `Entities: ["charizard", "charizard base stats", "pokemon attack stat"]\n\n` +
        `IntentType: FETCH`,
    );

    const result = await clarifyAndRefineUserInput("What's the attack of Charizard");

    expect(result.refinedQuery).toBe("What is the base attack stat of Charizard?");
    expect(result.language).toBe("en");
    expect(result.concepts).toEqual([
      "pokemon stats",
      "base attack stat",
      "Charizard",
      "pokemon details",
    ]);
    expect(result.apiNeeds).toEqual([
      "GET pokemon details",
      "retrieve base stats",
      "fetch specific stat value",
    ]);
    expect(result.entities).toEqual([
      "charizard",
      "charizard base stats",
      "pokemon attack stat",
    ]);
    expect(result.intentType).toBe("FETCH");
  });

  it("parses legacy single-newline-separated LLM output", async () => {
    mockOpenaiChatCompletion.mockResolvedValueOnce(
      `Refined Query: What is the attack stat of Pikachu?\n` +
        `Language: EN\n` +
        `Concepts: [pokemon stats, base attack stat]\n` +
        `API Needs: [GET pokemon details]\n` +
        `Entities: [pikachu, pokemon base stats]\n` +
        `IntentType: FETCH`,
    );

    const result = await clarifyAndRefineUserInput("What's the attack of Pikachu");

    expect(result.refinedQuery).toBe("What is the attack stat of Pikachu?");
    expect(result.language).toBe("EN");
    expect(result.concepts).toEqual(["pokemon stats", "base attack stat"]);
    expect(result.apiNeeds).toEqual(["GET pokemon details"]);
    expect(result.entities).toEqual(["pikachu", "pokemon base stats"]);
    expect(result.intentType).toBe("FETCH");
  });

  it("on total parse failure with a `Previous context:` blob, fallback uses currentQuery (not the blob)", async () => {
    // Simulate an LLM response the parser cannot extract anything from.
    mockOpenaiChatCompletion.mockResolvedValueOnce(
      "I'm not sure how to format this response.",
    );

    const userInput =
      `Previous context:\n` +
      `assistant: Based on the execution result, **Pikachu's attack stat is 55**.\n` +
      `\n` +
      `Current query: What's the attack of Charizard`;

    const result = await clarifyAndRefineUserInput(userInput);

    // The critical assertions: the prior-turn assistant blob MUST NOT leak.
    expect(result.refinedQuery).toBe("What's the attack of Charizard");
    expect(result.entities).toEqual(["What's the attack of Charizard"]);
    expect(result.refinedQuery).not.toContain("Pikachu");
    expect(result.entities.join(" ")).not.toContain("Pikachu");

    // Sensible defaults for the rest.
    expect(result.language).toBe("EN");
    expect(result.concepts).toEqual([]);
    expect(result.apiNeeds).toEqual([]);
    expect(result.intentType).toBe("FETCH");
  });

  it("handles MODIFY intent and lowercased intent strings with quotes", async () => {
    mockOpenaiChatCompletion.mockResolvedValueOnce(
      `Refined Query: Clear my watchlist\n\n` +
        `Language: en\n\n` +
        `Concepts: ["watchlist"]\n\n` +
        `API Needs: ["DELETE watchlist"]\n\n` +
        `Entities: ["user watchlist"]\n\n` +
        `IntentType: "modify"`,
    );

    const result = await clarifyAndRefineUserInput("clear my watchlist");
    expect(result.intentType).toBe("MODIFY");
  });

  it("on no input/no parseable output, fallback is the raw single-turn user input (no envelope)", async () => {
    mockOpenaiChatCompletion.mockResolvedValueOnce("unparseable");
    const result = await clarifyAndRefineUserInput("show me pikachu");
    // No `Previous context:` envelope → currentQuery === userInput, so fallback
    // legitimately uses the user's single-turn input.
    expect(result.refinedQuery).toBe("show me pikachu");
    expect(result.entities).toEqual(["show me pikachu"]);
  });
});
