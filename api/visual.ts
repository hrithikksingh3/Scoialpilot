import type { IncomingMessage, ServerResponse } from "node:http";

function esc(value: string): string {
  return value.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
}
export default function handler(req: IncomingMessage & { query?: Record<string, string | string[] | undefined> }, res: ServerResponse) {
  const q = req.query ?? {};
  const title = String(Array.isArray(q.title) ? q.title[0] : q.title ?? "The tech worth knowing").slice(0, 110);
  const category = String(Array.isArray(q.category) ? q.category[0] : q.category ?? "CODERSVOICE TECH BRIEF").slice(0, 34).toUpperCase();
  const lines: string[] = [];
  let current = "";
  for (const word of title.split(/\s+/)) {
    if ((current + " " + word).trim().length > 27) { lines.push(current); current = word; }
    else current = (current + " " + word).trim();
  }
  if (current) lines.push(current);
  const titleSvg = lines.slice(0, 3).map((line, i) => `<text x="72" y="${255 + i * 65}" font-size="49" font-weight="750" fill="#ffffff">${esc(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b0b16"/><stop offset="1" stop-color="#31205f"/></linearGradient><radialGradient id="glow"><stop stop-color="#8b5cf6" stop-opacity=".65"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" rx="0" fill="url(#bg)"/><circle cx="1020" cy="80" r="360" fill="url(#glow)"/><circle cx="1030" cy="430" r="155" fill="none" stroke="#a78bfa" stroke-opacity=".3" stroke-width="2"/><circle cx="1030" cy="430" r="105" fill="none" stroke="#a78bfa" stroke-opacity=".45" stroke-width="2"/><path d="M850 430h360M1030 250v360" stroke="#a78bfa" stroke-opacity=".25"/><rect x="72" y="72" width="14" height="14" rx="4" fill="#a78bfa"/><text x="100" y="85" font-size="22" font-weight="700" letter-spacing="4" fill="#c4b5fd">CODERSVOICE</text><rect x="72" y="143" width="430" height="38" rx="19" fill="#8b5cf6" fill-opacity=".2" stroke="#a78bfa" stroke-opacity=".5"/><text x="91" y="168" font-size="16" font-weight="700" letter-spacing="2" fill="#ddd6fe">${esc(category)}</text>${titleSvg}<text x="72" y="520" font-size="21" fill="#c4b5fd">The signal behind the headline.</text><path d="M72 558H1128" stroke="#a78bfa" stroke-opacity=".45"/><text x="72" y="592" font-size="17" fill="#a1a1b5">SCOIALPILOT  /  RESEARCH-LED • HUMAN-APPROVED</text><text x="1085" y="105" font-size="52" fill="#c4b5fd">✳</text></svg>`;
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.end(svg);
}
