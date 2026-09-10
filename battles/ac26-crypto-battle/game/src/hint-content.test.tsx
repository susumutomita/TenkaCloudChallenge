import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import HintContent from "../../portal/HintContent.tsx";

test("numbered calculations stay separate and mathematical powers remain readable", () => {
  const html = renderToStaticMarkup(<HintContent text={"① 2^5 = □\n\n② □ ÷ 23\n③ Enter the remainder < 23"} />);
  expect(html.match(/<p /g)).toHaveLength(3);
  expect(html).toContain("<sup>5</sup>");
  expect(html).toContain("&lt; 23");
  expect(html.indexOf("①")).toBeLessThan(html.indexOf("②"));
  expect(html.indexOf("②")).toBeLessThan(html.indexOf("③"));
});
