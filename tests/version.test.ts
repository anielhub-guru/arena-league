import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("version", () => {
  it("is the same in package.json, tauri.conf.json, Cargo.toml and Cargo.lock", () => {
    const pkg = JSON.parse(read("package.json")).version as string;
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe(pkg);
    expect(read("src-tauri/Cargo.toml")).toMatch(new RegExp(`^version = "${pkg.replace(/\./g, "\\.")}"`, "m"));
    expect(read("src-tauri/Cargo.lock")).toContain(`name = "dominion-league-manager"\nversion = "${pkg}"`);
  });
  it("is injected into the app", () => {
    expect(__APP_VERSION__).toBe(JSON.parse(read("package.json")).version);
  });
});
