import { readFile } from "node:fs/promises";

const schemaCache = new Map();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, expected) {
  if (Array.isArray(expected)) return expected.some((type) => matchesType(value, type));
  if (expected === "object") return isObject(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "null") return value === null;
  return typeof value === expected;
}

function resolvePointer(rootSchema, reference) {
  if (!reference.startsWith("#/")) {
    throw new Error(`仅支持当前 Schema 内部的 $ref，收到：${reference}`);
  }
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((current, part) => current?.[part], rootSchema);
}

function addError(errors, path, message, keyword, actual) {
  errors.push({ path, message: `${path} ${message}`, keyword, actual });
}

function validateNode(value, schema, rootSchema, path, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.$ref) {
    const target = resolvePointer(rootSchema, schema.$ref);
    if (!target) throw new Error(`无法解析 Schema 引用：${schema.$ref}`);
    validateNode(value, target, rootSchema, path, errors);
    return;
  }

  if (schema.anyOf) {
    const valid = schema.anyOf.some((candidate) => {
      const candidateErrors = [];
      validateNode(value, candidate, rootSchema, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (!valid) addError(errors, path, "不匹配 anyOf 中的任何允许结构", "anyOf", value);
    return;
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      const candidateErrors = [];
      validateNode(value, candidate, rootSchema, path, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (matches !== 1) addError(errors, path, `必须且只能匹配 oneOf 的一个结构，实际匹配 ${matches} 个`, "oneOf", value);
    return;
  }

  if (schema.type && !matchesType(value, schema.type)) {
    const expected = Array.isArray(schema.type) ? schema.type.join(" 或 ") : schema.type;
    addError(errors, path, `类型应为 ${expected}，实际为 ${valueType(value)}`, "type", value);
    return;
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    addError(errors, path, `必须等于 ${JSON.stringify(schema.const)}`, "const", value);
  }
  if (schema.enum && !schema.enum.some((allowed) => Object.is(allowed, value))) {
    addError(errors, path, `必须是 ${schema.enum.map((item) => JSON.stringify(item)).join(", ")} 之一`, "enum", value);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      addError(errors, path, `长度不能少于 ${schema.minLength}`, "minLength", value);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      addError(errors, path, `不符合格式 ${schema.pattern}`, "pattern", value);
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      addError(errors, path, `不能小于 ${schema.minimum}`, "minimum", value);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      addError(errors, path, `不能大于 ${schema.maximum}`, "maximum", value);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      addError(errors, path, `必须大于 ${schema.exclusiveMinimum}`, "exclusiveMinimum", value);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      addError(errors, path, `至少需要 ${schema.minItems} 项`, "minItems", value);
    }
    if (schema.items) {
      value.forEach((item, index) => validateNode(item, schema.items, rootSchema, `${path}[${index}]`, errors));
    }
  }

  if (isObject(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredKey)) {
        addError(errors, `${path}.${requiredKey}`, "是必填字段", "required", undefined);
      }
    }

    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        validateNode(value[key], childSchema, rootSchema, `${path}.${key}`, errors);
      }
    }

    const knownProperties = new Set(Object.keys(schema.properties ?? {}));
    for (const key of Object.keys(value)) {
      if (knownProperties.has(key)) continue;
      if (schema.additionalProperties === false) {
        addError(errors, `${path}.${key}`, "是不允许的字段", "additionalProperties", value[key]);
      } else if (isObject(schema.additionalProperties)) {
        validateNode(value[key], schema.additionalProperties, rootSchema, `${path}.${key}`, errors);
      }
    }
  }

  for (const childSchema of schema.allOf ?? []) {
    validateNode(value, childSchema, rootSchema, path, errors);
  }

  if (schema.if) {
    const conditionErrors = [];
    validateNode(value, schema.if, rootSchema, path, conditionErrors);
    if (conditionErrors.length === 0 && schema.then) {
      validateNode(value, schema.then, rootSchema, path, errors);
    } else if (conditionErrors.length > 0 && schema.else) {
      validateNode(value, schema.else, rootSchema, path, errors);
    }
  }
}

export async function loadSchema(schemaPath) {
  const cacheKey = schemaPath.toString();
  if (!schemaCache.has(cacheKey)) {
    const raw = await readFile(schemaPath, "utf8");
    schemaCache.set(cacheKey, JSON.parse(raw));
  }
  return schemaCache.get(cacheKey);
}

export function validateAgainstSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, schema, "$", errors);
  return { valid: errors.length === 0, errors };
}

export function assertValid(value, schema, label = "JSON") {
  const result = validateAgainstSchema(value, schema);
  if (!result.valid) {
    const detail = result.errors.map((error) => `- ${error.message}`).join("\n");
    throw new Error(`${label} 校验失败：\n${detail}`);
  }
  return value;
}
