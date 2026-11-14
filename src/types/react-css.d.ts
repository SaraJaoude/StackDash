// The export makes this file a module, so the block below augments React's types instead of
// replacing the "react" module with an ambient declaration.
export {};

// Lets the count-up target in globals.css travel as a typed inline custom property instead of a cast.
declare module "react" {
  interface CSSProperties {
    "--count-to"?: number;
  }
}
