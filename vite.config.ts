import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// package.json is the single source for the version shown in the app.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
