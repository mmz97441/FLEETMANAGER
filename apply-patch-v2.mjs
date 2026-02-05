#!/usr/bin/env node
/**
 * PATCH v3.7.10 — Fix double-dispatch + grisage colis dispatchés
 * 
 * Usage : node apply-patch-v2.mjs
 * (à lancer depuis la racine du projet FleetGenius)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold('\n🔧 PATCH v3.7.10 v2 — Fix double-dispatch + grisage colis\n'));

let patchCount = 0;
let errorCount = 0;

function patchFile(filePath, patches) {
  const fullPath = resolve(filePath);
  let content;
  
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (e) {
    console.log(red(`  ✗ Fichier non trouvé: ${filePath}`));
    errorCount++;
    return;
  }
  
  console.log(bold(`📄 ${filePath}`));
  
  for (const patch of patches) {
    if (content.includes(patch.find)) {
      content = content.replace(patch.find, patch.replace);
      console.log(green(`  ✓ ${patch.label}`));
      patchCount++;
    } else {
      console.log(yellow(`  ⚠ Non trouvé: ${patch.label}`));
      // Debug: montrer les 50 premiers caractères attendus
      console.log(yellow(`    Attendu: "${patch.find.substring(0, 80)}..."`));
    }
  }
  
  writeFileSync(fullPath, content, 'utf-8');
  console.log('');
}

// =============================================================================
// FIX 1 — DispatchManager.tsx : Anti-double dispatch
// =============================================================================

patchFile('src/components/DispatchManager.tsx', [
  {
    label: 'Filtre pendingPackages anti-double dispatch',
    find: `  // Filtrer les colis au hub (collectés et réceptionnés) — prêts à être dispatchés
  const pendingPackages = useMemo(() => 
    packages.filter(p => p.status === PackageStatus.AT_HUB || p.status === PackageStatus.SORTED),
    [packages]
  );`,
    replace: `  // Filtrer les colis au hub — prêts à être dispatchés
  // FIX v3.7.10: Exclure les colis déjà assignés à une mission (anti-double dispatch)
  const pendingPackages = useMemo(() => 
    packages.filter(p => 
      (p.status === PackageStatus.AT_HUB || p.status === PackageStatus.SORTED) && 
      !p.missionId && 
      !p.currentDriverId
    ),
    [packages]
  );`
  }
]);

// =============================================================================
// FIX 2 — MissionManager.tsx : Grisage colis dispatchés
// =============================================================================

patchFile('src/components/MissionManager.tsx', [
  // 2a. Ajouter isDispatched + modifier le className du <tr>
  {
    label: 'Détection isDispatched + grisage ligne',
    find: `                  .map(pkg => {
                    const zoneColors = ZONE_COLORS[pkg.zone];
                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status];
                    const isSelected = selectedPackageIds.has(pkg.id);
                    
                    return (
                      <tr
                        key={pkg.id}
                        className=\`hover:bg-slate-50 transition-colors \${isSelected ? 'bg-brand-50' : ''}\`}`,
    replace: `                  .map(pkg => {
                    const zoneColors = ZONE_COLORS[pkg.zone];
                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status];
                    const isSelected = selectedPackageIds.has(pkg.id);
                    // FIX v3.7.10: Détecter les colis dispatchés (en mission)
                    const isDispatched = !!pkg.missionId && [
                      PackageStatus.SORTED, 
                      PackageStatus.LOADED, 
                      PackageStatus.IN_DELIVERY
                    ].includes(pkg.status);
                    
                    return (
                      <tr
                        key={pkg.id}
                        className=\`transition-colors \${
                          isDispatched 
                            ? 'opacity-50 bg-slate-50 cursor-default' 
                            : \`hover:bg-slate-50 \${isSelected ? 'bg-brand-50' : ''}\`
                        }\`}`
  },
  // 2b. Badge "En mission" dans colonne statut
  {
    label: 'Badge "En mission" colonne statut',
    find: `                        {/* Statut */}
                        <td className="px-3 py-2 text-center">
                          <span className=\`px-2 py-1 rounded-lg text-xs font-medium \${statusColors.bg} \${statusColors.text}\`}>
                            {pkg.status}
                          </span>
                        </td>
                        {/* Actions statut */}`,
    replace: `                        {/* Statut */}
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            <span className=\`px-2 py-1 rounded-lg text-xs font-medium \${statusColors.bg} \${statusColors.text}\`}>
                              {pkg.status}
                            </span>
                            {isDispatched && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-500" title={\`Mission: \${pkg.missionId}\`}>
                                🚛 En mission
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Actions statut */}`
  }
]);

// =============================================================================
// RÉSUMÉ
// =============================================================================

console.log(bold('─'.repeat(50)));
if (patchCount >= 3) {
  console.log(green(bold(`\n✅ ${patchCount} corrections appliquées avec succès !\n`)));
} else if (patchCount > 0) {
  console.log(yellow(`\n⚠ ${patchCount}/3 corrections appliquées. Vérifie les warnings ci-dessus.\n`));
} else {
  console.log(red(`\n✗ Aucune correction appliquée. Les fichiers ont peut-être changé.\n`));
}

console.log('Prochaines étapes :');
console.log('  1. git diff  — vérifier les changements');
console.log('  2. npm run dev  — tester localement');
console.log('  3. git add -A && git commit -m "fix: anti-double dispatch + grisage colis v3.7.10"');
console.log('  4. git push  — Vercel déploie automatiquement');
console.log('');
