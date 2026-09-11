/** Tiny flag parser: the CLI takes two paths, so a dependency would be silly. */
export type ParsedArgs = {
  input?: string;
  output?: string;
  help: boolean;
  extras: Record<string, string | boolean>;
};

const ALIASES: Record<string, string> = { i: "input", o: "output", h: "help" };

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, extras: {} };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("-")) continue;

    const withoutDashes = token.replace(/^--?/, "");
    const [rawKey, inlineValue] = withoutDashes.split("=", 2);
    const key = ALIASES[rawKey!] ?? rawKey!;

    let value: string | boolean;
    if (inlineValue !== undefined) {
      value = inlineValue;
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        value = next;
        i += 1;
      } else {
        value = true;
      }
    }

    if (key === "input" && typeof value === "string") result.input = value;
    else if (key === "output" && typeof value === "string") result.output = value;
    else if (key === "help") result.help = true;
    else result.extras[key] = value;
  }

  return result;
}
