export function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(`课文闯关：${message}`);
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function text(value: unknown, max = 2000): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}
export function id(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9._-]{0,119}$/.test(value);
}
export function learnerIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}
export function time(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function array(value: unknown, max = 2000): value is unknown[] {
  return Array.isArray(value) && value.length <= max;
}
export function ids(value: unknown, max = 2000): value is string[] {
  return array(value, max) && value.every(id) && new Set(value).size === value.length;
}
export function uniqueRecords(value: unknown, max: number): asserts value is Record<string, unknown>[] {
  requireValid(array(value, max) && value.every(record), "列表格式无效。");
  requireValid(ids(value.map(item => item.id), max), "标识无效或重复。");
}
export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
