// Minimal streaming CSV reader for PropLine exports (RFC 4180 quoting).
// Records are handed to onRecord as { column: value } objects keyed by the
// header row, so appended columns never shift a positional parser.

export function parseCsvLine(line) {
  const out = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

/**
 * Feed text chunks with push(); rows spanning chunks (including quoted
 * newlines) are held until complete. Returns false from push() once onRecord
 * returns false, so the caller can stop reading.
 */
export function createCsvStream(onRecord, { onHeader = () => true } = {}) {
  let buffer = '', header = null, stopped = false;
  function emit(line) {
    if (stopped) return;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) return;
    const cells = parseCsvLine(line);
    if (!header) {
      header = cells.map(cell => cell.trim());
      if (onHeader(header) === false) stopped = true;
      return;
    }
    const record = {};
    for (let i = 0; i < header.length; i++) record[header[i]] = cells[i] ?? '';
    if (onRecord(record) === false) stopped = true;
  }
  function drain(final) {
    let start = 0, quotes = 0;
    for (let i = 0; i < buffer.length && !stopped; i++) {
      const c = buffer[i];
      if (c === '"') quotes++;
      else if (c === '\n' && quotes % 2 === 0) { emit(buffer.slice(start, i)); start = i + 1; quotes = 0; }
    }
    buffer = buffer.slice(start);
    if (final && buffer && !stopped) { emit(buffer); buffer = ''; }
  }
  return {
    push(chunk) { if (stopped) return false; buffer += chunk; drain(false); return !stopped; },
    end() { drain(true); return !stopped; },
    header: () => header,
  };
}
