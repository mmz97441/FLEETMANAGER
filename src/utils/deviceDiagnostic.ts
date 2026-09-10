export type DiagnosticOutcome = 'non_testé' | 'réussi_sans_aide' | 'réussi_avec_aide' | 'échec';
export const fieldScenarios = [
  ['scan', 'Lire l’étiquette fictive avec la caméra'],
  ['partial', 'Livraison partielle avec preuve'],
  ['offline', 'Enregistrer une preuve sans réseau puis la synchroniser'],
  ['return', 'Confirmer un retour au hub'],
  ['resume', 'Reprendre après verrouillage du téléphone'],
  ['keyboard', 'Saisir avec le clavier ouvert'],
  ['outdoors', 'Lire et agir en extérieur'],
  ['print', 'Imprimer et relire l’étiquette fictive'],
] as const;
export interface FieldResult { scenario: string; outcome: DiagnosticOutcome; seconds: number | null; errors: number | null }
export const initialFieldResults = (): FieldResult[] => fieldScenarios.map(([scenario]) => ({ scenario, outcome: 'non_testé', seconds: null, errors: null }));

export function buildDeviceDiagnosticReport(device: string, role: string, capabilities: Record<string, string>, results: FieldResult[]) {
  return {
    schemaVersion: 1,
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'inconnue',
    exportedAt: new Date().toISOString(),
    device: device.trim(),
    role: ['chauffeur', 'exploitation', 'client'].includes(role) ? role : 'non_précisé',
    capabilities,
    scenarios: results,
    interpretation: 'Les vérifications techniques ne valident pas les gestes métier. Les résultats de scénario sont déclarés par la personne réalisant la séance. Aucune donnée n’est envoyée automatiquement.',
  };
}

export function downloadDiagnosticJson(report: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `diagnostic-terrain-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
