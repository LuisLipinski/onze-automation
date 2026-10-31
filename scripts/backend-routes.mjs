import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function backendRoutes(root) {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  return walk(join(root, 'src/main/java')).filter(p => p.endsWith('Controller.java')).flatMap(path => {
    const source = readFileSync(path, 'utf8');
    const prefix = source.slice(0, source.indexOf('public class')).match(/@RequestMapping\("([^"]+)"\)/)?.[1] ?? '';
    const optional = source.includes('@ConditionalOnProperty');
    return [...source.matchAll(/@(Get|Post|Put|Delete|Patch)Mapping(?:\(([\s\S]*?)\))?/g)].map(m => {
      const suffix = m[2]?.match(/"([^"]+)"/)?.[1] ?? '';
      const route = prefix + suffix;
      const method = m[1].toUpperCase();
      const publicRoute = route.startsWith('/api/auth/') && route !== '/api/auth/me' || route.startsWith('/join/') || route.startsWith('/m/');
      return { id: `${method} ${route}`, method, path: route, controller: path.split('/').at(-1), authentication: !publicRoute, optional };
    });
  }).sort((a, b) => a.id.localeCompare(b.id));
}
