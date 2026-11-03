const badgeColors = [
  { minimum: 90, color: "#3fb950" },
  { minimum: 75, color: "#a3c01f" },
  { minimum: 50, color: "#d29922" },
  { minimum: 0, color: "#d1453b" },
] as const;

function textWidth(text: string): number {
  return text.length * 7 + 12;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function badgeSvg(score: number): string {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const label = "rulecheck";
  const result = `${value}/100`;
  const leftWidth = textWidth(label);
  const rightWidth = textWidth(result);
  const width = leftWidth + rightWidth;
  const accessibleLabel = `rulecheck score ${value} out of 100`;
  const color = badgeColors.find((entry) => value >= entry.minimum)?.color ?? "#d1453b";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(accessibleLabel)}"><title>${escapeXml(accessibleLabel)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${leftWidth}" height="20" fill="#555"/><rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${leftWidth / 2}" y="14">${label}</text><text x="${leftWidth + rightWidth / 2}" y="14">${result}</text></g></svg>`;
}
