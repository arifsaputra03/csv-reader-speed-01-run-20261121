// A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// run(input) returns exactly csv-reader's answer {columns, rows, errors} for
// every {text, header}, but reads the text with native indexOf scans and
// slice() instead of one character at a time, so a clean field costs a few
// native calls instead of a JS loop per character, and a record with no quote
// and no CR in it is one native split(',') of its line.
//
// Semantics (csv-reader 1.0.0, as the kit documents it):
// - A U+FEFF at the very start of the text is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside it is one quote; each CRLF or lone CR inside it is read as LF;
//   what follows its closing quote, up to the next comma or line break, is
//   appended to it as it stands (quote_junk, when the field ends); a quote
//   that never closes is a literal character and the text after it is read
//   again as unquoted (unterminated_quote). A quote inside an unquoted field
//   is a literal character.
// - Fields stay strings, never trimmed or converted. columns is the first
//   record when header is true, else null; rows holds the records after it
//   (every record when header is false), each padded with "" (short_row, with
//   fields: its field count) or cut (long_row, with extra: the cut fields) to
//   the first record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on (counting every LF, CRLF and lone CR inside a
//   quoted field), row is its record's index in rows, null for the header.
//   A field's quote_junk is recorded when the field ends, a record's
//   short_row or long_row when the record ends.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;
  const hasCR = text.indexOf('\r') !== -1;

  // The record being read: the line it starts on and its index in rows
  // (null for the header). Field errors use these.
  let recordLine = 1;
  let recordRow = null;

  // Outputs of the field readers.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, onto `value` (the characters
  // kept so far). Sets fValue, fEnded and fAdded (the characters this read
  // kept, not counting `value`).
  function unquoted(value) {
    const iC = text.indexOf(',', pos);
    const iN = text.indexOf('\n', pos);
    let end;
    if (iC === -1) end = iN === -1 ? n : iN;
    else if (iN === -1) end = iC;
    else end = iC < iN ? iC : iN;
    // A CR just before the LF is the CRLF: it ends the field, it is not kept.
    let valEnd = end;
    if (end === iN && end > pos && text.charCodeAt(end - 1) === 13) valEnd = end - 1;
    const piece = text.slice(pos, valEnd);
    if (hasCR && piece.indexOf('\r') !== -1) {
      // A stray CR sits inside this field: re-read it a character at a time.
      // The stretch before the first CR is already known clean.
      const cr = piece.indexOf('\r');
      let v = value + piece.slice(0, cr);
      let added = cr;
      let p = pos + cr;
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44) {
          p += 1;
          fValue = v;
          fEnded = COMMA;
          fAdded = added;
          pos = p;
          return;
        }
        if (c === 10) {
          p += 1;
          line += 1;
          fValue = v;
          fEnded = LINE_BREAK;
          fAdded = added;
          pos = p;
          return;
        }
        if (c === 13) {
          if (text.charCodeAt(p + 1) === 10) {
            p += 2;
            line += 1;
            fValue = v;
            fEnded = LINE_BREAK;
            fAdded = added;
            pos = p;
            return;
          }
          err('stray_cr');
          p += 1;
          continue;
        }
        v += text[p];
        added += 1;
        p += 1;
      }
      fValue = v;
      fEnded = END;
      fAdded = added;
      pos = p;
      return;
    }
    fValue = value + piece;
    fAdded = valEnd - pos;
    if (end === n) {
      fEnded = END;
      pos = n;
    } else if (end === iC) {
      fEnded = COMMA;
      pos = end + 1;
    } else {
      fEnded = LINE_BREAK;
      pos = end + 1;
      line += 1;
    }
  }

  // A stretch [a, b) of a quoted field, holding no quote: its characters as
  // the field keeps them (each CRLF and each lone CR one LF), counting the
  // line breaks it holds.
  function segConvert(a, b) {
    if (a === b) return '';
    const s = text.slice(a, b);
    if (!hasCR || s.indexOf('\r') === -1) {
      // No CR: the stretch is kept as it stands; only LF counts lines.
      let i = s.indexOf('\n');
      if (i === -1) return s;
      let count = 0;
      while (i !== -1) {
        count += 1;
        i = s.indexOf('\n', i + 1);
      }
      line += count;
      return s;
    }
    // CRs present: each CRLF and each lone CR is one LF in the value and one
    // line; a lone LF stays and counts one line.
    let out = '';
    let start = 0;
    for (;;) {
      const iR = s.indexOf('\r', start);
      const iN = s.indexOf('\n', start);
      if (iR === -1 && iN === -1) {
        out += s.slice(start);
        break;
      }
      if (iR !== -1 && (iN === -1 || iR < iN)) {
        out += s.slice(start, iR) + '\n';
        line += 1;
        start = s.charCodeAt(iR + 1) === 10 ? iR + 2 : iR + 1;
      } else {
        out += s.slice(start, iN + 1);
        line += 1;
        start = iN + 1;
      }
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue, fEnded.
  function quoted() {
    const open = pos;
    const openLine = line;
    let p = pos + 1;
    let q = text.indexOf('"', p);
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      err('unterminated_quote');
      unquoted('"');
      return;
    }
    let value;
    if (text.charCodeAt(q + 1) !== 34) {
      // One stretch, no doubled quote: the field is that stretch as kept.
      value = segConvert(p, q);
      pos = q + 1;
    } else {
      // Doubled quotes: assemble the stretches with one quote each.
      const parts = [segConvert(p, q), '"'];
      p = q + 2;
      for (;;) {
        q = text.indexOf('"', p);
        if (q === -1) {
          pos = open + 1;
          line = openLine;
          err('unterminated_quote');
          unquoted('"');
          return;
        }
        parts.push(segConvert(p, q));
        if (text.charCodeAt(q + 1) === 34) {
          parts.push('"');
          p = q + 2;
          continue;
        }
        pos = q + 1;
        break;
      }
      value = parts.join('');
    }
    afterQuote(value);
  }

  // What follows a closing quote: a comma, a line break, the end of the
  // text, or junk appended as it stands. Sets fValue, fEnded.
  function afterQuote(value) {
    if (pos >= n) {
      fValue = value;
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    unquoted(value);
    if (fAdded > 0) err('quote_junk');
  }

  records: while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record holding no quote and no CR is one native split
    // of its line. The line ends at the first LF (or the end of the text);
    // a CR just before it is the CRLF, not part of any field.
    let fields = null;
    let quotedLast = false;
    const lineEnd = text.indexOf('\n', pos);
    const spanEnd =
      lineEnd !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13
        ? lineEnd - 1
        : lineEnd === -1
          ? n
          : lineEnd;
    const span = text.slice(pos, spanEnd);
    if (span.indexOf('"') === -1 && (!hasCR || span.indexOf('\r') === -1)) {
      fields = span.split(',');
      if (lineEnd !== -1) line += 1;
      pos = lineEnd === -1 ? n : lineEnd + 1;
    }
    if (fields === null) {
      fields = [];
      do {
        if (text.charCodeAt(pos) === 34) {
          quotedLast = true;
          quoted();
        } else {
          quotedLast = false;
          unquoted('');
        }
        fields.push(fValue);
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue records;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue records;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
