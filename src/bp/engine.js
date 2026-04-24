// ================================================================
// BP ENGINE — moteur Excel → JS 1:1
// ================================================================
// Source de vérité : MF FP - BP RO - v2Financement mix.xlsx
// IR : src/bp/bp_ir.json (produit par tools/excel_to_ir.py)
//
// Mission : reproduire EXACTEMENT les valeurs Excel (tolérance 0.01) sur
// les 3 667 formules du modèle. 1 cellule différente = bug critique.
//
// Règle d'or : aucune "amélioration" ou "simplification" de formule.
// Le lexer/parser/évaluateur suit la sémantique Excel.
// ================================================================

(function (global) {
  'use strict';

  // ============================================================
  // TOKENIZER
  // ============================================================
  const TOK = {
    NUM: 'NUM', STR: 'STR', BOOL: 'BOOL', REF: 'REF', RANGE: 'RANGE',
    FUNC: 'FUNC', LPAREN: '(', RPAREN: ')', COMMA: ',',
    LBRACE: '{', RBRACE: '}', SEMI: ';',
    PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', CARET: '^', AMP: '&',
    EQ: '=', NE: '<>', LT: '<', LE: '<=', GT: '>', GE: '>=', PCT: '%',
    END: 'END',
  };

  // Pattern refs: optional '$', col A..Z / AA..XFD, optional '$', row 1..1048576
  const REF_CORE = /\$?[A-Za-z]{1,3}\$?[0-9]{1,7}/;
  // Sheet ref: 'Sheet Name'! or SimpleName!
  const SHEET_PREFIX = /'(?:[^']|'')+'!|[A-Za-z_][A-Za-z0-9_.]*!/;

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;

    while (i < n) {
      const c = src[i];

      // Whitespace
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

      // String literal "..."
      if (c === '"') {
        let j = i + 1, s = '';
        while (j < n) {
          if (src[j] === '"' && src[j + 1] === '"') { s += '"'; j += 2; continue; }
          if (src[j] === '"') break;
          s += src[j++];
        }
        if (j >= n) throw new Error('Unterminated string at ' + i);
        tokens.push({ type: TOK.STR, value: s });
        i = j + 1;
        continue;
      }

      // Operators (multi-char first)
      if (c === '<' && src[i + 1] === '=') { tokens.push({ type: TOK.LE }); i += 2; continue; }
      if (c === '>' && src[i + 1] === '=') { tokens.push({ type: TOK.GE }); i += 2; continue; }
      if (c === '<' && src[i + 1] === '>') { tokens.push({ type: TOK.NE }); i += 2; continue; }
      if (c === '<') { tokens.push({ type: TOK.LT }); i++; continue; }
      if (c === '>') { tokens.push({ type: TOK.GT }); i++; continue; }
      if (c === '=') { tokens.push({ type: TOK.EQ }); i++; continue; }
      if (c === '+') { tokens.push({ type: TOK.PLUS }); i++; continue; }
      if (c === '-') { tokens.push({ type: TOK.MINUS }); i++; continue; }
      if (c === '*') { tokens.push({ type: TOK.STAR }); i++; continue; }
      if (c === '/') { tokens.push({ type: TOK.SLASH }); i++; continue; }
      if (c === '^') { tokens.push({ type: TOK.CARET }); i++; continue; }
      if (c === '&') { tokens.push({ type: TOK.AMP }); i++; continue; }
      if (c === '%') { tokens.push({ type: TOK.PCT }); i++; continue; }
      if (c === '(') { tokens.push({ type: TOK.LPAREN }); i++; continue; }
      if (c === ')') { tokens.push({ type: TOK.RPAREN }); i++; continue; }
      if (c === ',') { tokens.push({ type: TOK.COMMA }); i++; continue; }
      if (c === '{') { tokens.push({ type: TOK.LBRACE }); i++; continue; }
      if (c === '}') { tokens.push({ type: TOK.RBRACE }); i++; continue; }
      if (c === ';') { tokens.push({ type: TOK.SEMI }); i++; continue; }

      // Number
      if (c >= '0' && c <= '9') {
        let j = i;
        while (j < n && src[j] >= '0' && src[j] <= '9') j++;
        if (src[j] === '.') { j++; while (j < n && src[j] >= '0' && src[j] <= '9') j++; }
        if (src[j] === 'e' || src[j] === 'E') {
          j++;
          if (src[j] === '+' || src[j] === '-') j++;
          while (j < n && src[j] >= '0' && src[j] <= '9') j++;
        }
        tokens.push({ type: TOK.NUM, value: parseFloat(src.slice(i, j)) });
        i = j;
        continue;
      }

      // Identifier / ref / sheet-prefixed ref / function / bool
      // Try sheet prefix
      const remaining = src.slice(i);
      const sheetMatch = remaining.match(/^('(?:[^']|'')+'!|[A-Za-z_][A-Za-z0-9_.]*!)/);
      let sheetName = null;
      let consumed = 0;
      if (sheetMatch) {
        const raw = sheetMatch[1];
        sheetName = raw.endsWith('!') ? raw.slice(0, -1) : raw;
        if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
          sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
        }
        consumed = raw.length;
      }

      const afterSheet = src.slice(i + consumed);
      // After a sheet prefix, we expect a ref or a range (NOT a function)
      if (sheetName) {
        // ref or range
        const refMatch = afterSheet.match(/^(\$?[A-Za-z]{1,3}\$?[0-9]{1,7})(?::(\$?[A-Za-z]{1,3}\$?[0-9]{1,7}))?/);
        if (!refMatch) throw new Error('Expected ref after sheet at ' + i + ': ' + src);
        if (refMatch[2]) {
          tokens.push({ type: TOK.RANGE, sheet: sheetName, from: refMatch[1], to: refMatch[2] });
        } else {
          tokens.push({ type: TOK.REF, sheet: sheetName, coord: refMatch[1] });
        }
        i += consumed + refMatch[0].length;
        continue;
      }

      // Plain ref / range / func / bool
      // Boolean keywords
      if (/^TRUE\b/i.test(remaining)) {
        tokens.push({ type: TOK.BOOL, value: true }); i += 4; continue;
      }
      if (/^FALSE\b/i.test(remaining)) {
        tokens.push({ type: TOK.BOOL, value: false }); i += 5; continue;
      }

      // Try range first (ref:ref)
      const rangeMatch = remaining.match(/^(\$?[A-Za-z]{1,3}\$?[0-9]{1,7}):(\$?[A-Za-z]{1,3}\$?[0-9]{1,7})/);
      if (rangeMatch) {
        tokens.push({ type: TOK.RANGE, sheet: null, from: rangeMatch[1], to: rangeMatch[2] });
        i += rangeMatch[0].length;
        continue;
      }

      // Try ref
      const singleRef = remaining.match(/^\$?[A-Za-z]{1,3}\$?[0-9]{1,7}/);
      if (singleRef) {
        tokens.push({ type: TOK.REF, sheet: null, coord: singleRef[0] });
        i += singleRef[0].length;
        continue;
      }

      // Function name (identifier followed by '(')
      const funcMatch = remaining.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/);
      if (funcMatch) {
        tokens.push({ type: TOK.FUNC, name: funcMatch[1].toUpperCase() });
        i += funcMatch[1].length;
        // don't consume '(' here — the parser will
        continue;
      }

      throw new Error(`Unexpected char '${c}' at ${i} in: ${src}`);
    }
    tokens.push({ type: TOK.END });
    return tokens;
  }

  // ============================================================
  // PARSER (recursive descent, Excel precedence)
  // precedence (low→high): compare, concat, add/sub, mul/div, power, unary, percent, primary
  // ============================================================
  class Parser {
    constructor(tokens) { this.toks = tokens; this.i = 0; }
    peek() { return this.toks[this.i]; }
    next() { return this.toks[this.i++]; }
    expect(type) {
      const t = this.next();
      if (t.type !== type) throw new Error(`Expected ${type} got ${t.type} at ${this.i}`);
      return t;
    }

    parse() {
      const expr = this.parseCompare();
      if (this.peek().type !== TOK.END) {
        throw new Error('Trailing tokens: ' + JSON.stringify(this.peek()));
      }
      return expr;
    }

    parseCompare() {
      let left = this.parseConcat();
      while (true) {
        const t = this.peek();
        if ([TOK.EQ, TOK.NE, TOK.LT, TOK.LE, TOK.GT, TOK.GE].includes(t.type)) {
          this.next();
          const right = this.parseConcat();
          left = { kind: 'binop', op: t.type, left, right };
        } else break;
      }
      return left;
    }
    parseConcat() {
      let left = this.parseAdd();
      while (this.peek().type === TOK.AMP) {
        this.next();
        const right = this.parseAdd();
        left = { kind: 'binop', op: TOK.AMP, left, right };
      }
      return left;
    }
    parseAdd() {
      let left = this.parseMul();
      while (this.peek().type === TOK.PLUS || this.peek().type === TOK.MINUS) {
        const op = this.next().type;
        const right = this.parseMul();
        left = { kind: 'binop', op, left, right };
      }
      return left;
    }
    parseMul() {
      let left = this.parsePower();
      while (this.peek().type === TOK.STAR || this.peek().type === TOK.SLASH) {
        const op = this.next().type;
        const right = this.parsePower();
        left = { kind: 'binop', op, left, right };
      }
      return left;
    }
    parsePower() {
      const left = this.parseUnary();
      if (this.peek().type === TOK.CARET) {
        this.next();
        const right = this.parsePower(); // right-assoc
        return { kind: 'binop', op: TOK.CARET, left, right };
      }
      return left;
    }
    parseUnary() {
      if (this.peek().type === TOK.MINUS) {
        this.next();
        return { kind: 'unary', op: TOK.MINUS, operand: this.parseUnary() };
      }
      if (this.peek().type === TOK.PLUS) {
        this.next();
        return this.parseUnary();
      }
      return this.parsePercent();
    }
    parsePercent() {
      let expr = this.parsePrimary();
      while (this.peek().type === TOK.PCT) {
        this.next();
        expr = { kind: 'unary', op: TOK.PCT, operand: expr };
      }
      return expr;
    }
    parsePrimary() {
      const t = this.next();
      if (t.type === TOK.NUM) return { kind: 'num', value: t.value };
      if (t.type === TOK.STR) return { kind: 'str', value: t.value };
      if (t.type === TOK.BOOL) return { kind: 'bool', value: t.value };
      if (t.type === TOK.REF) return { kind: 'ref', sheet: t.sheet, coord: t.coord };
      if (t.type === TOK.RANGE) return { kind: 'range', sheet: t.sheet, from: t.from, to: t.to };
      if (t.type === TOK.LPAREN) {
        const inner = this.parseCompare();
        this.expect(TOK.RPAREN);
        return inner;
      }
      if (t.type === TOK.LBRACE) {
        // Array literal {1,2,3} or {1;2;3} (row sep = comma, col sep = semicolon — 1D treated as vector)
        const rows = [[]];
        if (this.peek().type !== TOK.RBRACE) {
          rows[0].push(this.parseCompare());
          while (this.peek().type === TOK.COMMA || this.peek().type === TOK.SEMI) {
            const sep = this.next().type;
            if (sep === TOK.SEMI) rows.push([this.parseCompare()]);
            else rows[rows.length - 1].push(this.parseCompare());
          }
        }
        this.expect(TOK.RBRACE);
        return { kind: 'array', rows };
      }
      if (t.type === TOK.FUNC) {
        this.expect(TOK.LPAREN);
        const args = [];
        if (this.peek().type !== TOK.RPAREN) {
          args.push(this.parseCompare());
          while (this.peek().type === TOK.COMMA) {
            this.next();
            args.push(this.parseCompare());
          }
        }
        this.expect(TOK.RPAREN);
        return { kind: 'func', name: t.name, args };
      }
      throw new Error('Unexpected token ' + JSON.stringify(t));
    }
  }

  function parse(src) {
    // src : formula string starting with '='
    const body = src.startsWith('=') ? src.slice(1) : src;
    const toks = tokenize(body);
    return new Parser(toks).parse();
  }

  // ============================================================
  // UTIL : cell coords arithmetic
  // ============================================================
  function colToNum(col) {
    col = col.replace(/\$/g, '').toUpperCase();
    let n = 0;
    for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  function numToCol(n) {
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }
  function coordSplit(coord) {
    const m = coord.replace(/\$/g, '').match(/^([A-Za-z]+)(\d+)$/);
    if (!m) throw new Error('Bad coord: ' + coord);
    return { col: m[1].toUpperCase(), row: parseInt(m[2], 10) };
  }
  function expandRange(from, to) {
    const a = coordSplit(from), b = coordSplit(to);
    const c1 = Math.min(colToNum(a.col), colToNum(b.col));
    const c2 = Math.max(colToNum(a.col), colToNum(b.col));
    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    const cells = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cells.push(numToCol(c) + r);
    return cells;
  }

  // ============================================================
  // DEPENDENCY EXTRACTION
  // ============================================================
  function extractDeps(ast, defaultSheet) {
    const deps = new Set();
    function walk(node) {
      if (!node) return;
      switch (node.kind) {
        case 'ref':
          deps.add(keyOf(node.sheet || defaultSheet, node.coord.replace(/\$/g, '').toUpperCase()));
          return;
        case 'range': {
          const sh = node.sheet || defaultSheet;
          for (const coord of expandRange(node.from, node.to)) deps.add(keyOf(sh, coord));
          return;
        }
        case 'binop': walk(node.left); walk(node.right); return;
        case 'unary': walk(node.operand); return;
        case 'func':
          for (const a of node.args) walk(a);
          return;
      }
    }
    walk(ast);
    return deps;
  }

  function keyOf(sheet, coord) { return sheet + '!' + coord.replace(/\$/g, '').toUpperCase(); }

  // ============================================================
  // VALUE COERCION (Excel semantics)
  // ============================================================
  function toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (isNaN(n)) throw err('#VALUE!');
      return n;
    }
    if (isExcelError(v)) throw v;
    return Number(v);
  }
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      if (v.toUpperCase() === 'TRUE') return true;
      if (v.toUpperCase() === 'FALSE') return false;
      return v !== '';
    }
    return !!v;
  }
  function toStr(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  const ExcelError = class extends Error { constructor(code) { super(code); this.isExcelError = true; this.code = code; } };
  function err(code) { return new ExcelError(code); }
  function isExcelError(v) { return v instanceof ExcelError; }

  // ============================================================
  // EVALUATOR
  // ============================================================
  function evaluate(ast, ctx) {
    const defaultSheet = ctx.sheet;

    function ev(node) {
      switch (node.kind) {
        case 'num': return node.value;
        case 'str': return node.value;
        case 'bool': return node.value;
        case 'ref': return ctx.get(node.sheet || defaultSheet, node.coord.replace(/\$/g, '').toUpperCase());
        case 'range': {
          const sh = node.sheet || defaultSheet;
          return expandRange(node.from, node.to).map(c => ctx.get(sh, c));
        }
        case 'array': {
          // Array literal → flatten (Excel 2D supported but here we flatten to 1D since
          // CHOOSE/SUMPRODUCT accept vectors). Rows evaluated in row-major order.
          const flat = [];
          for (const row of node.rows) for (const item of row) flat.push(ev(item));
          return flat;
        }
        case 'unary': {
          const v = ev(node.operand);
          if (node.op === TOK.MINUS) return -toNum(v);
          if (node.op === TOK.PCT) return toNum(v) / 100;
          return v;
        }
        case 'binop': {
          const a = ev(node.left);
          const b = ev(node.right);
          switch (node.op) {
            case TOK.PLUS:  return toNum(a) + toNum(b);
            case TOK.MINUS: return toNum(a) - toNum(b);
            case TOK.STAR:  return toNum(a) * toNum(b);
            case TOK.SLASH: {
              const d = toNum(b); if (d === 0) throw err('#DIV/0!');
              return toNum(a) / d;
            }
            case TOK.CARET: return Math.pow(toNum(a), toNum(b));
            case TOK.AMP:   return toStr(a) + toStr(b);
            case TOK.EQ:    return cmpEq(a, b);
            case TOK.NE:    return !cmpEq(a, b);
            case TOK.LT:    return cmpLT(a, b);
            case TOK.LE:    return cmpLT(a, b) || cmpEq(a, b);
            case TOK.GT:    return !cmpLT(a, b) && !cmpEq(a, b);
            case TOK.GE:    return !cmpLT(a, b);
          }
          throw new Error('Bad op ' + node.op);
        }
        case 'func': return callFunc(node.name, node.args.map(a => {
          try { return ev(a); } catch (e) { return e; }
        }), ev, node.args);
      }
    }
    return ev(ast);
  }
  function cmpEq(a, b) {
    if (a === null || a === undefined || a === '') a = 0;
    if (b === null || b === undefined || b === '') b = 0;
    if (typeof a === typeof b) return a === b;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    return a == b; // eslint-disable-line eqeqeq
  }
  function cmpLT(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a < b;
    return toNum(a) < toNum(b);
  }

  // ============================================================
  // EXCEL FUNCTIONS (strict 1:1 semantics)
  // ============================================================
  const FUNCS = {};

  function flattenNums(args) {
    const out = [];
    for (const a of args) {
      if (Array.isArray(a)) for (const x of a) { if (x === null || x === undefined || x === '') continue; if (typeof x !== 'string' && !isExcelError(x)) out.push(toNum(x)); }
      else if (a === null || a === undefined || a === '') continue;
      else if (typeof a === 'string') continue; // SUM skips strings
      else if (isExcelError(a)) throw a;
      else out.push(toNum(a));
    }
    return out;
  }

  FUNCS.SUM = (args) => flattenNums(args).reduce((s, x) => s + x, 0);
  FUNCS.MAX = (args) => { const a = flattenNums(args); return a.length ? Math.max(...a) : 0; };
  FUNCS.MIN = (args) => { const a = flattenNums(args); return a.length ? Math.min(...a) : 0; };
  FUNCS.ROUND = (args) => {
    const n = toNum(args[0]); const d = Math.trunc(toNum(args[1]));
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  };
  FUNCS.ABS = (args) => Math.abs(toNum(args[0]));
  FUNCS.IF = (args, _ev, rawArgs) => {
    // Short-circuit : IF(cond, a, b) — seule la branche prise doit être évaluée.
    // Mais nos args sont déjà évalués par callFunc. On accepte une erreur dans la
    // branche non prise en retournant la bonne.
    const cond = toBool(args[0] instanceof ExcelError ? (() => { throw args[0]; })() : args[0]);
    if (cond) {
      if (args[1] instanceof ExcelError) throw args[1];
      return args[1];
    }
    if (args.length >= 3) {
      if (args[2] instanceof ExcelError) throw args[2];
      return args[2];
    }
    return false;
  };
  FUNCS.IFERROR = (args, _ev, rawArgs) => {
    // IFERROR : si arg1 = erreur Excel, return arg2. Sinon return arg1.
    if (args[0] instanceof ExcelError) return args[1];
    return args[0];
  };
  FUNCS.CHOOSE = (args) => {
    // CHOOSE(index, v1, v2, ...) — si index est un array (formule matricielle),
    // retourne un array de valeurs correspondantes. Excel spec.
    const idxArg = args[0];
    const values = args.slice(1);
    if (Array.isArray(idxArg)) {
      return idxArg.map(ix => {
        const i = Math.trunc(toNum(ix));
        if (i < 1 || i > values.length) throw err('#VALUE!');
        const v = values[i - 1];
        if (v instanceof ExcelError) throw v;
        return v;
      });
    }
    const i = Math.trunc(toNum(idxArg));
    if (i < 1 || i > values.length) throw err('#VALUE!');
    const v = values[i - 1];
    if (v instanceof ExcelError) throw v;
    return v;
  };
  FUNCS.SUMPRODUCT = (args) => {
    // SUMPRODUCT(A, B, ...) = sum(A[i] * B[i] * ...)
    const arrays = args.map(a => Array.isArray(a) ? a : [a]);
    const n = arrays[0].length;
    for (const a of arrays) if (a.length !== n) throw err('#VALUE!');
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let prod = 1;
      for (const a of arrays) {
        const v = a[i];
        if (v === null || v === undefined || v === '' || typeof v === 'string') { prod = 0; break; }
        if (v instanceof ExcelError) throw v;
        prod *= toNum(v);
      }
      sum += prod;
    }
    return sum;
  };
  FUNCS.IRR = (args) => {
    // IRR(values, [guess]) — flux périodiques, retour TIR.
    // Implémentation : Newton + fallback bisection. Excel matche à ~1e-7.
    const cashflows = (Array.isArray(args[0]) ? args[0] : [args[0]]).map(v => {
      if (v === null || v === undefined || v === '' || typeof v === 'string') return 0;
      return toNum(v);
    });
    const guess = args.length >= 2 && args[1] !== null && args[1] !== undefined ? toNum(args[1]) : 0.1;
    return irr(cashflows, guess);
  };
  FUNCS.NPV = (args) => {
    // NPV(rate, v1, v2, ...) — discount at rate, assumes v1 at period 1.
    const rate = toNum(args[0]);
    const flat = flattenNums(args.slice(1));
    let s = 0;
    for (let i = 0; i < flat.length; i++) s += flat[i] / Math.pow(1 + rate, i + 1);
    return s;
  };

  function irr(cf, guess) {
    // Newton-Raphson avec fallback bissection
    const f = r => cf.reduce((s, v, i) => s + v / Math.pow(1 + r, i), 0);
    const df = r => cf.reduce((s, v, i) => s - i * v / Math.pow(1 + r, i + 1), 0);
    let r = guess;
    for (let k = 0; k < 60; k++) {
      const fv = f(r);
      if (Math.abs(fv) < 1e-9) return r;
      const d = df(r);
      if (Math.abs(d) < 1e-14) break;
      const next = r - fv / d;
      if (!isFinite(next)) break;
      if (Math.abs(next - r) < 1e-9) return next;
      r = next;
    }
    // Bisection fallback sur [-0.99, 10]
    let lo = -0.99, hi = 10;
    let flo = f(lo), fhi = f(hi);
    if (flo * fhi > 0) return err('#NUM!');
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.abs(fm) < 1e-9) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  function callFunc(name, args, ev, rawArgs) {
    const fn = FUNCS[name];
    if (!fn) throw new Error('Unsupported function: ' + name);
    // For IF / IFERROR we accept Error-valued args and decide inside
    // For others, a thrown error propagates (not masked)
    if (name !== 'IF' && name !== 'IFERROR') {
      for (const a of args) if (a instanceof ExcelError) throw a;
    }
    return fn(args, ev, rawArgs);
  }

  // ============================================================
  // MODEL — load IR, build DAG, evaluate all
  // ============================================================
  class Model {
    constructor(ir) {
      this.ir = ir;
      this.sheets = ir.sheets;
      this.values = {};   // key → resolved value
      this.formulas = {}; // key → { src, ast, sheet }
      this._indexAll();
    }

    _indexAll() {
      for (const [sheet, info] of Object.entries(this.sheets)) {
        for (const [coord, cell] of Object.entries(info.cells)) {
          const k = keyOf(sheet, coord);
          if (cell.t === 'f') {
            this.formulas[k] = { src: cell.f, sheet, coord, v_excel: cell.v_excel };
          } else if (cell.t === 'n' || cell.t === 's' || cell.t === 'b') {
            this.values[k] = cell.v;
          }
        }
      }
    }

    _parseAll() {
      for (const [k, entry] of Object.entries(this.formulas)) {
        try { entry.ast = parse(entry.src); }
        catch (e) { entry.parseError = e.message; }
      }
    }

    _buildDAG() {
      // deps: key -> Set of keys it reads
      this.deps = {};
      for (const [k, entry] of Object.entries(this.formulas)) {
        if (!entry.ast) { this.deps[k] = new Set(); continue; }
        this.deps[k] = extractDeps(entry.ast, entry.sheet);
      }
    }

    _topoSort() {
      // Kahn's algorithm — key → incoming dep count
      const nodes = Object.keys(this.formulas);
      const incoming = {};
      const children = {};
      for (const k of nodes) {
        incoming[k] = 0;
        children[k] = [];
      }
      for (const [k, deps] of Object.entries(this.deps)) {
        for (const d of deps) {
          if (this.formulas[d]) {
            incoming[k]++;
            children[d].push(k);
          }
        }
      }
      const queue = nodes.filter(k => incoming[k] === 0);
      const order = [];
      while (queue.length) {
        const k = queue.shift();
        order.push(k);
        for (const c of children[k] || []) {
          incoming[c]--;
          if (incoming[c] === 0) queue.push(c);
        }
      }
      if (order.length !== nodes.length) {
        const cycle = nodes.filter(k => incoming[k] > 0).slice(0, 10);
        throw new Error('Cycle detected: sample=' + cycle.join(', '));
      }
      this.order = order;
    }

    _ctx() {
      return {
        sheet: null,
        get: (sheet, coord) => {
          const k = keyOf(sheet, coord);
          if (k in this.values) return this.values[k];
          return 0; // Excel empty cell behaves as 0 in numeric contexts
        },
      };
    }

    evaluateAll() {
      this._parseAll();
      this._buildDAG();
      this._topoSort();
      const ctx = this._ctx();
      for (const k of this.order) {
        const entry = this.formulas[k];
        if (entry.parseError) { this.values[k] = err('#PARSE!'); continue; }
        ctx.sheet = entry.sheet;
        try {
          const v = evaluate(entry.ast, ctx);
          this.values[k] = v instanceof ExcelError ? v : v;
        } catch (e) {
          this.values[k] = e instanceof ExcelError ? e : err('#EVAL!');
          entry.evalError = e.message;
        }
      }
      return this.values;
    }

    // ============================================================
    // GOLDEN TEST
    // ============================================================
    diffAgainstExcel(tolerance = 0.01) {
      const report = { total: 0, pass: 0, fail: 0, parseErrors: 0, evalErrors: 0, diffs: [] };
      for (const [k, entry] of Object.entries(this.formulas)) {
        report.total++;
        if (entry.parseError) { report.parseErrors++; report.fail++; report.diffs.push({ key: k, reason: 'parse', err: entry.parseError, formula: entry.src }); continue; }
        if (entry.evalError) { report.evalErrors++; report.fail++; report.diffs.push({ key: k, reason: 'eval', err: entry.evalError, formula: entry.src }); continue; }
        const got = this.values[k];
        const exp = entry.v_excel;
        if (got instanceof ExcelError) {
          if (exp === null || exp === undefined) { report.pass++; continue; }
          report.fail++; report.diffs.push({ key: k, reason: 'err', got: got.code, exp, formula: entry.src }); continue;
        }
        if (typeof got === 'number' && typeof exp === 'number') {
          if (Math.abs(got - exp) <= tolerance) report.pass++;
          else { report.fail++; report.diffs.push({ key: k, reason: 'num', got, exp, delta: got - exp, formula: entry.src }); }
        } else if (got === exp) {
          report.pass++;
        } else if (exp === null || exp === undefined) {
          // Excel: formula returned 0 or empty — accept if got is 0
          if (got === 0 || got === '' || got === false) report.pass++;
          else { report.fail++; report.diffs.push({ key: k, reason: 'null', got, exp, formula: entry.src }); }
        } else {
          // Type coercion comparison (Excel loose)
          if (String(got) === String(exp)) report.pass++;
          else { report.fail++; report.diffs.push({ key: k, reason: 'mismatch', got, exp, formula: entry.src }); }
        }
      }
      return report;
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  global.BPEngine = {
    parse, tokenize, evaluate, Model,
    _internals: { FUNCS, colToNum, numToCol, expandRange, keyOf, extractDeps, irr },
  };

})(typeof window !== 'undefined' ? window : globalThis);
