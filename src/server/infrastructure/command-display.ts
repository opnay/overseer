import { stripVTControlCharacters } from "node:util";

const sensitiveName =
  /password|passwd|token|secret|credential|authorization|api[-_]?key|access[-_]?key/i;
const hiddenArgumentFlags = new Set([
  "-e",
  "--env",
  "--build-arg",
  "-c",
  "-lc",
  "--command",
  "--eval",
]);

function quote(value: string): string {
  const printable = stripVTControlCharacters(value).replace(/[\r\n\t]/g, (character) =>
    character === "\n" ? "\\n" : character === "\r" ? "\\r" : "\\t",
  );
  return /^[\w@%+=:,./-]+$/.test(printable) ? printable : `'${printable.replaceAll("'", "'\\''")}'`;
}

function redactURL(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";
    for (const key of url.searchParams.keys()) {
      if (sensitiveName.test(key)) url.searchParams.set(key, "REDACTED");
    }
    return url.href;
  } catch {
    return value;
  }
}

/** Display only. Never pass this redacted representation back to a shell. */
export function commandDisplay(executable: string, args: readonly string[]): string {
  let hideNext = false;
  const displayed = args.map((argument) => {
    if (hideNext) {
      hideNext = false;
      return "[가림]";
    }
    const equals = argument.indexOf("=");
    if (equals > 0) {
      const key = argument.slice(0, equals);
      if (
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        (key.startsWith("-") && sensitiveName.test(key)) ||
        hiddenArgumentFlags.has(key)
      ) {
        return `${key}=[가림]`;
      }
      if (key.startsWith("-")) return `${key}=${redactURL(argument.slice(equals + 1))}`;
    }
    if (
      args.includes("login") &&
      argument.startsWith("-p") &&
      !argument.startsWith("--") &&
      argument.length > 2
    )
      return "-p[가림]";
    if (
      hiddenArgumentFlags.has(argument) ||
      (argument.startsWith("-") && sensitiveName.test(argument)) ||
      (argument === "-p" && args.includes("login"))
    )
      hideNext = true;
    return redactURL(argument);
  });
  return [executable, ...displayed].map(quote).join(" ");
}
