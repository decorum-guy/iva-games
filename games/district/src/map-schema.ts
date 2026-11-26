/** Map data contains layout and presentation only. Rules remain in the versioned core. */
export interface DistrictMap {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  version: string;
  name: { ru: string; en: string };
  description: { ru: string; en: string };
  width: number;
  height: number;
  rows: string[];
  supportedPlayers: number[];
}

const keys = ['$schema', 'schemaVersion', 'id', 'version', 'name', 'description', 'width', 'height', 'rows', 'supportedPlayers'];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function localized(value: unknown, max: number): boolean {
  return record(value) && Object.keys(value).length === 2 && ['ru', 'en'].every(language =>
    typeof value[language] === 'string' && (value[language] as string).trim().length > 0 &&
    (value[language] as string).length <= max && !/[\u0000-\u001f]/.test(value[language] as string));
}

/** Returns human-readable authoring errors, never executes map-supplied code. */
export function districtMapErrors(value: unknown): string[] {
  if (!record(value)) return ['Map must be a JSON object.'];
  const errors: string[] = [];
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`Unknown map field: ${key}.`);
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/.test(value.id)) errors.push('id must use 2–48 lowercase letters, digits and hyphens.');
  if (typeof value.version !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value.version)) errors.push('version must be a positive integer encoded as a string.');
  if (value.$schema !== undefined && value.$schema !== '../map.schema.json') errors.push('$schema must be ../map.schema.json when present.');
  if (!localized(value.name, 60)) errors.push('name needs nonempty ru/en strings, at most 60 characters each.');
  if (!localized(value.description, 240)) errors.push('description needs nonempty ru/en strings, at most 240 characters each.');
  if (value.width !== 5 || value.height !== 5) errors.push('The district@0.2 map profile requires a 5 × 5 board.');
  if (!Array.isArray(value.supportedPlayers) || JSON.stringify(value.supportedPlayers) !== '[2,3,4]') errors.push('The supported total seat counts must be [2,3,4].');
  if (!Array.isArray(value.rows) || value.rows.length !== 5 || value.rows.some(row => typeof row !== 'string' || !/^[.HPS]{5}$/.test(row))) {
    errors.push('rows must contain five rows of five symbols: . (lot), H (neutral house), P (park site), S (square).');
    return errors;
  }
  const rows = value.rows as string[];
  const cells = rows.join('');
  for (const [symbol, count] of [['.', 16], ['H', 4], ['P', 4], ['S', 1]] as const) {
    if ([...cells].filter(cell => cell === symbol).length !== count) errors.push(`The map needs exactly ${count} '${symbol}' cells.`);
  }
  const neighbors = (i: number): number[] => [i - 5, i + 5, ...(i % 5 ? [i - 1] : []), ...(i % 5 < 4 ? [i + 1] : [])].filter(j => j >= 0 && j < 25);
  const lots = [...cells].flatMap((cell, i) => cell === '.' ? [i] : []);
  // Necessary geometric conditions only: they do not establish competitive balance.
  if (lots.filter(i => neighbors(i).some(j => cells[j] === 'P')).length < 2) errors.push('Green goal needs two private lots next to park sites.');
  if (lots.filter(i => neighbors(i).every(j => cells[j] !== 'H')).length < 2) errors.push('Industry goal needs two private lots without adjacent neutral houses.');
  if (!lots.some(i => neighbors(i).some(j => cells[j] === '.')) || lots.length < 3) errors.push('Network goal needs adjacent private lots and room for another cafe.');
  return errors;
}

export function parseDistrictMap(value: unknown): DistrictMap {
  const errors = districtMapErrors(value);
  if (errors.length) throw new Error(`Invalid District map: ${errors.join(' ')}`);
  return structuredClone(value) as DistrictMap;
}

export function validateDistrictMapCatalog(values: unknown[]): DistrictMap[] {
  if (!values.length) throw new Error('District needs at least one map.');
  const identities = new Set<string>();
  return values.map(value => {
    const map = parseDistrictMap(value);
    const key = `${map.id}@${map.version}`;
    if (identities.has(key)) throw new Error(`Duplicate District map: ${key}.`);
    identities.add(key);
    return map;
  });
}
