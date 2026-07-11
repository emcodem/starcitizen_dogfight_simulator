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
    host: true
  },
  build: {
    outDir: 'dist'
  }
});
