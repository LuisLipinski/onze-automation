import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function backendRoutes(root) {
  const security = readFileSync(join(root, 'src/main/java/com/onze/api/config/SecurityConfig.java'), 'utf8');
  const publicPatterns = [...security.matchAll(/\.requestMatchers\(([\s\S]*?)\)\s*\.permitAll\(\)/g)]
    .flatMap(match => [...match[1].matchAll(/"([^"]+)"/g)].map(value => value[1]));
  if (!publicPatterns.length) throw new Error('No explicit public request matchers found in SecurityConfig');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  return walk(join(root, 'src/main/java')).filter(p => p.endsWith('Controller.java')).flatMap(path => {
    const source = readFileSync(path, 'utf8');
    const prefix = source.slice(0, source.indexOf('public class')).match(/@RequestMapping\("([^"]+)"\)/)?.[1] ?? '';
    const optional = source.includes('@ConditionalOnProperty');
    return [...source.matchAll(/@(Get|Post|Put|Delete|Patch)Mapping(?:\(([\s\S]*?)\))?/g)].map(m => {
      const suffix = m[2]?.match(/"([^"]+)"/)?.[1] ?? '';
      const route = prefix + suffix;
      const method = m[1].toUpperCase();
      const publicRoute = publicPatterns.some(pattern => pattern.endsWith('/**')
        ? route === pattern.slice(0, -3) || route.startsWith(pattern.slice(0, -2))
        : route === pattern);
      return { id: `${method} ${route}`, method, path: route, controller: path.split('/').at(-1), authentication: !publicRoute, optional };
    });
  }).sort((a, b) => a.id.localeCompare(b.id));
}
