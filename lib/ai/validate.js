// A small JSON Schema checker for the subset the Claude structured-output schemas use:
// object/array/string/number/integer/boolean/null, enum, required, additionalProperties:false, anyOf.
// The API already enforces the schema; this is the second, local line of defence before any
// AI output reaches the planner or the renderer.

export function validateSchema(schema, value, path = '$') {
  const errors = [];
  check(schema, value, path, errors);
  return errors;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(expected, v) {
  const actual = typeOf(v);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return expected === actual;
}

function check(schema, v, path, errors) {
  if (!schema) return;
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => validateSchema(s, v, path).length === 0);
    if (!ok) errors.push(`${path}: does not match any allowed shape`);
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, v))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(v)}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(v)) {
    errors.push(`${path}: "${v}" is not one of ${schema.enum.join(', ')}`);
    return;
  }
  if (typeOf(v) === 'object') {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (!(key in v)) errors.push(`${path}.${key}: missing`);
    }
    for (const [key, val] of Object.entries(v)) {
      if (props[key]) check(props[key], val, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected field`);
    }
  }
  if (typeOf(v) === 'array' && schema.items) {
    v.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
  }
}
