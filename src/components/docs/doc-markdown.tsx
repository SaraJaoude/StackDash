import Link from "next/link";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { createHeadingSlugger, listDocs, resolveDocLink, type DocPage } from "@/lib/docs";

import { CopyCodeButton } from "./copy-code-button";

// hast types come from react-markdown's own signature rather than a direct dependency on them.
type HastElement = NonNullable<ExtraProps["node"]>;
type HastNode = HastElement["children"][number];

function textContent(node: HastNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textContent).join("");
  return "";
}

const HEADING = /^h[1-6]$/;

/** rehype plugin: a GitHub-style id on every heading, so `file.md#section` links land on it. */
function rehypeHeadingIds() {
  return (tree: { children: HastNode[] }) => {
    const slug = createHeadingSlugger();
    const visit = (nodes: readonly HastNode[]) => {
      for (const node of nodes) {
        if (node.type !== "element") continue;
        if (HEADING.test(node.tagName)) {
          const id = slug(textContent(node));
          if (id !== "") node.properties.id = id;
        } else {
          visit(node.children);
        }
      }
    };
    visit(tree.children);
  };
}

const LANGUAGE_CLASS = /^language-(.+)$/;

/** The fence's language (`bash` from `language-bash` on the block's `code`), or null. */
function codeLanguage(pre: HastElement): string | null {
  for (const child of pre.children) {
    if (child.type !== "element" || child.tagName !== "code") continue;
    const classes = child.properties.className;
    if (!Array.isArray(classes)) return null;
    for (const name of classes) {
      const language = typeof name === "string" ? LANGUAGE_CLASS.exec(name)?.[1] : undefined;
      if (language !== undefined) return language;
    }
  }
  return null;
}

/**
 * rehype plugin: names each code block by its order on the page and its fence language ("block 3",
 * "bash, block 3"), so the copy buttons on one page have distinct accessible names.
 */
function rehypeCodeBlockNames() {
  return (tree: { children: HastNode[] }) => {
    let count = 0;
    const visit = (nodes: readonly HastNode[]) => {
      for (const node of nodes) {
        if (node.type !== "element") continue;
        if (node.tagName === "pre") {
          count += 1;
          const language = codeLanguage(node);
          node.properties.dataBlockName = language ? `${language}, block ${count}` : `block ${count}`;
        } else {
          visit(node.children);
        }
      }
    };
    visit(tree.children);
  };
}

const LINK_CLASS =
  "font-medium text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent";
const INLINE_CODE_CLASS = "rounded bg-panel-raised px-1.5 py-0.5 font-mono text-[0.875em] text-foreground";
const SUBHEADING_CLASS = "mt-8 scroll-mt-24 text-base font-semibold";

function markdownComponents(doc: DocPage, docHrefs: ReadonlySet<string>): Components {
  return {
    h1: ({ id, children }) => (
      <h1 id={id} className="scroll-mt-24 text-3xl font-semibold tracking-tight sm:text-4xl">
        {children}
      </h1>
    ),
    h2: ({ id, children }) => (
      <h2 id={id} className="mt-14 scroll-mt-24 border-t border-line pt-8 text-2xl font-semibold tracking-tight">
        {children}
      </h2>
    ),
    h3: ({ id, children }) => (
      <h3 id={id} className="mt-10 scroll-mt-24 text-lg font-semibold">
        {children}
      </h3>
    ),
    h4: ({ id, children }) => (
      <h4 id={id} className={SUBHEADING_CLASS}>
        {children}
      </h4>
    ),
    h5: ({ id, children }) => (
      <h5 id={id} className={SUBHEADING_CLASS}>
        {children}
      </h5>
    ),
    h6: ({ id, children }) => (
      <h6 id={id} className={SUBHEADING_CLASS}>
        {children}
      </h6>
    ),
    p: ({ children }) => <p className="mt-4 leading-7 text-foreground/85 first:mt-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className="mt-5 border-l-2 border-line-strong pl-4 text-muted">{children}</blockquote>
    ),
    hr: () => <hr className="my-10 border-line" />,
    ul: ({ className, children }) => (
      <ul
        className={
          className?.includes("contains-task-list")
            ? "mt-4 space-y-2"
            : "mt-4 list-disc space-y-2 pl-6 marker:text-muted"
        }
      >
        {children}
      </ul>
    ),
    ol: ({ start, children }) => (
      <ol start={start} className="mt-4 list-decimal space-y-2 pl-6 marker:text-muted">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1 leading-7 text-foreground/85">{children}</li>,
    // GitHub task list items: a drawn box with the state in words, not a form control nobody can use.
    input: ({ type, checked }) =>
      type === "checkbox" ? (
        <>
          <span
            aria-hidden="true"
            className="mr-2 inline-flex size-4 translate-y-0.5 items-center justify-center rounded border border-line-strong text-[11px] leading-none text-accent"
          >
            {checked ? "✓" : null}
          </span>
          <span className="sr-only">{checked ? "Done: " : "To do: "}</span>
        </>
      ) : null,
    // Scrollable blocks take focus so keyboard users can scroll them. The copy control sits in a bar
    // above the block rather than over it, so it never hides the first line of a long command.
    pre: ({ node, children }) => {
      const blockName = node?.properties.dataBlockName;
      return (
        <div className="mt-5 rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-end gap-3 border-b border-line px-3 py-1.5">
            {/* Markdown ends every code block with a newline; the copy leaves it out. */}
            <CopyCodeButton
              code={node ? textContent(node).replace(/\n$/, "") : ""}
              blockName={typeof blockName === "string" ? blockName : "code block"}
            />
          </div>
          <pre
            tabIndex={0}
            className="overflow-x-auto rounded-b-lg p-4 font-mono text-[13px] leading-6 text-foreground/90 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]"
          >
            {children}
          </pre>
        </div>
      );
    },
    code: ({ className, children }) => (
      <code className={className ? `${className} ${INLINE_CODE_CLASS}` : INLINE_CODE_CLASS}>{children}</code>
    ),
    table: ({ children }) => (
      <div tabIndex={0} className="mt-6 overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    th: ({ style, children }) => (
      <th style={style} className="min-w-32 bg-panel px-3 py-2 align-bottom font-medium text-foreground">
        {children}
      </th>
    ),
    td: ({ style, children }) => (
      <td style={style} className="min-w-32 border-t border-line px-3 py-2 align-top leading-6 text-foreground/85">
        {children}
      </td>
    ),
    a: ({ node, href, title, children }) => {
      const link = resolveDocLink(doc.slug, href ?? "", docHrefs);
      switch (link.kind) {
        case "doc":
          return (
            <Link href={link.href} title={title} className={LINK_CLASS}>
              {children}
            </Link>
          );
        case "fragment":
        case "email":
          return (
            <a href={link.href} title={title} className={LINK_CLASS}>
              {children}
            </a>
          );
        case "external":
          return (
            <a href={link.href} title={title} rel="noopener noreferrer" className={LINK_CLASS}>
              {children}
            </a>
          );
        case "repo": {
          // The repository is private, so a path is shown, never linked.
          const text = node ? textContent(node) : "";
          if (text === link.path) return <code className={INLINE_CODE_CLASS}>{link.path}</code>;
          return (
            <>
              {children} (<code className={INLINE_CODE_CLASS}>{link.path}</code>)
            </>
          );
        }
        case "unsupported":
          return <>{children}</>;
      }
    },
  };
}

/**
 * One doc's Markdown as server-rendered HTML: GitHub-flavored (tables, task lists). The only client
 * code is the copy control on each code block.
 */
export function DocMarkdown({ doc }: { doc: DocPage }) {
  const docHrefs = new Set(listDocs().map((page) => page.href));
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHeadingIds, rehypeCodeBlockNames]}
      components={markdownComponents(doc, docHrefs)}
    >
      {doc.source}
    </Markdown>
  );
}
