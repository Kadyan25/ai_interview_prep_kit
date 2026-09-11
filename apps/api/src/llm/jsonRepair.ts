/**
 * Models return JSON with a fence around it, a sentence before it, or a trailing
 * comma often enough that a repair pass is cheaper than a re-ask. Anything this
 * cannot fix falls through to the re-ask in the client.
 */

function stripFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? raw).trim();
}

/** Takes the outermost balanced object or array, ignoring braces inside strings. */
function extractJsonBlock(text: string): string {
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  const candidates = [firstObject, firstArray].filter((i) => i >= 0);
  if (candidates.length === 0) return text;
  const start = Math.min(...candidates);
  const open = text[start] === "{" ? "{" : "[";
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unterminated: close whatever is still open so JSON.parse has a chance.
  return text.slice(start) + close.repeat(Math.max(depth, 0));
}

function removeTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      out += char;
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (!inString && char === ",") {
      const rest = text.slice(i + 1);
      const nextNonSpace = rest.match(/^\s*([}\]])/);
      if (nextNonSpace) continue; // drop the comma
    }
    out += char;
  }

  return out;
}

/** Best-effort parse. Returns undefined when the text cannot be salvaged. */
export function parseJsonLoose(raw: string): unknown {
  const attempts = [
    raw,
    stripFences(raw),
    extractJsonBlock(stripFences(raw)),
    removeTrailingCommas(extractJsonBlock(stripFences(raw))),
  ];

  for (const attempt of attempts) {
    const trimmed = attempt.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // try the next repair
    }
  }
  return undefined;
}
