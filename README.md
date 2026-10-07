# OPAL Playground

A browser-based editor for OPAL, the scripting language of the OMP supply-chain planning platform.
Write a macro, see problems as you type, and look up built-in functions without leaving the page.

**Try it:** open `index.html` in any modern browser, or use the hosted version on GitHub Pages.

## What it does

- **Static checker.** Finds mistakes before you paste code into OMP: unclosed blocks, `=` instead of `==`,
  `For i = 1 to N` instead of `For i from 1 to N`, calls without `Call`, missing or extra `;`,
  `Break`/`Continue` without a loop label, duplicate declarations, a macro that ends without a return value,
  wrong argument counts and more. Every rule is listed, with its severity, in the **Rules** tab.
- **Autocomplete and signatures** for built-in functions, keywords and your own variables.
- **Function reference** with typed signatures and short examples, written for this project.
- **Format** (re-indent) and a **header template** button.

Severities follow the real OMP compiler: where a rule is marked as an error, OMP rejects the code too.
Rules that OMP accepts but that are bad practice are warnings or hints.

## Privacy

Everything runs in your browser. The code you type is never uploaded or stored on a server.
Feedback sends only what you see in the feedback form; code is attached only when you tick the box.
Remove client names, IDs and settings before sending code.

## Limits

The checker does not run your code and does not know your data model, so it cannot check
attribute names, object types or results. Always test in OMP.

## Feedback and contributions

- Use the feedback buttons in the tool (wrong result, missed error, function correction, rule idea), or
- open an issue in this repository.

Real examples of mistakes OMP rejects, together with the OMP error message, help most.

## Development

No dependencies are needed to use the page. To change it:

```
python src/build.py     # rebuilds index.html from src/ and data/
node tests/run.js       # regression tests for the checker
```

| Path | Contents |
|---|---|
| `src/checker.js` | lexer and static checker |
| `src/template.html` | page layout, editor, reference and feedback UI |
| `src/build.py` | combines template, checker and data into `index.html` |
| `data/reference.json` | function reference (signatures, descriptions, examples) |
| `data/function-names.json` | further built-in function names, used for autocomplete |
| `data/arity.json` | allowed argument counts per function |
| `tests/run.js` | checker regression tests |

## Disclaimer

Independent project, not affiliated with or endorsed by OM Partners.
OMP and OPAL are names of their respective owner.

## License

MIT, see `LICENSE`.
