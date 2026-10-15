import { Fragment } from "react";

/** Render the short powers used in this problem's prose without interpreting HTML. */
export default function MathText({ children }: { readonly children: string }) {
  const powers = [...children.matchAll(/([A-Za-z0-9]+)\^([+−-]?\d+|[A-Za-z])\b/g)];
  let offset = 0;
  return <>{powers.map((match) => {
    const start = match.index!;
    const before = children.slice(offset, start);
    offset = start + match[0].length;
    return <Fragment key={start}>{before}{match[1]}<sup>{match[2]}</sup></Fragment>;
  })}{children.slice(offset)}</>;
}
