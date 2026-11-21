const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/\S+/gi,
  /rediss?:\/\/\S+/gi,
  /wss:\/\/\S+/gi,
  /\bEV\[[^\]]*\]/g,
  /\bmd5[0-9a-f]{32}\b/gi,
  /SCRAM-SHA-256\$\S+/g,
  /Bearer\s+\S+/gi,
  /\bpassword\s*[:=]\s*\S+/gi,
];

export function redact(text, extras = []) {
  let output = String(text ?? "");
  const needles = extras.filter((extra) => typeof extra === "string" && extra.length >= 4);
  needles.sort((left, right) => right.length - left.length);
  for (const extra of needles) {
    output = output.split(extra).join("[redacted]");
  }
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output;
}
