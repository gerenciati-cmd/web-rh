/**
 * Hooks de resolución de pnpm. Mantener MÍNIMO y documentar cada regla.
 */
module.exports = {
  hooks: {
    readPackage(pkg) {
      // @prisma/client declara el CLI `prisma` y `typescript` como peers opcionales. Como `prisma` es devDependency
      // de apps/api, pnpm lo ata como peer y `pnpm deploy --prod` lo mete en la imagen de
      // producción (+ Prisma Studio, React, TypeScript: >200 MB). El runtime no lo necesita.
      if (pkg.name === '@prisma/client') {
        for (const peer of ['prisma', 'typescript']) {
          delete pkg.peerDependencies?.[peer];
          delete pkg.peerDependenciesMeta?.[peer];
        }
      }
      return pkg;
    },
  },
};
