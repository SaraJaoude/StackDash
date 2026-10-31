import { site } from "@/lib/site";

/** The brand wordmark, single-sourced from `site`: "Dev" plain, "Macro" in the accent color. */
export function Wordmark() {
  return (
    <>
      {site.nameLead}
      <span className="text-accent">{site.nameAccent}</span>
    </>
  );
}
