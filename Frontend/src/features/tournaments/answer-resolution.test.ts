import { describe, expect, it } from "vitest";
import { resolveQuestionAttempt } from "./answer-resolution.ts";

describe("resolveQuestionAttempt", () => {
  it("keeps the click result when timeout resolves the same question later", () => {
    const clickFirst = resolveQuestionAttempt(null, {
      globalIdx: 9,
      value: 2,
    });

    const timeoutLater = resolveQuestionAttempt(clickFirst, {
      globalIdx: 9,
      value: -1,
    });

    expect(timeoutLater).toEqual({
      globalIdx: 9,
      value: 2,
    });
  });

  it("keeps the timeout result when a later click tries to rewrite the same question", () => {
    const timeoutFirst = resolveQuestionAttempt(null, {
      globalIdx: 9,
      value: -1,
    });

    const clickLater = resolveQuestionAttempt(timeoutFirst, {
      globalIdx: 9,
      value: 2,
    });

    expect(clickLater).toEqual({
      globalIdx: 9,
      value: -1,
    });
  });

  it("allows a new question index to resolve independently", () => {
    const previousQuestion = resolveQuestionAttempt(null, {
      globalIdx: 9,
      value: 1,
    });

    const nextQuestion = resolveQuestionAttempt(previousQuestion, {
      globalIdx: 10,
      value: -1,
    });

    expect(nextQuestion).toEqual({
      globalIdx: 10,
      value: -1,
    });
  });
});
