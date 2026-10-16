# Local scaffold

Status: TanStack Start + React + TypeScript scaffold only. The route loader calls a local server function. No database, model, saving, editor or reminder is connected. The displayed section outline is not an editable daily note.

Use Node >=22.12 (built here with Node 24.14.1) and npm. Dependencies are pinned in package-lock.json.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The development server binds to loopback only. This is not an iPhone or HTTPS deployment.

```sh
npm run build
npm run typecheck
npm run preview
```

A fresh checkout should build first to generate src/routeTree.gen.ts before typechecking if that generated file is absent. No environment file is needed to run this scaffold. `.env.example` contains future integration placeholders only; copying it does not connect anything.

Original README/specs/refs are retained. Current product decisions are in docs/specs-v0.3 and the review threads; the scaffold is not evidence that those features are implemented. External account/project/key creation and deployment wait for the separate setup proposal approval.
