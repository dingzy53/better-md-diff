export type ErrorValues = Record<string, string | number>;

/** Error with `{name}` placeholders filled from `values`. */
export class PluginError extends Error {
  constructor(message: string, values: ErrorValues = {}) {
    super(message.replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name])));
    this.name = 'PluginError';
  }
}
