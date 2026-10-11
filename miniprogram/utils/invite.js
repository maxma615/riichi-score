function parseInvite(raw) {
  if (typeof raw !== "string") return "";
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    return "";
  }
  if (/^[a-f0-9]{32}$/.test(s)) return s;
  return s.match(/(?:\?|&)(?:scene|join)=([a-f0-9]{32})(?:&|$)/)?.[1] || "";
}
module.exports = { parseInvite };
