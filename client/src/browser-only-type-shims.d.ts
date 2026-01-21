// Type-only shims to allow browser-only TypeScript builds.
//
// Some dependencies ship Node-oriented .d.ts (e.g. mentioning `setImmediate` or `stream`)
// even when the browser runtime path doesn't use them.

declare function setImmediate(callback: (...args: any[]) => void, ...args: any[]): number
declare function clearImmediate(handle: number): void

declare module "stream" {
  export class Transform {}
  export class Readable {}
}
