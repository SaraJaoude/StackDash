import type { ComponentType, SVGProps } from "react";

export type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** Accent-tinted square holding a section icon. */
export function IconTile({ icon: IconComponent }: { icon: Icon }) {
  return (
    <span className="inline-flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
      <IconComponent width={20} height={20} />
    </span>
  );
}

export interface IconCardItem {
  icon: Icon;
  title: string;
  body: string;
}

/** List item card: icon, heading, and one short paragraph. Render inside a `<ul>`. */
export function IconCard({ icon, title, body }: IconCardItem) {
  return (
    <li className="rounded-xl border border-line bg-panel p-6">
      <IconTile icon={icon} />
      <h3 className="mt-5 text-lg font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
    </li>
  );
}
