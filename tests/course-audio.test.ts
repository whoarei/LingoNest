import {
  readdirSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join, sep, basename } from "node:path";
import { describe, expect, it } from "vitest";
import { courseAudioSpec } from "../src/course-speech";
import { course, exercises } from "../src/course";

describe("user-generated permanent course audio", () => {
  it("covers every dialogue turn, block reading and exercise stimulus exactly once", () => {
    const texts = courseAudioSpec.assets.map((a) => a.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(new Set(courseAudioSpec.assets.map((a) => a.id)).size).toBe(
      texts.length,
    );
    for (const text of [
      ...course.turns.map((t) => t.text),
      ...exercises.flatMap((e) => (e.speakText ? [e.speakText] : [])),
    ])
      expect(texts).toContain(text);
    for (const block of ["A", "B", "C"])
      expect(texts).toContain(
        course.turns
          .filter((t) => t.block === block)
          .map((t) => t.text)
          .join(" "),
      );
  });
  it("contains only text stimuli and no pre-generated course files", () => {
    for (const asset of courseAudioSpec.assets)
      expect(Object.keys(asset).sort()).toEqual(["id", "text"]);
    const files = readdirSync("public", { recursive: true }).map(String);
    expect(
      files.filter((name) => /\.(wav|mp3|m4a|ogg|aac|flac|opus)$/i.test(name)),
    ).toEqual([]);
    expect(files.filter((name) => /course-audio[\\/].+/.test(name))).toEqual(
      [],
    );
  });
  it("the build gate rejects accidentally added audio", () => {
    const root = resolve("artifacts");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, "no-bundled-audio-test-"));
    try {
      writeFileSync(join(dir, "unexpected.wav"), "fixture");
      expect(() =>
        execFileSync(
          process.execPath,
          ["scripts/assert-no-bundled-audio.mjs", dir],
          { stdio: "pipe" },
        ),
      ).toThrow();
    } finally {
      const target = resolve(dir);
      if (
        target.startsWith(root + sep) &&
        basename(target).startsWith("no-bundled-audio-test-")
      )
        rmSync(target, { recursive: true, force: true });
    }
  });
});
