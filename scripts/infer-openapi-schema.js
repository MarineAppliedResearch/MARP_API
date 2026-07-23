#!/usr/bin/env node
/*
 * Infer an OpenAPI-compatible JSON schema from one or more JSON response samples.
 *
 * Usage:
 *   node scripts/infer-openapi-schema.js --name VideoSummaryRow samples/video-summary.json
 *   node scripts/infer-openapi-schema.js --name DashboardData --out docs/tmp/dashboard-schema.json samples/a.json samples/b.json
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    files: [],
    out: null,
    name: null,
    pretty: 2,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--out') {
      args.out = argv[i + 1] || null;
      i += 1;
      continue;
    }

    if (token === '--name') {
      args.name = argv[i + 1] || null;
      i += 1;
      continue;
    }

    if (token === '--pretty') {
      const value = Number(argv[i + 1]);
      args.pretty = Number.isFinite(value) ? value : 2;
      i += 1;
      continue;
    }

    if (token === '--help' || token === '-h') {
      return { help: true };
    }

    args.files.push(token);
  }

  return args;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function primitiveType(value) {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (isPlainObject(value)) {
    return 'object';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }

  return typeof value;
}

function makeAccumulator() {
  return {
    total: 0,
    types: new Set(),
    objectStats: {
      seen: 0,
      props: new Map(),
    },
    arrayStats: {
      seen: 0,
      item: null,
    },
  };
}

function getOrCreateProperty(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      seen: 0,
      acc: makeAccumulator(),
    });
  }

  return map.get(key);
}

function visit(acc, value) {
  acc.total += 1;

  const t = primitiveType(value);
  acc.types.add(t);

  if (t === 'object') {
    acc.objectStats.seen += 1;
    const keys = Object.keys(value);
    for (const key of keys) {
      const prop = getOrCreateProperty(acc.objectStats.props, key);
      prop.seen += 1;
      visit(prop.acc, value[key]);
    }
    return;
  }

  if (t === 'array') {
    acc.arrayStats.seen += 1;
    if (!acc.arrayStats.item) {
      acc.arrayStats.item = makeAccumulator();
    }
    for (const item of value) {
      visit(acc.arrayStats.item, item);
    }
  }
}

function uniqueByJson(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const sig = JSON.stringify(item);
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(item);
    }
  }

  return out;
}

function finalizePrimitive(typeName) {
  if (typeName === 'integer') {
    return { type: 'integer', format: 'int64' };
  }

  if (typeName === 'number') {
    return { type: 'number' };
  }

  if (typeName === 'string') {
    return { type: 'string' };
  }

  if (typeName === 'boolean') {
    return { type: 'boolean' };
  }

  if (typeName === 'null') {
    return { nullable: true };
  }

  return { type: typeName };
}

function finalize(acc) {
  const nonNullTypes = Array.from(acc.types).filter((typeName) => typeName !== 'null');
  const hasNull = acc.types.has('null');

  if (nonNullTypes.length === 0 && hasNull) {
    return { nullable: true };
  }

  if (nonNullTypes.length === 1) {
    const typeName = nonNullTypes[0];

    let baseSchema;

    if (typeName === 'object') {
      const objectSeen = acc.objectStats.seen;
      const properties = {};
      const required = [];

      for (const [propName, propInfo] of acc.objectStats.props.entries()) {
        properties[propName] = finalize(propInfo.acc);

        if (propInfo.seen === objectSeen) {
          required.push(propName);
        }
      }

      baseSchema = {
        type: 'object',
        properties,
      };

      if (required.length > 0) {
        baseSchema.required = required.sort();
      }
    } else if (typeName === 'array') {
      const itemsSchema = acc.arrayStats.item ? finalize(acc.arrayStats.item) : {};
      baseSchema = {
        type: 'array',
        items: itemsSchema,
      };
    } else {
      baseSchema = finalizePrimitive(typeName);
    }

    if (hasNull) {
      baseSchema.nullable = true;
    }

    return baseSchema;
  }

  const variants = nonNullTypes.map((typeName) => {
    if (typeName === 'object') {
      const sub = makeAccumulator();
      sub.total = acc.total;
      sub.types.add('object');
      sub.objectStats = acc.objectStats;
      return finalize(sub);
    }

    if (typeName === 'array') {
      const sub = makeAccumulator();
      sub.total = acc.total;
      sub.types.add('array');
      sub.arrayStats = acc.arrayStats;
      return finalize(sub);
    }

    return finalizePrimitive(typeName);
  });

  const oneOf = uniqueByJson(variants);

  if (hasNull) {
    oneOf.push({ nullable: true });
  }

  return { oneOf };
}

function readJsonFile(filePath) {
  const absPath = path.resolve(filePath);
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

function usage() {
  return [
    'Infer an OpenAPI-compatible schema from response samples.',
    '',
    'Usage:',
    '  node scripts/infer-openapi-schema.js [--name SchemaName] [--out output.json] [--pretty 2] <sample1.json> [sample2.json ...]',
    '',
    'Examples:',
    '  node scripts/infer-openapi-schema.js samples/video-summary.json',
    '  node scripts/infer-openapi-schema.js --name VideoSummaryRow --out docs/video-summary.schema.json samples/video-summary-a.json samples/video-summary-b.json',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  if (!args.files || args.files.length === 0) {
    console.error('No sample files provided.');
    console.error('');
    console.error(usage());
    process.exit(1);
  }

  const samples = args.files.map(readJsonFile);

  const acc = makeAccumulator();
  for (const sample of samples) {
    visit(acc, sample);
  }

  const schema = finalize(acc);
  const output = args.name
    ? { components: { schemas: { [args.name]: schema } } }
    : schema;

  const text = `${JSON.stringify(output, null, args.pretty)}\n`;

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text, 'utf8');
    console.log(`Wrote schema to ${outPath}`);
    return;
  }

  process.stdout.write(text);
}

main();
