/**
 * File: scripts/generate-openapi.js
 * Purpose: Produce a committed OpenAPI JSON artifact from in-code annotations.
 * Context: Supports local verification and CI docs checks without running the API server.
 */
const fs = require('fs');
const path = require('path');
const { buildOpenApiSpec } = require('../docs/openapi');

// Build spec in-memory first so file writes happen only after successful generation.
const spec = buildOpenApiSpec();
const discoveredPaths = Object.keys(spec.paths || {});

if (discoveredPaths.length === 0) {
  console.error('OpenAPI generation failed: no annotated API paths were discovered.');
  process.exit(1);
}

const outputDir = path.join(__dirname, '..', 'docs');
const outputPath = path.join(outputDir, 'openapi.generated.json');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`Generated OpenAPI spec at ${outputPath}`);
console.log(`Discovered ${discoveredPaths.length} documented paths:`);

for (const discoveredPath of discoveredPaths) {
  console.log(`  ${discoveredPath}`);
}
