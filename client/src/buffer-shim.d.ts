// Type-only shim to let browser-only builds consume libraries that reference Node's Buffer in .d.ts.
// Intentionally does NOT declare a global Buffer value (so Buffer.from() still type-errors in browser code).

type Buffer = Uint8Array
