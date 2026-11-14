// The export makes this file a module, so the block below augments React's types instead of
// replacing the "react" module with an ambient declaration.
export {};

// Lets the motion inputs in globals.css travel as typed inline custom properties instead of a
// cast: the count-up target, and where a hero data-flow packet parks under reduced motion.
declare module "react" {
  interface CSSProperties {
    "--count-to"?: number;
    "--park"?: string;
  }
}
