import type {
  VNAssetResolver,
  VNAssetWhitelist,
  VNGraphValidationOptions,
  VNGraphValidationResult,
  VNNodeSaveData,
  VNResourceFieldSchema,
  VNSerializedValue,
} from './types';

export function validateResourceFields(
  node: VNNodeSaveData,
  resourceFields: VNResourceFieldSchema[],
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  for (const field of resourceFields) {
    const rootValue = node.Data[field.RootFieldName];
    if (!rootValue) continue;

    const result = field.IsTopLevelField
      ? validateResourceValue(`node #${node.Index}.${field.FieldPath}`, field, rootValue, options)
      : validateNestedResourceValue(`node #${node.Index}.${field.FieldPath}`, field, rootValue, options);
    if (!result.valid) return result;
  }

  return ok();
}

function validateNestedResourceValue(
  displayPath: string,
  field: VNResourceFieldSchema,
  value: VNSerializedValue,
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  if (!isRecord(value)) return ok();
  if (value.Kind === 'String' && leafName(displayPath) === field.FieldName) {
    return validateResourceValue(displayPath, field, value, options);
  }
  if (value.Kind === 'List' && Array.isArray(value.Items)) {
    for (let i = 0; i < value.Items.length; i++) {
      const result = validateNestedResourceValue(`${displayPath}[${i}]`, field, value.Items[i], options);
      if (!result.valid) return result;
    }
  }
  if (value.Kind === 'Object' && isRecord(value.ObjectValue)) {
    for (const [key, child] of Object.entries(value.ObjectValue)) {
      const result = validateNestedResourceValue(`${displayPath}.${key}`, field, child, options);
      if (!result.valid) return result;
    }
  }
  return ok();
}

function validateResourceValue(
  displayPath: string,
  field: VNResourceFieldSchema,
  value: VNSerializedValue,
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  if (value.Kind !== 'String') return ok();
  const reference = normalizeAssetId(value.StringValue ?? '');
  if (!reference) return ok();

  if (!options.assetWhitelist) {
    return fail(`${displayPath} references an asset without a whitelist: ${reference}.`);
  }

  if (field.Category !== 'Chapter') {
    if (!hasAssetsScope(reference)) return fail(`${displayPath} must be empty or an assets: scoped id.`);
    if (!options.assetWhitelist.contains(field.Category, reference)) {
      return fail(`${displayPath} references an asset outside the whitelist: ${reference}.`);
    }
  }

  if (!options.assetResolver) {
    return fail(`${displayPath} references an asset without a resolver: ${reference}.`);
  }

  const resolved = options.assetResolver.resolve(reference, field.AssetType, field.Category);
  if (!resolved) return fail(`${displayPath} references an unresolved asset: ${reference}.`);
  if (typeof resolved === 'string' && !resolved.trim()) return fail(`${displayPath} resolved to an empty path: ${reference}.`);
  return ok();
}

export function normalizeAssetId(value: string): string {
  return (value ?? '').trim();
}

function hasAssetsScope(value: string): boolean {
  const index = value.indexOf(':');
  return index > 0 && value.slice(0, index).toLowerCase() === 'assets';
}

function leafName(path: string): string {
  let text = path ?? '';
  const dotIndex = text.lastIndexOf('.');
  if (dotIndex >= 0) text = text.slice(dotIndex + 1);
  const bracketIndex = text.indexOf(']');
  if (bracketIndex >= 0 && bracketIndex < text.length - 1) {
    text = text.slice(bracketIndex + 1).replace(/^\./, '');
  }
  if (text.endsWith('[]')) text = text.slice(0, -2);
  return text;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ok(): VNGraphValidationResult {
  return { valid: true, error: '', errors: [] };
}

function fail(error: string): VNGraphValidationResult {
  return { valid: false, error, errors: [error] };
}

export type { VNAssetResolver, VNAssetWhitelist };
