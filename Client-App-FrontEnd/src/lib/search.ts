import { normalizePersian } from "./format";

export function scoreText(target: string, query: string) {
  const cn = normalizePersian(target);
  const qn = normalizePersian(query);
  if (!qn) return 0;
  if (cn === qn) return 100;
  if (cn.startsWith(qn)) return 90;
  if (cn.includes(qn)) return 70;
  let ci = 0;
  let qi = 0;
  while (ci < cn.length && qi < qn.length) {
    if (cn[ci] === qn[qi]) qi += 1;
    ci += 1;
  }
  if (qi === qn.length) return Math.round(50 * (qn.length / cn.length));
  return 0;
}

export function fuzzyScore(query: string, target: string) {
  if (!query) return 0;
  const q = normalizePersian(query).trim();
  const t = normalizePersian(target);
  if (t.includes(q)) return 2;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi += 1;
  }
  return qi === q.length ? 1 : 0;
}
