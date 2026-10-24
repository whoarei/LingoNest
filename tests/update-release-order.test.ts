import { describe, expect, it, vi } from "vitest";
// @ts-expect-error This module is a plain JavaScript CI entry point.
import { assertReleaseAdvance, checkUpdateRelease } from "../scripts/check-update-release.mjs";

const candidate = { versionName: "0.1.17", versionCode: 18 };
const previous = { versionName: "0.1.16", versionCode: 17 };
const options = (request: typeof fetch) => ({ repository: "whoarei/LingoNest", token: "synthetic-token", request });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const release = { tag_name: "v0.1.16", draft: false, prerelease: false };
const source = (text: string) => ({ encoding: "base64", content: Buffer.from(text).toString("base64") });

describe("latest release ordering", () => {
  it("compares version components numerically and also requires increasing Android codes", () => {
    expect(() => assertReleaseAdvance(candidate, previous)).not.toThrow();
    expect(() => assertReleaseAdvance({ versionName: "0.1.10", versionCode: 12 }, { versionName: "0.1.9", versionCode: 11 })).not.toThrow();
    for (const next of [{ versionName: "0.1.15", versionCode: 19 }, { versionName: "0.1.16", versionCode: 19 },
      { versionName: "0.1.17", versionCode: 17 }, { versionName: "0.1.17", versionCode: 16 }])
      expect(() => assertReleaseAdvance(next, previous)).toThrow("both versionName and versionCode");
    expect(() => assertReleaseAdvance({ versionName: "0.1.17-beta", versionCode: 18 }, previous)).toThrow("stable");
    expect(() => assertReleaseAdvance({ versionName: "0.1.17", versionCode: 18.5 }, previous)).toThrow("versionCode");
  });
  it("supports the first release without mistaking API failures for an empty repository", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 404));
    await expect(checkUpdateRelease(candidate, options(request))).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    for (const status of [401, 403, 429, 500]) {
      request.mockResolvedValueOnce(json({}, status));
      await expect(checkUpdateRelease(candidate, options(request))).rejects.toThrow(`HTTP ${status}`);
    }
  });
  it("reads the previous tag's Android code even before update.json existed", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(release))
      .mockResolvedValueOnce(json(source('versionCode 17\nversionName "0.1.16"')));
    await checkUpdateRelease(candidate, options(request));
    expect(request.mock.calls[1]![0]).toBe("https://api.github.com/repos/whoarei/LingoNest/contents/android/app/build.gradle?ref=v0.1.16");
    expect(request.mock.calls[0]![1]).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer synthetic-token" } });
  });
  it("rejects an older build finishing after a newer release", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...release, tag_name: "v0.1.18" }))
      .mockResolvedValueOnce(json(source('versionCode 19\nversionName "0.1.18"')));
    await expect(checkUpdateRelease(candidate, options(request))).rejects.toThrow("move latest backwards");
  });
  it("refuses inconsistent or unavailable published source instead of guessing an upgrade order", async () => {
    const request = vi.fn<typeof fetch>();
    for (const content of [source('versionCode 17\nversionName "0.1.15"'), source('versionCode 0\nversionName "0.1.16"'),
      { encoding: "none", content: "" }]) {
      request.mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json(content));
      await expect(checkUpdateRelease(candidate, options(request))).rejects.toThrow();
    }
    request.mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json({}, 404));
    await expect(checkUpdateRelease(candidate, options(request))).rejects.toThrow("published Android version");
  });
  it("rejects malformed latest metadata, repositories and network failures", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(checkUpdateRelease(candidate, { ...options(request), repository: "invalid" })).rejects.toThrow("repository");
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(json({ ...release, prerelease: true }));
    await expect(checkUpdateRelease(candidate, options(request))).rejects.toThrow("metadata");
    request.mockRejectedValueOnce(new Error("request timed out"));
    await expect(checkUpdateRelease(candidate, options(request))).rejects.toThrow("timed out");
  });
});
