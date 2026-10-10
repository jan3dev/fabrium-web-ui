// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/lib/searchMatch.test.mjs. Modified.
import { expect, test } from "vitest";

import { buildSearchResultPreview, splitSearchMatches } from "./search-match";

test("splitSearchMatches highlights every case-insensitive lexeme match", () => {
  expect(splitSearchMatches("Mentions and mentions", "mentions")).toEqual([
    { isMatch: true, key: "0-8", text: "Mentions" },
    { isMatch: false, key: "8-5", text: " and " },
    { isMatch: true, key: "13-8", text: "mentions" },
  ]);
});

test("splitSearchMatches normalizes punctuation into search lexemes", () => {
  expect(splitSearchMatches("foo bar release", "foo-bar")).toEqual([
    { isMatch: true, key: "0-3", text: "foo" },
    { isMatch: false, key: "3-1", text: " " },
    { isMatch: true, key: "4-3", text: "bar" },
    { isMatch: false, key: "7-8", text: " release" },
  ]);
});

test("splitSearchMatches keeps completed tokens on lexeme boundaries", () => {
  expect(splitSearchMatches("projectile notes about project planning", "project pl")).toEqual([
    { isMatch: false, key: "0-23", text: "projectile notes about " },
    { isMatch: true, key: "23-7", text: "project" },
    { isMatch: false, key: "30-1", text: " " },
    { isMatch: true, key: "31-2", text: "pl" },
    { isMatch: false, key: "33-6", text: "anning" },
  ]);
});

test("splitSearchMatches preserves exact and prefix modes for a repeated term", () => {
  expect(splitSearchMatches("foo foobar", "foo foo")).toEqual([
    { isMatch: true, key: "0-3", text: "foo" },
    { isMatch: false, key: "3-1", text: " " },
    { isMatch: true, key: "4-3", text: "foo" },
    { isMatch: false, key: "7-3", text: "bar" },
  ]);
});

test("splitSearchMatches highlights non-adjacent prefix-search terms", () => {
  expect(splitSearchMatches("agent status mentions", "agent ment")).toEqual([
    { isMatch: true, key: "0-5", text: "agent" },
    { isMatch: false, key: "5-8", text: " status " },
    { isMatch: true, key: "13-4", text: "ment" },
    { isMatch: false, key: "17-4", text: "ions" },
  ]);
});

test("splitSearchMatches keeps one-character prefixes on lexeme boundaries", () => {
  expect(splitSearchMatches("A plan", "a")).toEqual([
    { isMatch: true, key: "0-1", text: "A" },
    { isMatch: false, key: "1-5", text: " plan" },
  ]);
});

test("splitSearchMatches maps expanding lowercase prefixes to original spans", () => {
  expect(splitSearchMatches("İstanbul release", "İs")).toEqual([
    { isMatch: true, key: "0-2", text: "İs" },
    { isMatch: false, key: "2-14", text: "tanbul release" },
  ]);
  expect(splitSearchMatches("İstanbul release", "İst")).toEqual([
    { isMatch: true, key: "0-3", text: "İst" },
    { isMatch: false, key: "3-13", text: "anbul release" },
  ]);
});

test("splitSearchMatches does not split a character whose lowercase form expands", () => {
  expect(splitSearchMatches("İstanbul release", "i")).toEqual([
    { isMatch: true, key: "0-1", text: "İ" },
    { isMatch: false, key: "1-15", text: "stanbul release" },
  ]);
});

test("splitSearchMatches preserves UTF-16 boundaries for supplementary letters", () => {
  expect(splitSearchMatches("𐐀İstanbul release", "𐐨İs")).toEqual([
    { isMatch: true, key: "0-4", text: "𐐀İs" },
    { isMatch: false, key: "4-14", text: "tanbul release" },
  ]);
});

test("buildSearchResultPreview keeps a late match visible", () => {
  const content = `${"prefix ".repeat(30)}mentions appear here ${"suffix ".repeat(20)}`;
  const preview = buildSearchResultPreview(content, "mentions", 96);

  expect(preview.length).toBeLessThanOrEqual(96);
  expect(preview).toMatch(/mentions/i);
  expect(preview).toMatch(/^\.\.\./);
  expect(preview).toMatch(/\.\.\.$/);
});

test("buildSearchResultPreview ignores an invalid completed-token substring", () => {
  const content = `${"projectile filler ".repeat(20)}project planning release notes`;
  const preview = buildSearchResultPreview(content, "project pl", 80);

  expect(preview).toMatch(/project planning/);
  expect(preview).toMatch(/^\.\.\./);
});

test("buildSearchResultPreview keeps the existing leading excerpt without a match", () => {
  expect(buildSearchResultPreview("abcdefghijklmnopqrstuvwxyz", "missing", 10)).toBe("abcdefg...");
});
