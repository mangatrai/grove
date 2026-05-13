import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const svgPath = "frontend/public/icons/grove-app-icon.svg";
const svg = readFileSync(svgPath, "utf8");

for (const size of [512, 192, 32]) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  const out =
    size === 32 ? "frontend/public/favicon.png" : `frontend/public/icons/icon-${size}.png`;
  writeFileSync(out, png);
  console.log(`✓ ${out}`);
}
