import type { PageLayoutBlock } from "@/lib/ocr/layout";

/** Reading-order reconstruction: tables, rules, and the original chart or formula pixels. */
export function LayoutSheet({ blocks }: { blocks: PageLayoutBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white px-4 py-4 text-neutral-900">
      {blocks.map((block, index) => {
        if (block.kind === "rule") {
          return <hr key={index} className="my-1 border-neutral-900" />;
        }
        if (block.kind === "text") {
          return (
            <p key={index} className={block.role === "title" ? "font-heading text-xl font-semibold" : "text-sm leading-6"}>
              {block.text}
            </p>
          );
        }
        if (block.kind === "table") {
          return (
            <div key={index} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="border border-neutral-900 px-2 py-1 align-top">
                          {cell || " "}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <figure key={index} className="flex flex-col gap-1" style={{ width: `${Math.round(block.width * 100)}%` }}>
            {block.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={block.src}
                alt={block.role === "equation" ? "算式" : "圖表"}
                className="h-auto max-w-full bg-white"
              />
            ) : null}
            <figcaption className="text-xs text-neutral-600">
              {block.role === "equation" ? "算式" : "圖表"}
              {block.text ? ` · ${block.text}` : ""}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
