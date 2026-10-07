// OPAL static checker: lexer, checker, formatter. No dependencies.
(function (root) {
  'use strict';
  const KW = new Set(['if','then','elif','else','endif','for','from','to','step','by','in','endfor','while','endwhile','try','catch','endcatch','rethrow','return','break','continue','call','import','argument','and','or','not','ignoreunused']);
  const TYPES = new Set(['integer','float','string','date','hms','color','icon','duration','object','vector','enum','any','graph','regularexpression','boolean','void']);
  const CONSTS = new Set(['null','true','false','newline','epvmode','globalbucketseries','tab']);
  const OPENERS = { if: 'endif', for: 'endfor', while: 'endwhile', try: 'endcatch' };
  const CLOSERS = { endif: 'if', endfor: 'for', endwhile: 'while', endcatch: 'try' };
  const OPS2 = ['==','!=','<=','>=','+=','-=','*=','/=','..','&&','||','<>'];
  const ASSIGN = new Set(['=','+=','-=','*=','/=']);
  const isLetter = c => /[A-Za-z_$]/.test(c);
  const isIdChar = c => /[A-Za-z0-9_]/.test(c);

  function lex(src) {
    const toks = [], errs = [];
    let i = 0, ln = 0, lineStart = 0, onlyWs = true;
    let bd = 0; // [ ] depth, so V[a:b] is not read as a :Label
    const n = src.length;
    const push = (k, s, e, extra) => { const t = { k, v: src.slice(s, e), s, e, ln, c: s - lineStart }; t.lv = t.v.toLowerCase(); if (extra) Object.assign(t, extra); toks.push(t); return t; };
    while (i < n) {
      const ch = src[i];
      if (ch === '\n') { push('nl', i, i + 1); i++; ln++; lineStart = i; onlyWs = true; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '﻿') { i++; continue; }
      const wasStart = onlyWs; onlyWs = false;
      if (ch === '/' && src[i + 1] === '/') {
        let e = src.indexOf('\n', i); if (e < 0) e = n;
        push(src[i + 2] === '!' ? 'hdr' : 'cmt', i, e); i = e; continue;
      }
      if (ch === '/' && src[i + 1] === '*') {
        let e = src.indexOf('*/', i + 2);
        const t = { k: 'cmt', s: i, ln, c: i - lineStart };
        if (e < 0) { errs.push({ sev: 'error', ln, c: i - lineStart, len: 2, msg: 'Block comment is never closed. Add */ to end it.', code: 'E-COMMENT' }); e = n; } else e += 2;
        // emit one token per line so highlighting stays line-based
        let s = i;
        while (s < e) {
          let nl = src.indexOf('\n', s); if (nl < 0 || nl >= e) nl = e;
          push('cmt', s, nl);
          if (nl < e) { push('nl', nl, nl + 1); ln++; lineStart = nl + 1; s = nl + 1; } else s = nl;
        }
        i = e; continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n && src[j] !== ch && src[j] !== '\n') j++;
        if (j >= n || src[j] === '\n') {
          errs.push({ sev: 'error', ln, c: i - lineStart, len: j - i, msg: `String is not closed on this line. Add the closing ${ch}.`, code: 'E-STRING' });
          push('str', i, j); i = j; continue;
        }
        push('str', i, j + 1); i = j + 1; continue;
      }
      if (ch === '#' && wasStart) {
        let j = i + 1; while (j < n && isIdChar(src[j])) j++;
        push('dir', i, j); i = j; continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || '') && src[i - 1] !== '.')) {
        const m = /^(\d*\.?\d*(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 40));
        let len = m[1].length;
        if (src[i + len - 1] === '.' && src[i + len] === '.') len--; // range 1..5
        push('num', i, i + len); i += len; continue;
      }
      if (ch === '{' && /^\{[A-Za-z_]\w*\}/.test(src.slice(i, i + 64))) {   // template placeholder such as {Object}
        const j = src.indexOf('}', i) + 1;
        push('id', i, j); i = j; continue;
      }
      if (isLetter(ch)) {
        let j = i + 1; while (j < n && isIdChar(src[j])) j++;
        const w = src.slice(i, j).toLowerCase();
        push(KW.has(w) ? 'kw' : TYPES.has(w) ? 'type' : 'id', i, j); i = j; continue;
      }
      if (ch === ':' && isLetter(src[i + 1] || '') && bd <= 0) {
        let j = i + 1; while (j < n && isIdChar(src[j])) j++;
        push('label', i, j); i = j; continue;
      }
      const two = src.substr(i, 2);
      if (OPS2.includes(two)) { push('op', i, i + 2); i += 2; continue; }
      if ('+-*/%=<>!.,;()[]{}@?:&|'.includes(ch)) { if (ch === '[') bd++; else if (ch === ']') bd--; else if (ch === ';') bd = 0; push('op', i, i + 1); i++; continue; }
      errs.push({ sev: 'error', ln, c: i - lineStart, len: 1, msg: `Unexpected character "${ch}".`, code: 'E-CHAR' });
      push('bad', i, i + 1); i++;
    }
    return { toks, errs };
  }

  function loopLabelIn(T, i, ln) {   // ":Label" or ": Label" at the end of a For/While header
    for (let q = i + 1; T[q] && T[q].ln === ln; q++) {
      if (T[q].k === 'label') return T[q].v.slice(1).trim().toLowerCase();
      if (T[q].v === ':' && T[q + 1] && T[q + 1].k === 'id' && T[q + 1].ln === ln) return T[q + 1].lv;
    }
    return null;
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // catalog: { fnSet:Set(lowercase), globals:Set(lowercase) }
  function check(src, catalog) {
    catalog = catalog || { fnSet: new Set(), globals: new Set() };
    const { toks: all, errs } = lex(src);
    const P = errs.slice();
    const add = (sev, t, msg, code, len) => P.push({ sev, ln: t.ln, c: t.c, len: len || (t.e - t.s) || 1, msg, code });

    // significant tokens, with directive lines removed
    const dirLines = new Set();
    const dirStack = [];
    for (const t of all) if (t.k === 'dir') {
      dirLines.add(t.ln);
      if (t.lv === '#if' || t.lv === '#ifdef' || t.lv === '#ifndef') dirStack.push(t);
      else if (t.lv === '#endif') { if (!dirStack.pop()) add('error', t, '#EndIf without a matching #If.', 'E-DIR'); }
    }
    for (const t of dirStack) add('error', t, '#If is never closed with #EndIf.', 'E-DIR');

    // which #If/#Else branch each line is in, so alternative declarations are not duplicates
    const branchOf = [];
    { const st = []; let ifId = 0;
      src.split('\n').forEach((line, l) => {
        const m = /^\s*#(if|ifdef|ifndef|else|elif|elseif|endif)\b/i.exec(line);
        if (m) { const d = m[1].toLowerCase();
          if (d.startsWith('if')) st.push([++ifId, 0]);
          else if (d === 'endif') st.pop();
          else if (st.length) st[st.length - 1][1]++; }
        branchOf[l] = st.map(x => x[0] + ':' + x[1]);
      }); }
    // lines inside an #If whose condition mentions INVISIBLE (guarded against invisible/batch mode)
    const invisGuard = [];
    { const st = []; src.split('\n').forEach((line, l) => {
        const m = /^\s*#(if|ifdef|ifndef|else|elif|elseif|endif)\b(.*)/i.exec(line);
        if (m) { const d = m[1].toLowerCase(); if (d.startsWith('if')) st.push(/INVISIBLE/i.test(m[2])); else if (d === 'endif') st.pop(); }
        invisGuard[l] = st.some(Boolean);
      }); }
    const exclusive = (l1, l2) => { const a = branchOf[l1] || [], b = branchOf[l2] || [];
      return a.some(x => b.some(y => x.split(':')[0] === y.split(':')[0] && x !== y)); };
    const T = [];
    let sawNl = true;
    let sawDir = false;
    for (const t of all) {
      if (t.k === 'nl') { sawNl = true; continue; }
      if (t.k === 'cmt' || t.k === 'hdr' || t.k === 'bad') continue;
      if (dirLines.has(t.ln)) { sawDir = true; continue; }
      t.nl = sawNl; t.dirBefore = sawDir; sawNl = false; sawDir = false; T.push(t);
    }
    const lv = i => (T[i] ? T[i].lv : '');
    const decls = new Map(); // lower -> decl
    const imports = new Set();
    const usage = new Map();
    const refs = [];
    const calls = [];
    const stack = [];
    const parens = [];
    let lastStmt = null;
    const info = { decls, imports, calls };

    const STMT_START_KW = new Set(['call','if','for','while','return','try','argument','import','break','continue','rethrow']);
    const endable = t => t && (t.k === 'id' || t.k === 'num' || t.k === 'str' || (t.k === 'op' && (t.v === ')' || t.v === ']')) || (t.k === 'kw' && false));
    const startsStmt = j => {
      const t = T[j]; if (!t) return false;
      if (t.k === 'type') return true;
      if (t.k === 'kw' && STMT_START_KW.has(t.lv)) return true;
      if (t.k === 'id' && T[j + 1] && T[j + 1].k === 'op' && ASSIGN.has(T[j + 1].v)) return true;
      if (t.k === 'id' && T[j + 1] && T[j + 1].v === '(' && T[j - 1] && T[j - 1].ln < t.ln) return true;
      return false;
    };

    function trackParen(t, j) {
      if (t.k !== 'op') return;
      if (t.v === '(') { const pv = T[j - 1]; if (pv && pv.k === 'op' && (pv.v === ')' || pv.v === ']') && pv.ln === t.ln) add('error', t, 'Unexpected "(" directly after a closing bracket. Did you forget an operator, a comma or a ";"?', 'E-PAREN'); }
      if (t.v === '(' || t.v === '[' || t.v === '{') parens.push(t);
      else if (t.v === ')' || t.v === ']' || t.v === '}') {
        const want = { ')': '(', ']': '[', '}': '{' }[t.v];
        const o = parens.pop();
        if (!o) add('error', t, `Unmatched "${t.v}" — there is no opening "${want}".`, 'E-PAREN');
        else if (o.v !== want) { add('error', t, `"${t.v}" does not match "${o.v}" opened on line ${o.ln + 1}.`, 'E-PAREN'); }
      }
    }
    function noteRef(j) {
      const t = T[j];
      if (t.k !== 'id') return;
      const prev = T[j - 1], next = T[j + 1];
      if (prev && prev.k === 'op' && prev.v === '.') return;
      if (next && next.k === 'op' && next.v === '(') {
        if (prev && prev.k === 'kw' && prev.lv === 'call') return; // handled by call
        calls.push({ t, call: false }); return;
      }
      if (next && next.k === 'op' && next.v === '=' && parens.length) return; // named argument
      usage.set(t.lv, (usage.get(t.lv) || 0) + 1);
      refs.push(t);
    }
    // Scan an expression from j until stop(j) true or statement end. Returns index of stop token.
    function scanExpr(j, opts) {
      const base = parens.length;
      let inl = 0; // nesting of inline If … Then … Else expressions
      for (; j < T.length; j++) {
        const t = T[j];
        const inlineKw = () => {
          if (t.k !== 'kw') return false;
          if (t.lv === 'if') {
            if (T[j + 1] && T[j + 1].v === '(') {
              let d = 0, comma = false, k = j + 1;
              for (; k < T.length; k++) { if (T[k].v === '(') d++; else if (T[k].v === ')') { d--; if (d === 0) break; } else if (T[k].v === ',' && d === 1) comma = true; }
              if (comma && !(T[k + 1] && T[k + 1].lv === 'then')) { add('error', t, 'OPAL has no If(cond, a, b) function. Use an inline "If cond Then a Else b" or an If … EndIf; statement.', 'E-TERNARY'); return true; }
            }
            inl++; return true;
          }
          if (inl && (t.lv === 'then' || t.lv === 'elif')) return true;
          if (inl && t.lv === 'else') { inl--; return true; }
          return false;
        };
        if (parens.length > base && inlineKw()) continue;
        if (parens.length === base) {
          if (opts.stop && opts.stop(j)) return j;
          if (t.k === 'op' && t.v === ';') return j;
          if (j > opts.from && t.nl && opts.nlEnds) return j;
          if (j > opts.from && t.nl && !t.dirBefore && endable(T[j - 1]) && startsStmt(j)) {
            add('error', T[j - 1], `Missing ";" at the end of line ${T[j - 1].ln + 1}.`, 'E-SEMI');
            return j;
          }
          if (t.lv === 'if' ? (j === opts.from || !t.nl) && inlineKw() : inlineKw()) continue;
          if (opts.stop && opts.stop(j)) return j;
          if (t.k === 'op' && t.v === ';') return j;
          if (j > opts.from && t.nl && opts.nlEnds) return j;
          if (j > opts.from && t.nl && !t.dirBefore && endable(T[j - 1]) && startsStmt(j)) {
            add('error', T[j - 1], `Missing ";" at the end of line ${T[j - 1].ln + 1}.`, 'E-SEMI');
            return j;
          }
          if (t.k === 'kw' && (t.lv in OPENERS || t.lv in CLOSERS || ['elif','else','catch','then','return','call'].includes(t.lv)) && !(opts.allow && opts.allow.has(t.lv))) {
            if (t.lv === 'then' && !opts.wantThen) { add('error', t, '"Then" without a matching If.', 'E-THEN'); continue; }
            if (endable(T[j - 1]) && !t.dirBefore && !(t.lv in CLOSERS || ['elif','else','catch','then'].includes(t.lv))) add('error', T[j - 1], `Missing ";" before "${t.v}".`, 'E-SEMI');
            return j;
          }
          if (opts.eqCheck && t.k === 'op' && t.v === '=') add('error', t, 'Single "=" assigns a value. Use "==" to compare.', 'E-EQ');
        }
        if (t.k === 'type' && opts.inExpr !== false && T[j + 1] && T[j + 1].k === 'id' && t.lv !== 'any') {
          // a type keyword in the middle of an expression: likely a missing ';' before a declaration
          if (t.nl && endable(T[j - 1])) { add('error', T[j - 1], `Missing ";" at the end of line ${T[j - 1].ln + 1}.`, 'E-SEMI'); return j; }
        }
        exprShape(t, j, opts.from);
        trackParen(t, j);
        noteRef(j);
        if (parens.length < base) { /* closed more than opened: already reported */ }
      }
      return j;
    }
    // Expression shape: two operands with no operator between them, empty ( ), stray { }
    function exprShape(t, j, from) {
      const pv = T[j - 1];
      if (t.k === 'op' && (t.v === '{' || t.v === '}')) {
        if (t.v === '}' && pv && pv.v === '{') return;
        add('error', t, 'Curly braces are only used around a single identifier, e.g. {Object}. They cannot group code or build a value.', 'E-EXPR'); return;
      }
      if (!pv || j <= from || t.dirBefore || pv.k === 'dir') return;
      if (t.v === ')' && pv.v === '(' && !(T[j - 2] && (T[j - 2].k === 'id' || T[j - 2].k === 'type'))) {
        add('error', pv, 'Empty parentheses. ( ) only follow a function name, e.g. CurrentDate().', 'E-EXPR'); return;
      }
      const isEnd = x => ['id','num','str','const'].includes(x.k) || x.v === ')' || x.v === ']';
      const isStart = x => ['id','num','str','const'].includes(x.k) || x.v === '(' || x.v === '[';
      if (!isEnd(pv) || !isStart(t)) return;
      if (t.v === '(' && (pv.k === 'id' || pv.v === ')')) return;          // call, or ")(" reported by E-PAREN
      if (t.v === '[' && (pv.k === 'id' || pv.v === ')' || pv.v === ']')) return;   // indexing
      add('error', t, `Missing operator between "${pv.v}" and "${t.v}". Two values cannot stand next to each other; add + - * / == , or a ";" if a new statement starts here.`, 'E-EXPR');
    }
    function parseDecl(j) {
      const start = T[j];
      let isArg = false, isVec = false, typeText = [];
      if (lv(j) === 'argument') { isArg = true; j++; }
      while (lv(j) === 'vector') { isVec = true; typeText.push('Vector'); j++; }
      const tt = T[j];
      if (!tt || tt.k !== 'type') { add('error', tt || start, 'Expected a type (Integer, Float, String, Date, Object <Class>, Vector <Type> …).', 'E-DECL'); return j; }
      if (tt.lv === 'boolean') add('error', tt, 'OPAL has no Boolean type. Use Integer with 1/0 (or TRUE/FALSE).', 'E-BOOL');
      typeText.push(tt.v); j++;
      if (tt.lv === 'object' || tt.lv === 'enum') {
        if (T[j] && (T[j].k === 'id' || T[j].k === 'type' || T[j].k === 'kw')) { typeText.push(T[j].v); j++; }
        else { add('error', tt, `${tt.v} needs a class name, e.g. "Object Product MyProduct;".`, 'E-DECL'); }
      }
      for (;;) {
        const nm = T[j];
        if (!nm || nm.k !== 'id') { add('error', nm || tt, 'Expected a variable name after the type.', 'E-DECL'); return scanExpr(j, { from: j }); }
        let ignore = false; j++;
        while (lv(j) === 'ignoreunused' || lv(j) === 'redefinition') { if (lv(j) === 'ignoreunused') ignore = true; j++; }
        const d = { name: nm.v, t: nm, isArg, isVec, type: typeText.join(' '), ignore, ln: nm.ln };
        if (decls.has(nm.lv)) {
          const l1 = decls.get(nm.lv).ln, l2 = nm.ln;
          const cond = (branchOf[l1] || []).length && (branchOf[l2] || []).length && (branchOf[l1] || []).join() !== (branchOf[l2] || []).join();
          if (exclusive(l1, l2)) { /* #If / #Else alternatives */ }
          else if (cond) add('warning', nm, `"${nm.v}" is also declared on line ${l1 + 1}, in a different #If block. Fine only if the two #If conditions can never both be true.`, 'W-DUP');
          else add('error', nm, `Identifier "${nm.v}" already exists (declared on line ${decls.get(nm.lv).ln + 1}). A name can be declared only once, even with a different type. Remove one declaration or rename the variable.`, 'E-DUP'); }
        else decls.set(nm.lv, d);
        if (T[j] && T[j].k === 'op' && T[j].v === '=') { j = scanExpr(j + 1, { from: j + 1, stop: k => T[k].k === 'op' && T[k].v === ',' }); }
        if (T[j] && T[j].k === 'op' && T[j].v === ',') { j++; continue; }
        break;
      }
      if (T[j] && T[j].k === 'op' && T[j].v === ';') return j;
      if (T[j] && T[j].nl) { add('error', T[j - 1], `Missing ";" at the end of line ${T[j - 1].ln + 1}.`, 'E-SEMI'); return j - 1; }
      if (T[j]) add('error', T[j], `Unexpected "${T[j].v}" in declaration.`, 'E-DECL');
      return scanExpr(j, { from: j });
    }

    let i = 0;
    let afterReturn = null;
    if (T.length && T[0].lv === 'if' && !T.some(t => t.v === ';')) {
      scanExpr(0, { from: 0 });
      i = T.length;
      P.push({ sev: 'info', ln: T[0].ln, c: T[0].c, len: 2, msg: 'Inline If … Then … Else expression without EndIf. This works where OPAL expects a single expression (category formulas, calculated attributes), not inside a multi-statement macro.', code: 'I-INLINEIF' });
    }
    while (i < T.length) {
      const t = T[i];
      // unreachable code after Return
      if (afterReturn) {
        if (!(t.k === 'kw' && (t.lv in CLOSERS || ['elif','else','catch'].includes(t.lv)))) add('warning', t, 'This code never runs: it comes after Return in the same block.', 'W-UNREACH');
        afterReturn = null;
      }
      if (t.k === 'op' && t.v === ';') {   // a ";" where a statement should start = empty statement
        let q = i - 1; while (q >= 0 && ['nl','cmt','hdr'].includes(T[q].k)) q--;
        const prev = T[q];
        let r = i; while (T[r + 1] && T[r + 1].v === ';' && T[r + 1].ln === t.ln) r++;
        if (!t.dirBefore && !(prev && prev.k === 'dir')) {
          if (prev && prev.k === 'kw' && ['then','else','try','catch'].includes(prev.lv)) add('error', t, prev.lv === 'then' ? 'No ";" after Then. OMP reads it as an empty block ("An if/elif-then statement needs to end on the EndIf-keyword"). Remove the semicolon.' : `No ";" after ${prev.v}. OMP reports "statement expected". Remove the semicolon.`, 'E-EMPTY');
          else if (prev && prev.v === ';') add('error', t, 'Extra ";". OMP reports "statement expected": one semicolon ends the statement, remove the rest.', 'E-EMPTY');
          else if (r > i) add('error', T[i + 1], `${r - i + 1} semicolons in a row. OMP reports "statement expected": one ";" ends the statement, remove the extra ${r - i === 1 ? 'one' : r - i}.`, 'E-EMPTY');
        }
        i = r + 1; continue;
      }
      if (t.k === 'label') { i++; continue; }
      lastStmt = t;
      if (t.k === 'kw') {
        const w = t.lv;
        if (w === 'if' || w === 'elif') {
          if (w === 'elif') {
            const top = stack[stack.length - 1];
            if (!top || top.kw !== 'if') { add('error', t, 'ElIf without an open If.', 'E-BLOCK'); }
            else if (top.elseSeen) add('error', t, 'ElIf after Else. Move it before the Else branch.', 'E-BLOCK');
          } else stack.push({ kw: 'if', t, idx: i });
          // ternary misuse
          if (T[i + 1] && T[i + 1].v === '(' ) {
            let d = 0, comma = false, k = i + 1;
            for (; k < T.length; k++) { if (T[k].v === '(') d++; else if (T[k].v === ')') { d--; if (d === 0) break; } else if (T[k].v === ',' && d === 1) comma = true; }
            if (comma && !(T[k + 1] && T[k + 1].lv === 'then')) {
              add('error', t, 'OPAL has no If(cond, a, b) function. Write an If … Then … Else … EndIf; statement.', 'E-TERNARY');
            }
          }
          const j = scanExpr(i + 1, { from: i + 1, wantThen: true, eqCheck: true, stop: k => T[k].lv === 'then' });
          if (!T[j] || T[j].lv !== 'then') { add('error', t, `${t.v} without "Then". The condition must end with Then.`, 'E-THEN'); i = j; continue; }
          if (j === i + 1) add('error', t, `${t.v} has no condition.`, 'E-THEN');
          i = j + 1; continue;
        }
        if (w === 'else') {
          const top = stack[stack.length - 1];
          if (!top || top.kw !== 'if') add('error', t, 'Else without an open If.', 'E-BLOCK');
          else { if (top.elseSeen) add('error', t, 'This If already has an Else.', 'E-BLOCK'); top.elseSeen = true; }
          if (T[i + 1] && T[i + 1].lv === 'if' && T[i + 1].ln === t.ln) add('warning', t, '"Else If" opens a new nested If that needs its own EndIf. Did you mean ElIf?', 'W-ELSEIF', T[i + 1].e - t.s);
          i++; continue;
        }
        if (w in CLOSERS) {
          const want = CLOSERS[w];
          const top = stack[stack.length - 1];
          if (!top) add('error', t, `${t.v} without a matching ${want === 'try' ? 'Try' : want.charAt(0).toUpperCase() + want.slice(1)}.`, 'E-BLOCK');
          else if (top.kw !== want) {
            add('error', t, `${t.v} found, but the ${top.t.v} on line ${top.t.ln + 1} is still open. Expected ${OPENERS[top.kw] === 'endcatch' ? 'EndCatch' : OPENERS[top.kw].replace(/^end(\w)/, (m, c) => 'End' + c.toUpperCase())}.`, 'E-BLOCK');
            // recover: pop until match if present
            const idx = stack.map(s => s.kw).lastIndexOf(want);
            if (idx >= 0) stack.length = idx; else stack.pop();
          } else {
            if (want === 'try' && !top.catchSeen) add('error', top.t, 'Try block has no Catch.', 'E-BLOCK');
            stack.pop();
          }
          i++; if (T[i] && T[i].v === ';') i++;
          continue;
        }
        if (w === 'for') {
          const blk = { kw: 'for', t };
          const v = T[i + 1];
          let j = i + 2;
          if (!v || v.k !== 'id') { add('error', t, 'For needs a loop variable: For i from 1 to N  or  For obj in all("Type").', 'E-FOR'); stack.push(blk); i++; continue; }
          const mode = lv(j);
          if (!decls.has(v.lv)) add('info', v, `Loop variable "${v.v}" is not declared. OPAL creates it automatically, but declaring it (e.g. "Integer ${v.v};") fixes its type and makes typos visible.`, 'I-UNDECL');
          usage.set(v.lv, (usage.get(v.lv) || 0) + 1);
          if (T[j] && T[j].v === '=') {
            add('error', T[j], 'OPAL uses "For i from 1 to N", not "For i = 1 to N".', 'E-FOR');
            j++;
          } else if (mode !== 'from' && mode !== 'in') {
            add('error', T[j] || v, 'Expected "from" or "in" after the loop variable.', 'E-FOR');
          } else j++;
          const hdrStart = j;
          j = scanExpr(j, { from: hdrStart - 1, nlEnds: true, allow: new Set(['to','step','by']) });
          // header analysis
          const hdr = T.slice(hdrStart, j);
          if (mode === 'in' && hdr.some((h, k) => h.lv === 'all' && hdr[k + 1] && hdr[k + 1].v === '(')) {
            blk.scansAll = true;
            const outer = stack.find(s => s.kw === 'for' && s.scansAll);
            if (outer) add('info', t, `Nested table scan: this all() loop runs once for every row of the loop on line ${outer.t.ln + 1}. For large tables, look up rows with Locate…() or build a lookup vector first.`, 'I-NESTED', 3);
          }
          if (mode === 'from' && hdr[0] && hdr[0].k === 'num' && hdr[0].v === '0') {
            const sz = hdr.findIndex(h => h.lv === 'size');
            const arg = sz >= 0 ? hdr[sz + 2] : null;
            const d = arg && decls.get(arg.lv);
            if (d && d.isVec) add('warning', hdr[0], `Vectors are 1-indexed. "${arg.v}[0]" does not exist; start the loop at 1.`, 'W-INDEX0');
          }
          blk.label = loopLabelIn(T, i, t.ln);
          if (T[j] && T[j].v === ';') add('error', T[j], 'No ";" after a For header. OMP reports "statement expected"; the loop body starts on the next line.', 'E-EMPTY');
          stack.push(blk);
          i = j; if (T[i] && T[i].v === ';') i++; continue;
        }
        if (w === 'while') {
          const wblk = { kw: 'while', t };
          wblk.label = loopLabelIn(T, i, t.ln);
          stack.push(wblk);
          const j = scanExpr(i + 1, { from: i + 1, nlEnds: true, eqCheck: true });
          const cond = T.slice(i + 1, j);
          const lt = cond.findIndex((c, k) => c.v === '<' && cond[k + 1] && cond[k + 1].lv === 'size');
          if (lt >= 0) add('info', cond[lt], 'Vectors are 1-indexed, so the last element is at Size(v). Use "<=" if you want to include it.', 'I-SIZE');
          if (T[j] && T[j].v === ';') add('error', T[j], 'No ";" after a While condition. OMP reports "statement expected"; the loop body starts on the next line.', 'E-EMPTY');
          i = j; if (T[i] && T[i].v === ';') i++; continue;
        }
        if (w === 'try') { stack.push({ kw: 'try', t }); i++; continue; }
        if (w === 'catch') {
          const top = stack[stack.length - 1];
          if (!top || top.kw !== 'try') add('error', t, 'Catch without an open Try.', 'E-BLOCK');
          else { if (top.catchSeen) add('error', t, 'This Try already has a Catch.', 'E-BLOCK'); top.catchSeen = true; }
          if (T[i + 1] && T[i + 1].lv === 'endcatch') add('warning', t, 'Empty Catch hides every error. Log it with Call WriteMessage(…) or use Rethrow;', 'W-EMPTYCATCH');
          i++; continue;
        }
        if (w === 'return') {
          const j = scanExpr(i + 1, { from: i + 1 });
          afterReturn = t; i = j; if (T[i] && T[i].v === ';') i++;
          if (!(T[i - 1] && T[i - 1].v === ';')) afterReturn = null;
          continue;
        }
        if (w === 'call') {
          const f = T[i + 1];
          if (!f || f.k !== 'id') add('error', t, 'Call must be followed by a function name, e.g. Call WriteMessage("…");', 'E-CALL-NAME');
          else { calls.push({ t: f, call: true }); if (!(T[i + 2] && T[i + 2].v === '(')) add('error', f, `Missing "(" after ${f.v}. Even without arguments write ${f.v}();`, 'E-CALL-NAME'); }
          i = scanExpr(i + 2, { from: i + 2 }); continue;
        }
        if (w === 'import') {
          const f = T[i + 1];
          if (f && (f.k === 'id' || f.k === 'str')) imports.add(f.v.replace(/"/g, '').toLowerCase());
          i = scanExpr(i + 2, { from: i + 2 }); continue;
        }
        if (w === 'argument') { i = parseDecl(i); continue; }
        if (w === 'then') { add('error', t, '"Then" without a matching If.', 'E-THEN'); i++; continue; }
        if (w === 'break' || w === 'continue' || w === 'rethrow') {
          const loops = stack.filter(s => s.kw === 'for' || s.kw === 'while');
          if (w === 'rethrow') {
            if (!stack.some(s => s.kw === 'try' && s.catchSeen)) add('error', t, 'Rethrow can only be used inside a Catch block.', 'E-BREAK');
            i++; continue;
          }
          const lab = T[i + 1] && T[i + 1].k === 'id' && T[i + 1].ln === t.ln ? T[i + 1] : null;
          if (!loops.length) add('error', t, `${t.v} can only be used inside a For or While loop.`, 'E-BREAK');
          else if (!lab) {
            const inner = loops[loops.length - 1];
            add('error', t, inner.label ? `Loop label is expected: write "${t.v} ${inner.label};". OPAL needs the label even inside the loop.` : `Loop label is expected. Give the loop a label (e.g. "${inner.t.v} ... :MyLoop") and write "${t.v} MyLoop;".`, 'E-BREAK');
          } else if (!loops.some(s => s.label === lab.lv)) add('error', lab, `No enclosing loop has the label "${lab.v}". Put ":${lab.v}" at the end of the For/While line.`, 'E-BREAK');
          i++; if (lab) i++;
          continue;
        }
        // other keywords in statement position (and/or/not/from/to): treat as expression
        i = scanExpr(i, { from: i }); continue;
      }
      if (t.k === 'type') { i = parseDecl(i); continue; }
      if (t.k === 'id' && t.lv === 'end' && T[i + 1] && ['if','for','while','catch','try'].includes(T[i + 1].lv) && T[i + 1].ln === t.ln) {
        const one = T[i + 1].lv === 'try' || T[i + 1].lv === 'catch' ? 'EndCatch' : 'End' + T[i + 1].v.charAt(0).toUpperCase() + T[i + 1].v.slice(1).toLowerCase();
        add('error', t, `OPAL writes this as one word: ${one};`, 'E-ENDWORD', T[i + 1].e - t.s);
        const want = T[i + 1].lv === 'catch' ? 'try' : T[i + 1].lv;
        const top = stack[stack.length - 1];
        if (top && top.kw === want) stack.pop();
        i += 2; if (T[i] && T[i].v === ';') i++;
        continue;
      }
      if (t.k === 'id') {
        const nx = T[i + 1];
        if (nx && nx.k === 'op' && ASSIGN.has(nx.v)) {
          if (!decls.has(t.lv) && !catalog.globals.has(t.lv)) add('info', t, `"${t.v}" is not declared. OPAL creates it automatically on first assignment, but declaring it (e.g. "String ${t.v};") fixes its type and makes typos visible.`, 'I-UNDECL');
          usage.set(t.lv, (usage.get(t.lv) || 0));
          i = scanExpr(i + 2, { from: i + 2 }); continue;
        }
        if (nx && nx.v === '(') {
          // bare function call as a statement?
          let d = 0, k = i + 1;
          for (; k < T.length; k++) { if (T[k].v === '(') d++; else if (T[k].v === ')') { d--; if (d === 0) break; } }
          const after = T[k + 1];
          if (after && after.v === ';') add('error', t, `Add "Call" in front: Call ${t.v}(…); OMP rejects a statement that only runs a function ("statement was not ended").`, 'E-CALL');
        }
      }
      i = scanExpr(i, { from: i });
    }
    for (const s of stack) if (s.kw === 'if' && s.elseSeen && !T.slice(s.idx).some(x => x.v === ';')) {
      add('info', s.t, 'Inline If … Then … Else expression without EndIf. This works where OPAL expects a single expression (category formulas, calculated attributes), not inside a multi-statement macro.', 'I-INLINEIF');
    } else add('error', s.t, `${s.t.v} is never closed. Add ${s.kw === 'try' ? 'EndCatch' : OPENERS[s.kw].replace(/^end(\w)/, (m, c) => 'End' + c.toUpperCase())};`, 'E-BLOCK');
    for (const p of parens) add('error', p, `"${p.v}" is never closed.`, 'E-PAREN');

    // unused declarations
    for (const [k, d] of decls) {
      if (d.isArg || d.ignore) continue;
      if (!usage.get(k)) add('warning', d.t, `"${d.name}" is declared but never used.`, 'W-UNUSED');
    }
    // unknown names close to a declared one
    const declNames = [...decls.keys()];
    const seenRef = new Set();
    for (const r of refs) {
      if (decls.has(r.lv) || CONSTS.has(r.lv) || catalog.globals.has(r.lv) || seenRef.has(r.lv)) continue;
      if (/^[A-Z0-9_]+$/.test(r.v)) continue;
      if (r.v.length < 4) continue;
      const near = declNames.find(n => lev(n, r.lv) === 1);
      if (near) { seenRef.add(r.lv); add('warning', r, `"${r.v}" is not declared. Did you mean "${decls.get(near).name}"?`, 'W-TYPO'); }
    }
    // bare names that are declared nowhere (context objects are allowed)
    const unkSeen = new Set();
    for (const r of refs) {
      if (decls.has(r.lv) || CONSTS.has(r.lv) || catalog.globals.has(r.lv) || seenRef.has(r.lv) || unkSeen.has(r.lv)) continue;
      if (/^[A-Z0-9_]+$/.test(r.v) || r.v[0] === '$' || imports.has(r.lv) || /^(gv_|setting_|dspcurrent)/.test(r.lv)) continue;
      unkSeen.add(r.lv);
      add('info', r, `"${r.v}" is not declared in this macro. Fine if it is a context object (e.g. ForecastItem in a calculated column) or a global variable; otherwise OPAL will report that it cannot be resolved.`, 'I-UNKNOWN');
    }
    // functions
    let askUsed = null, askChecked = /ASK_OK|GetAskResult/i.test(src);
    const unknownSeen = new Set();
    const idxOf = new Map(T.map((t, k) => [t, k]));
    for (const c of calls) {
      const n = c.t.lv;
      const ar = catalog.arity && catalog.arity.get(n);
      const k0 = idxOf.get(c.t);
      if (ar && k0 != null && T[k0 + 1] && T[k0 + 1].v === '(') {
        let d = 0, args = 0, any = false, named = false, k = k0 + 1;
        for (; k < T.length; k++) {
          const x = T[k];
          if (x.v === '(' || x.v === '[' || x.v === '{') { d++; if (d === 1) continue; }
          else if (x.v === ')' || x.v === ']' || x.v === '}') { d--; if (d === 0) break; }
          if (d === 1) { if (x.v === ',') args++; else { any = true; if (x.k === 'id' && T[k + 1] && T[k + 1].v === '=') named = true; } }
        }
        const cnt = any ? args + 1 : 0;
        if (k < T.length && !named) {
          const nm = c.t.v;
          if (cnt < ar.min) add('error', c.t, `${nm} expects at least ${ar.min} argument${ar.min > 1 ? 's' : ''}, but gets ${cnt}.`, 'E-ARGS');
          else if (cnt > ar.max) add('error', c.t, `${nm} expects at most ${ar.max} argument${ar.max > 1 ? 's' : ''}, but gets ${cnt}.`, 'E-ARGS');
        }
      }
      if (/^ask/.test(n)) askUsed = askUsed || c.t;
      if (catalog.deprecated && catalog.deprecated[n]) add('info', c.t, `${c.t.v} is deprecated. ${catalog.deprecated[n]}`, 'I-DEPRECATED');
      if (/^(refreshtodolist|gettodolistconflictdefs)$/.test(n) && !invisGuard[c.t.ln]) add('info', c.t, `${c.t.v} is not available in invisible (batch) mode. If this macro can run in a batch, wrap the call in #If !IsOption("INVISIBLE") … #EndIf.`, 'I-INVISIBLE');
      if (n === 'getbucketseries') add('info', c.t, 'In PLS, GlobalBucketSeries is already available as a global object. You usually do not need GetBucketSeries().', 'I-BUCKET');
      if (catalog.fnSet.has(n) || imports.has(n) || /^locate/.test(n) || /^ask/.test(n) || decls.has(n) || unknownSeen.has(n)) continue;
      unknownSeen.add(n);
      add('info', c.t, `"${c.t.v}" is not in the built-in function list. If it is one of your own functions, make sure it is imported (Import ${c.t.v};).`, 'I-UNKNOWNFN');
    }
    if (askUsed && !askChecked) add('info', askUsed, 'Ask… dialogs can be cancelled. Check GetAskResult() == ASK_OK before using the value.', 'I-ASK');
    // header & return
    const lines = src.split('\n');
    const firstCode = lines.findIndex(l => l.trim() !== '');
    if (lines.length >= 8 && firstCode >= 0 && !lines[firstCode].trim().startsWith('//!')) {
      P.push({ sev: 'info', ln: firstCode, c: 0, len: lines[firstCode].length || 1, msg: 'No //! header block. Adding AUTHOR, DATE, EXPLANATION and CHANGES makes the macro searchable and reviewable.', code: 'I-HEADER' });
    }
    const last = T[T.length - 1];
    const hasReturn = T.some(t => t.k === 'kw' && t.lv === 'return');
    const retSev = hasReturn ? 'warning' : 'error';
    const retCode = hasReturn ? 'W-RETURN' : 'E-RETURN';
    if (last && last.v === ';' && lastStmt && lastStmt.lv !== 'return' && !(lastStmt.k === 'kw' && lastStmt.lv in CLOSERS)) {
      P.push({ sev: retSev, ln: last.ln, c: last.c, len: 1, msg: 'Not all code paths return a value: the macro ends with ";". End with a bare expression on the last line, e.g. Result or 1.', code: retCode });
    } else if (last && last.k === 'kw' && last.lv in CLOSERS) {
      P.push({ sev: retSev, ln: last.ln, c: last.c, len: last.e - last.s, msg: 'Not all code paths return a value: the macro ends with a block. Add a return expression after it, e.g. Result or 1.', code: retCode });
    }

    // the same finding can be reached from two parse paths: keep one
    const seenP = new Set();
    for (let k = P.length - 1; k >= 0; k--) { const key = P[k].code + '|' + P[k].ln + '|' + P[k].c + '|' + P[k].msg; if (seenP.has(key)) P.splice(k, 1); else seenP.add(key); }
    const order = { error: 0, warning: 1, info: 2 };
    P.sort((a, b) => order[a.sev] - order[b.sev] || a.ln - b.ln || a.c - b.c);
    return { problems: P, info, tokens: all };
  }

  function format(src, indentUnit) {
    indentUnit = indentUnit || '   ';
    const { toks } = lex(src);
    const byLine = [];
    for (const t of toks) { if (t.k === 'nl') continue; (byLine[t.ln] = byLine[t.ln] || []).push(t); }
    const lines = src.split('\n');
    let depth = 0, pd = 0, inCond = false, inBlockCmt = false;
    const out = [];
    for (let l = 0; l < lines.length; l++) {
      const raw = lines[l];
      const ts = (byLine[l] || []).filter(t => t.k !== 'cmt' || true);
      const sig = ts.filter(t => t.k !== 'cmt' && t.k !== 'hdr');
      const trimmed = raw.replace(/^[ \t]+/, '');
      const startsInCmt = inBlockCmt;
      // track block comments crossing lines
      for (const t of ts) if (t.k === 'cmt' && t.v.startsWith('/*')) inBlockCmt = !t.v.endsWith('*/') || t.v.length < 4;
        else if (t.k === 'cmt' && inBlockCmt && t.v.endsWith('*/')) inBlockCmt = false;
      if (trimmed === '' ) { out.push(''); continue; }
      if (startsInCmt || trimmed.startsWith('//!') || (ts[0] && ts[0].k === 'dir')) { out.push(raw.replace(/\s+$/, '')); continue; }
      const f = sig[0];
      let d = depth;
      if (f && (f.k === 'kw' || f.lv === 'end') && (f.lv in CLOSERS || ['elif','else','catch'].includes(f.lv) || (f.lv === 'end' && sig[1] && ['if','for','while','catch'].includes(sig[1].lv)))) d = Math.max(0, depth - 1);
      let extra = (pd > 0 || inCond) ? 1 : 0;
      out.push(indentUnit.repeat(Math.max(0, d + extra)) + trimmed.replace(/\s+$/, ''));
      for (let k = 0; k < sig.length; k++) {
        const t = sig[k];
        if (t.k === 'op' && '([{'.includes(t.v)) pd++;
        else if (t.k === 'op' && ')]}'.includes(t.v)) pd = Math.max(0, pd - 1);
        else if (t.k === 'kw' || t.lv === 'end') {
          if (t.lv === 'end' && sig[k + 1] && ['if','for','while','catch'].includes(sig[k + 1].lv)) { depth = Math.max(0, depth - 1); k++; continue; }
          if (t.lv === 'if') { depth++; inCond = true; }
          else if (t.lv === 'elif') inCond = true;
          else if (t.lv === 'then') inCond = false;
          else if (t.lv === 'for' || t.lv === 'while' || t.lv === 'try') depth++;
          else if (t.lv in CLOSERS) depth = Math.max(0, depth - 1);
        }
      }
    }
    return out.join('\n');
  }

  // Parse signatures into {min, max} argument counts.
  function arity(name, sig) {
    if (!sig) return null;
    const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\s*\\(', 'gi');
    let m, min = Infinity, max = -1, found = false;
    const starts = [];
    while ((m = re.exec(sig))) starts.push(m.index + m[0].length);
    for (let k = 0; k < starts.length; k++) {
      const end = k + 1 < starts.length ? starts[k + 1] : sig.length;
      let body = sig.slice(starts[k], end);
      const close = body.indexOf(')');
      const opt = body.indexOf('[');
      if (close < 0 && opt < 0) continue; // truncated
      if (close >= 0 && (opt < 0 || close < opt)) body = body.slice(0, close); else body = body.slice(0, opt);
      const req = body.split(',').map(x => x.trim()).filter(x => x && !/^\.\.\./.test(x));
      const variadic = /\.\.\./.test(sig.slice(starts[k], close >= 0 ? starts[k] + close : end));
      found = true;
      min = Math.min(min, req.length);
      max = Math.max(max, opt >= 0 && (close < 0 || opt < close) || variadic ? Infinity : req.length);
    }
    return found ? { min, max } : null;
  }

  root.OPAL = { lex, check, format, arity, KW, TYPES, CONSTS };
})(typeof window !== 'undefined' ? window : globalThis);
