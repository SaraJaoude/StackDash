"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The scroll margin of a heading the alerts pagers link to (#312), so the browser stops it below
 * the sticky workspace header (`src/app/w/[workspace]/layout.tsx`: its 3.5rem top row, the
 * workspace nav under it, and a border) rather than under it. Change it with that header's height.
 */
const SCROLL_MARGIN = "scroll-mt-32";

/**
 * The heading of a paged alerts list. Its pagers link to `#<id>` (#312) and replace the list,
 * taking the focused pager link with it, and Next.js scrolls to the fragment but leaves focus
 * alone. So when the list arrives on a page by this heading's fragment, the heading takes focus
 * (#313): a screen reader says where the user is, and the next Tab enters the new list.
 *
 * `cursor` is the page the list shows. The page stays mounted across a pager navigation (only its
 * search params change), so the effect runs when the cursor changes, not on mount alone. It also
 * runs on mount, deliberately: a reload, a shared link, or a pager pressed before hydration (a
 * full page load) arrives with the same fragment and lands focus on the same heading. A live
 * refresh keeps the cursor and never takes focus mid-task. `preventScroll` leaves the scroll to
 * Next.js and the browser, which already brought the heading into view.
 */
export function PagedHeading({ id, cursor, children }: { id: string; cursor: string | null; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.location.hash === `#${id}`) ref.current?.focus({ preventScroll: true });
  }, [id, cursor]);
  return (
    // tabIndex -1 also lets the action flows move focus here (`after*FocusId` props).
    <h2 ref={ref} id={id} tabIndex={-1} className={`${SCROLL_MARGIN} text-sm font-semibold`}>
      {children}
    </h2>
  );
}
