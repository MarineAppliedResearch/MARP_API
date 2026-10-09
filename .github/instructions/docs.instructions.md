---
applyTo: "docs/**"
---

# Generated documentation

`docs/openapi.generated.json` and `docs/developer/` are **generated and committed**. A
route change without rebuilding them makes the diff a lie, and CI fails on it.

```bash
npm run docs:build
```

Route documentation is code-first through `docs/openapi-route-registry.js`; shared schemas,
security schemes and error responses live in `docs/openapi.js`. Edit those, not the output.

Removing a path or making an optional field required is a **breaking change** for
`VIDEO_PROCESSING_GUI`, which is a different repository and is not tested from here. Note
it in `.marp/task.md` so it reaches the pull request.
