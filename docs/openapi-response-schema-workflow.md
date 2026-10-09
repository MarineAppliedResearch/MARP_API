# OpenAPI Response Schema Workflow for Custom Report Routes

When a GET route returns a custom joined/report shape, document that response from real JSON samples instead of trying to force shared model schemas.

## Why this approach

- Custom report endpoints often return unique shapes.
- OpenAPI cannot infer response schemas reliably from Sequelize joins and custom transforms.
- Response-sample inference keeps route logic unchanged while improving docs quality.

## Generate a schema from one or more samples

```bash
npm run docs:schema:infer -- --name VideoSummaryReport --out docs/tmp/video-summary.schema.json samples/video-summary-1.json samples/video-summary-2.json
```

What this does:

- Reads each sample JSON file.
- Infers field types recursively.
- Marks object properties as required only when present in every sample.
- Marks fields as nullable when null appears in samples.
- Writes an OpenAPI-compatible schema object under components.schemas.SchemaName.

## Apply the inferred schema

1. Copy the generated schema into components.schemas in docs/openapi.js.
2. Reference it in the route's @openapi response block in app.js.
3. Rebuild docs:

```bash
npm run docs:api:build
```

## Recommended guardrails

- Use 2 to 5 representative samples per route.
- Include edge cases (nulls, missing optional fields, empty arrays).
- Keep required fields conservative at first.
- Refine descriptions/examples manually after inference.

## Important limitation

Inference is a draft generator. It does not know domain semantics, enum constraints, units, or business rules. Always review the generated schema before publishing.
