/** The import API returns IDs in file order, which can interleave several zones. */
export function indexImportedPackageIds(packages: ReadonlyArray<{ zone: string }>, ids: readonly string[]): Map<string, string[]> {
  if (packages.length !== ids.length || ids.some(id => !id)) throw new Error('Résultat d’import incomplet : vérifiez les colis avant de reprendre.');
  const result = new Map<string, string[]>();
  packages.forEach((pkg, index) => {
    const group = result.get(pkg.zone) || [];
    group.push(ids[index]);
    result.set(pkg.zone, group);
  });
  return result;
}
