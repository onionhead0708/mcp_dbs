// Splits a SQL Server script into batches on `GO` (ADR-6), the way SSMS and
// sqlcmd do: GO is a separator only when it is alone on its line (optionally
// followed by a repeat count and a `--` comment), and never inside a string,
// a quoted identifier or a comment.

const GO_LINE = /^[ \t]*go(?:[ \t]+(\d+))?[ \t]*(?:--.*)?$/i;

/**
 * @returns {{ sql: string, count: number, line: number }[]} batches in order;
 *   `count` is how many times to run it, `line` is where it starts (1-based).
 *   Batches that hold only whitespace are dropped.
 */
export function splitGo(script) {
  const lines = script.split(/\r?\n/);
  const batches = [];
  let current = [];
  let startLine = 1;
  // Scanner state carried across lines.
  let quote = null; // "'", '"' or "]" while inside a string / identifier
  let blockDepth = 0; // T-SQL block comments nest

  const flush = (count) => {
    const sql = current.join("\n");
    if (sql.trim()) batches.push({ sql, count, line: startLine });
    current = [];
  };

  lines.forEach((line, index) => {
    if (!quote && blockDepth === 0) {
      const go = GO_LINE.exec(line);
      if (go) {
        const count = go[1] === undefined ? 1 : Number(go[1]);
        flush(count);
        startLine = index + 2;
        return;
      }
    }
    current.push(line);

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const next = line[i + 1];
      if (quote) {
        if (c === quote) {
          // A doubled closing character is an escaped one.
          if (next === quote) i++;
          else quote = null;
        }
      } else if (blockDepth > 0) {
        if (c === "/" && next === "*") (blockDepth++, i++);
        else if (c === "*" && next === "/") (blockDepth--, i++);
      } else if (c === "-" && next === "-") {
        break; // the rest of the line is a comment
      } else if (c === "/" && next === "*") {
        blockDepth = 1;
        i++;
      } else if (c === "'") quote = "'";
      else if (c === '"') quote = '"';
      else if (c === "[") quote = "]";
    }
  });
  flush(1);
  return batches;
}
