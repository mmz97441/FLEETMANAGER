import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Explicit scope and reasoned exceptions prevent a shared stylesheet from
// being mistaken for proof that every screen has adopted the same contracts.
const scope = JSON.parse(readFileSync(new URL('../docs/UI18_SCOPE.json', import.meta.url), 'utf8'));
const findings = [], inventory = [];
for (const file of scope.files) {
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const count = { file, commands: 0, sharedCommands: 0, tables: 0, dialogs: 0 };
  const report = (rule, node, detail) => {
    const context = node.parent.getText(ast);
    if (scope.exceptions.some(e => e.file === file && e.rule === rule && context.includes(e.contains))) return;
    findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, rule, detail });
  };
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(ast), a.initializer?.getText(ast) || 'true']));
      const classes = attrs.className || '';
      if (tag === 'button' || tag === 'Button') {
        count.commands++;
        if (tag === 'Button' || /ui-(button|filter)/.test(classes)) count.sharedCommands++;
      }
      if (tag === 'table' || tag === 'DataTable') count.tables++;
      if (tag === 'Modal' || tag === 'ConfirmModal') count.dialogs++;
      if (/\btext-(?:xs|\[(?:10|11|12)px\])/.test(classes)) report('small-text', node, 'Information visible sous 14 px : migrer ou justifier une métadonnée secondaire dans le périmètre.');
      if (['div', 'span', 'article'].includes(tag) && attrs.onClick && !attrs.onClick.includes('stopPropagation') && attrs['aria-hidden'] !== '"true"') {
        if (!attrs.role || !attrs.tabIndex || !(attrs.onKeyDown || attrs.onKeyUp)) report('keyboard-command', node, 'Commande non native sans rôle, tabulation et clavier : préférer un bouton.');
      }
      if (tag === 'button' && /bg-gradient/.test(classes)) report('gradient-command', node, 'Commande à dégradé indépendante du contrat partagé.');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  inventory.push(count);
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ inventory, findings }, null, 2));
else {
  console.log(`${inventory.length} fichiers inventoriés · ${inventory.reduce((n, f) => n + f.commands, 0)} commandes · ${inventory.reduce((n, f) => n + f.tables, 0)} tableaux · ${inventory.reduce((n, f) => n + f.dialogs, 0)} fenêtres`);
  for (const f of findings) console.error(`${f.file}:${f.line} [${f.rule}] ${f.detail}`);
  console.log(`${findings.length} écart(s) aux règles statiques. Les parcours et le rendu sont vérifiés séparément au navigateur.`);
}
if (findings.length) process.exitCode = 1;
