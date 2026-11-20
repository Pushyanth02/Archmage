> **R-08 note:** `build:pages` runs the SAME `next build` — the static-export
> behavior is selected entirely by environment variables, set by the workflow
> or the developer shell:
>
> ```bash
> BUILD_MODE=pages BASE_PATH=/YourRepoName NEXT_PUBLIC_BASE_PATH=/YourRepoName bun run build:pages
> ```
>
> The normal `bun run build` (standalone, Vercel-ready) is completely
> unaffected. Full instructions: docs/OPERATIONS.md.
