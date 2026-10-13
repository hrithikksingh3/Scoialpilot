import type { IncomingMessage, ServerResponse } from "node:http";

function esc(value: string): string {
  return value.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
}
function wrap(text: string, max = 22, maxLines = 5): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if ((line + " " + word).trim().length > max && line) { lines.push(line); line = word; }
    else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[.!?…]*$/, "") + "…";
    return kept;
  }
  return lines;
}
export default function handler(req: IncomingMessage & { query?: Record<string, string | string[] | undefined> }, res: ServerResponse) {
  const q = req.query ?? {};
  const read = (key: string, fallback: string, max: number) =>
    String(Array.isArray(q[key]) ? q[key]?.[0] : q[key] ?? fallback).slice(0, max);
  const hook = read("title", "The tech worth knowing", 150);
  const category = read("category", "TECH SIGNAL", 32).toUpperCase();
  const topic = read("topic", "technology", 32).toLowerCase();
  const lines = wrap(hook, 22, 5);
  const headline = lines.map((line, i) =>
    `<text x="76" y="${300 + i * 75}" font-size="61" font-weight="780" letter-spacing="-2" fill="#ffffff">${esc(line)}</text>`
  ).join("");
  const accent = topic.includes("security") ? "#fb7185" : topic.includes("cloud") ? "#38bdf8" : topic.includes("open") ? "#4ade80" : "#a78bfa";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#080914"/><stop offset=".52" stop-color="#17102e"/><stop offset="1" stop-color="#321d63"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="${accent}" stop-opacity=".72"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#24213e" stop-opacity=".96"/><stop offset="1" stop-color="#0b0c19" stop-opacity=".96"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="1080" height="1350" fill="url(#bg)"/>
  <circle cx="880" cy="600" r="350" fill="url(#glow)" filter="url(#soft)"/>
  <path d="M0 720 Q320 610 560 760 T1080 700M0 760 Q320 650 560 800 T1080 740" fill="none" stroke="${accent}" stroke-opacity=".16" stroke-width="2"/>
  <rect x="64" y="62" width="14" height="14" rx="4" fill="${accent}"/>
  <text x="96" y="78" font-family="Arial,sans-serif" font-size="27" font-weight="800" letter-spacing="6" fill="#f5f3ff">CODERSVOICE</text>
  <text x="1010" y="78" text-anchor="end" font-family="Arial,sans-serif" font-size="16" letter-spacing="3" fill="#c4b5fd">TECH SIGNAL</text>
  <rect x="64" y="132" width="570" height="48" rx="24" fill="${accent}" fill-opacity=".16" stroke="${accent}" stroke-opacity=".72"/>
  <text x="88" y="163" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#f3e8ff">${esc(category.slice(0, 27))}</text>
  ${headline}
  <text x="76" y="${Math.min(710, 350 + lines.length * 75)}" font-family="Arial,sans-serif" font-size="25" fill="#d8ccff">Here’s why developers should care.</text>
  <circle cx="800" cy="845" r="205" fill="url(#glow)" opacity=".75"/>
  <circle cx="800" cy="845" r="164" fill="#111126" fill-opacity=".48" stroke="${accent}" stroke-opacity=".72" stroke-width="3"/>
  <circle cx="800" cy="845" r="124" fill="none" stroke="${accent}" stroke-opacity=".46" stroke-width="2"/>
  <ellipse cx="800" cy="845" rx="68" ry="164" fill="none" stroke="${accent}" stroke-opacity=".4" stroke-width="2"/>
  <ellipse cx="800" cy="845" rx="164" ry="64" fill="none" stroke="${accent}" stroke-opacity=".45" stroke-width="2" transform="rotate(-25 800 845)"/>
  <path d="M640 845H960M800 685V1005" stroke="${accent}" stroke-opacity=".25"/>
  <circle cx="702" cy="756" r="7" fill="#fff"/><circle cx="898" cy="805" r="8" fill="${accent}"/><circle cx="760" cy="964" r="6" fill="#fff"/>
  <g transform="translate(60 1000) rotate(-3 450 110)">
    <rect width="960" height="205" rx="26" fill="url(#glass)" stroke="${accent}" stroke-opacity=".85" stroke-width="2"/>
    <circle cx="34" cy="32" r="6" fill="#fb7185"/><circle cx="56" cy="32" r="6" fill="#fbbf24"/><circle cx="78" cy="32" r="6" fill="#4ade80"/>
    <text x="36" y="78" font-family="monospace" font-size="18" fill="${accent}">// THE TAKEAWAY</text>
    <text x="36" y="124" font-family="Arial,sans-serif" font-size="29" font-weight="700" fill="#ffffff">New capability. New possibilities.</text>
    <text x="36" y="164" font-family="Arial,sans-serif" font-size="22" fill="#c4b5fd">Get the context before the hype.</text>
  </g>
  <path d="M64 1250H1016" stroke="#a78bfa" stroke-opacity=".48"/>
  <text x="64" y="1292" font-family="Arial,sans-serif" font-size="17" letter-spacing="3" fill="#c4b5fd">RESEARCH-LED • HUMAN-APPROVED</text>
  <text x="1016" y="1292" text-anchor="end" font-family="Arial,sans-serif" font-size="17" fill="#c4b5fd">@CODERSVOICE</text>
  </svg>`;
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(svg);
}
