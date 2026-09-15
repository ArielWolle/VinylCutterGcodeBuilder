import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
// Served from https://<user>.github.io/VinylCutterGcodeBuilder/ in CI (GitHub Actions sets
// GITHUB_ACTIONS=true); locally we keep the base at "/" so `npm run dev`/`preview` work as expected.
const base = process.env.GITHUB_ACTIONS ? "/VinylCutterGcodeBuilder/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
  },
});
