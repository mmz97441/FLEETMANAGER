#!/usr/bin/env node
/**
 * PATCH v3.7.10 — Fix double-dispatch + grisage colis dispatchés
 * 
 * Usage : node apply-patch-dispatch.mjs
 * (à lancer depuis la racine du projet FleetGenius)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold('\n🔧 PATCH v3.7.10 — Fix double-dispatch + grisage colis\n'));

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
      console.log(yellow(`    → Vérifie si ce patch a déjà été appliqué`));
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
    packages.filter(p => p.status === PackageStatus.AT_HUB),
    [packages]
  );`,
    replace: `  // Filtrer les colis au hub — prêts à être dispatchés
  // FIX v3.7.10: Exclure les colis déjà assignés à une mission (anti-double dispatch)
  const pendingPackages = useMemo(() => 
    packages.filter(p => 
      p.status === PackageStatus.AT_HUB && 
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
  // 2a. Détection isDispatched + grisage <tr>
  {
    label: 'Détection isDispatched + grisage ligne',
    find: `                .map(pkg => {
                    const zoneColors = ZONE_COLORS[pkg.zone];
                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status];
                    
                    return (
                      <tr
                        key={pkg.id}
                        className={\`hover:bg-slate-50 transition-colors \${pkg.pod ? 'cursor-pointer' : ''}\`}`,
    replace: `                .map(pkg => {
                    const zoneColors = ZONE_COLORS[pkg.zone];
                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status];
                    // FIX v3.7.10: Détecter les colis dispatchés (en mission)
                    const isDispatched = !!pkg.missionId && [
                      PackageStatus.SORTED, 
                      PackageStatus.LOADED, 
                      PackageStatus.IN_DELIVERY
                    ].includes(pkg.status);
                    
                    return (
                      <tr
                        key={pkg.id}
                        className={\`transition-colors \${
                          isDispatched 
                            ? 'opacity-50 bg-slate-50 cursor-default' 
                            : \`hover:bg-slate-50 \${pkg.pod ? 'cursor-pointer' : ''}\`
                        }\`}`
  },
  // 2b. Badge "En mission" dans colonne statut
  {
    label: 'Badge "En mission" colonne statut',
    find: `                        <td className="px-4 py-3">
                          <span className={\`px-2 py-1 rounded-lg text-xs font-medium \${statusColors.bg} \${statusColors.text}\`}>
                            {pkg.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">`,
    replace: `                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={\`px-2 py-1 rounded-lg text-xs font-medium \${statusColors.bg} \${statusColors.text}\`}>
                              {pkg.status}
                            </span>
                            {isDispatched && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-500" title={\`Mission: \${pkg.missionId}\`}>
                                🚛 En mission
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">`
  }
]);

// =============================================================================
// FIX 3 — HubOperations.tsx : Protection réception + filtre chargement
// =============================================================================

patchFile('src/components/HubOperations.tsx', [
  // 3a. Warning si colis déjà en mission lors du scan
  {
    label: 'Warning scan réception si colis déjà en mission',
    find: `    if (pkg.status !== PackageStatus.COLLECTED && pkg.status !== PackageStatus.PENDING) {
      showNotif('warning', \`\${barcode} — statut \${pkg.status}, réception non applicable\`);
      return;
    }

    try {`,
    replace: `    if (pkg.status !== PackageStatus.COLLECTED && pkg.status !== PackageStatus.PENDING) {
      showNotif('warning', \`\${barcode} — statut \${pkg.status}, réception non applicable\`);
      return;
    }

    // FIX v3.7.10: Avertir si le colis est déjà assigné à une mission
    if (pkg.missionId) {
      showNotif('warning', \`⚠️ \${barcode} — déjà assigné à une mission\`);
    }

    try {`
  },
  // 3b. Filtre driversWithPackages renforcé
  {
    label: 'Filtre driversWithPackages + missionId',
    find: `        .filter(p => p.status === PackageStatus.SORTED && p.currentDriverId)`,
    replace: `        // FIX v3.7.10: Vérifier aussi missionId pour éviter les orphelins
        .filter(p => p.status === PackageStatus.SORTED && p.currentDriverId && p.missionId)`
  }
]);

// =============================================================================
// RÉSUMÉ
// =============================================================================

console.log(bold('─'.repeat(50)));
if (errorCount === 0) {
  console.log(green(bold(`\n✅ ${patchCount} corrections appliquées avec succès !\n`)));
} else {
  console.log(yellow(`\n⚠ ${patchCount} corrections appliquées, ${errorCount} erreur(s)\n`));
}

console.log('Prochaines étapes :');
console.log('  1. Vérifier les fichiers modifiés (git diff)');
console.log('  2. Tester le dispatch + vérifier le grisage');
console.log('  3. Commit + déployer sur Vercel');
console.log('');
