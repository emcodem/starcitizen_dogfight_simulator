import { defineConfig } from 'vite';

// GitHub Actions sets GITHUB_REPOSITORY to "owner/repo" — deriving the Pages base path from
// it means this config works under whatever repo name is chosen, with no manual edit needed
// once the repo exists. Local dev/build (no GITHUB_ACTIONS env) just serves from the root.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/';

export default defineConfig({
  base,
  server: {
    // bind to 0.0.0.0 so `npm run dev` is reachable from other devices on the LAN
    // (e.g. a phone at http://<this-pc-ip>:5173/) for real touchscreen/multitouch testing
    host: true,
    // pin the port: strictPort makes Vite fail loudly if 5173 is taken instead of silently
    // hopping to 5174 — so the URL is always the same (matters for the gamepad secure-origin
    // check, saved bookmarks, and the verify skill's automation which assumes 5173)
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
});
