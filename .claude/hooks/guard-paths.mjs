/** Clasifica rutas sin leer contenido: una guarda nunca abre el secreto que intenta proteger. */
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

function resolveExistingParent(abs) {
  try {
    lstatSync(abs);
    return realpathSync(abs);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(abs);
    if (parent === abs) throw error;
    return path.join(resolveExistingParent(parent), path.basename(abs));
  }
}

export function inspectPath(file, { projectDir, cwd = projectDir, write = false }) {
  if (typeof file !== 'string' || !file || file.includes('\0')) return 'Ruta ausente o inválida';
  const abs = path.resolve(cwd, file);
  let resolved;
  try {
    resolved = resolveExistingParent(abs);
  } catch {
    return 'No se pudo resolver la ruta de forma segura';
  }
  let realRoot;
  try {
    realRoot = realpathSync(projectDir);
  } catch {
    return 'No se pudo resolver el proyecto';
  }
  for (const candidate of [abs, resolved]) {
    const segments = candidate.split(path.sep);
    if (
      segments.some(
        (part) => (part === '.env' || part.startsWith('.env.')) && part !== '.env.example',
      ) ||
      /\.(pem|key)$/i.test(candidate)
    )
      return 'Contenido secreto protegido';
    if (!write) continue;
    const root = candidate === resolved ? realRoot : projectDir;
    const rel = path.relative(root, candidate).split(path.sep).join('/');
    if (segments.includes('.git')) return 'Internos de Git protegidos';
    if (rel === 'pnpm-lock.yaml') return 'El lockfile lo mantiene pnpm';
    if (/(^|\/)generated(\/|$)/.test(rel) || /(^|\/)(next-env|expo-env)\.d\.ts$/.test(rel))
      return 'Código generado protegido';
    if (/^apps\/mobile\/(ios|android)(\/|$)/.test(rel)) return 'Carpetas nativas generadas';
    if (
      /^\.(claude|codex)\/agents\//.test(rel) ||
      /^\.(claude|agents)\/skills\/(planear|implementar|escribir-tests|revisar|verificar|fix)\/SKILL\.md$/.test(
        rel,
      )
    )
      return 'Adaptador generado: usa pnpm harness:sync';
    if (/prisma\/migrations\/.+\/migration\.sql$/.test(rel)) {
      try {
        lstatSync(candidate);
        return 'Migración existente: crea una nueva';
      } catch (error) {
        if (error.code !== 'ENOENT') return 'No se pudo verificar la migración';
      }
    }
  }
  return null;
}
