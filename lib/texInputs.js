import { readFile } from 'node:fs/promises';
import path from 'node:path';

// One lexical pass: comments cannot start literal regions, and literal percent signs
// cannot start comments. Code examples must not manufacture inputs or AI tables.
export function stripTexComments(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '%') {
      const end = text.indexOf('\n', i);
      if (end < 0) break;
      out += '\n'; i = end + 1; continue;
    }
    if (text[i] !== '\\') { out += text[i++]; continue; }
    const tail = text.slice(i);
    const environment = /^\\begin\s*\{(verbatim\*?|lstlisting|minted|comment)\}/.exec(tail);
    if (environment) {
      const escaped = environment[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const end = new RegExp(`\\\\end\\s*\\{${escaped}\\}`).exec(tail.slice(environment[0].length));
      i += end ? environment[0].length + end.index + end[0].length : tail.length;
      out += ' '; continue;
    }
    const inline = /^\\(verb\*?|lstinline)(?![A-Za-z@])/.exec(tail);
    if (inline) {
      let cursor = i + inline[0].length;
      if (inline[1].startsWith('lstinline') && text[cursor] === '[') {
        let depth = 1; cursor++;
        while (cursor < text.length && depth) {
          if (text[cursor] === '\\') { cursor += 2; continue; }
          if (text[cursor] === '[') depth++;
          if (text[cursor] === ']') depth--;
          cursor++;
        }
      }
      const delimiter = text[cursor];
      if (delimiter && !/\s/.test(delimiter)) {
        if (inline[1].startsWith('lstinline') && delimiter === '{') {
          let depth = 1; cursor++;
          while (cursor < text.length && depth) {
            if (text[cursor] === '\\' && /[{}\\]/.test(text[cursor + 1] ?? '')) { cursor += 2; continue; }
            if (text[cursor] === '{') depth++;
            if (text[cursor] === '}') depth--;
            cursor++;
          }
          i = cursor;
        } else {
          const end = text.indexOf(delimiter, cursor + 1);
          i = end < 0 ? text.length : end + 1;
        }
        out += ' '; continue;
      }
    }
    // Consume a control symbol together: \\% is escaped, but \\\\% starts a comment.
    if (i + 1 < text.length && !/[A-Za-z@]/.test(text[i + 1])) { out += text.slice(i, i + 2); i += 2; }
    else out += text[i++];
  }
  return out.replace(/\r\n/g, '\n');
}

/** Expand literal input/include commands as compiled from paper/main.tex's directory.
 * Missing, dynamic and cyclic inputs are explicit errors, never a directory-scan fallback.
 * skipFile only excludes content from the returned text; reachability remains recorded.
 */
export async function readTexInputs(ws, { skipFile = () => false } = {}) {
  const root = path.resolve(ws);
  const main = path.join(root, 'paper', 'main.tex');
  const mainDir = path.dirname(main);
  const files = new Map();
  const errors = [];
  let includeOnly = null;
  const relative = (file) => path.relative(root, file).split(path.sep).join('/');
  const expand = async (file, ancestors = []) => {
    const rel = relative(file);
    if (ancestors.includes(file)) {
      errors.push(`cyclic input: ${rel}`);
      return '';
    }
    const fromRoot = path.relative(root, file);
    if (fromRoot === '..' || fromRoot.startsWith('..' + path.sep) || path.isAbsolute(fromRoot)) {
      errors.push(`input outside workspace: ${rel}`);
      return '';
    }
    let source;
    try { source = stripTexComments(await readFile(file, 'utf8')); }
    catch { errors.push(`missing input: ${rel}`); return ''; }
    // An input after end{document} is not part of the compiled document.
    source = source.split(/\\end\s*\{document\}/)[0];
    if (file === main) {
      const only = source.match(/\\includeonly\s*\{([^}]*)\}/);
      if (only) includeOnly = new Set(only[1].split(',').map((s) => s.trim().replace(/\.tex$/, '')));
    }
    const record = { path: rel, source, text: '', skipped: skipFile(rel, source) };
    files.set(rel, record);
    if (record.skipped) {
      record.text = source;
      return typeof record.skipped === 'string' ? record.skipped : '';
    }
    let out = '';
    let last = 0;
    const command = /\\(input|include)(?![A-Za-z@])\s*(?:\{([^}]+)\}|([^\s{}%]+))/g;
    for (const match of source.matchAll(command)) {
      out += source.slice(last, match.index);
      last = match.index + match[0].length;
      const target = (match[2] ?? match[3]).trim();
      if (match[1] === 'include' && includeOnly && !includeOnly.has(target.replace(/\.tex$/, ''))) continue;
      if (/[\\#$]/.test(target)) {
        errors.push(`dynamic input: ${rel}: ${target}`);
        continue;
      }
      const filename = path.extname(target) ? target : target + '.tex';
      out += '\n' + await expand(path.resolve(mainDir, filename), [...ancestors, file]) + '\n';
    }
    out += source.slice(last);
    record.text = out;
    return typeof record.skipped === 'string' ? record.skipped : record.skipped ? '' : out;
  };
  const text = await expand(main);
  return { text, files, errors };
}

export function documentContent(text) {
  const begin = /\\begin\s*\{document\}/.exec(text);
  return begin ? text.slice(begin.index + begin[0].length) : text;
}
