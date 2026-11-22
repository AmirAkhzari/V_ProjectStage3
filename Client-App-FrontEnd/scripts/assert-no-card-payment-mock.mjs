import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = fs.readFileSync(path.join(root, "src/cardPayment/mock/fixtures.ts"), "utf8");
const banned = ["SLICE_F_MOCK_MARKER", "TEST_PAN", "TEST_IBAN"].map((name) => {
  const match = fixtures.match(new RegExp(`export const ${name} = "([^"]+)"`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
});
const dist = path.join(root, "dist");
if (!fs.existsSync(dist)) throw new Error("dist/ is missing. Run the production build first.");
const hits = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|css|html|txt|svg|json)$/.test(entry.name) && banned.some((token) => fs.readFileSync(full, "utf8").includes(token))) hits.push(path.relative(root, full));
  }
};
walk(dist);
if (hits.length) throw new Error(`slice F mock leaked into production output: ${hits.join(", ")}`);
console.log("card-payment mock is absent from dist");
