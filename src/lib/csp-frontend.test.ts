import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx|ts|html)$/.test(name) ? [path] : [];
  });
}

describe('frontend under the CSP', () => {
  it('has no inline <style> elements or inline scripts, which the CSP would block', () => {
    const root = new URL('../../frontend/', import.meta.url).pathname;
    const offenders = [...sourceFiles(join(root, 'src')), join(root, 'index.html')].filter((file) =>
      /<style[\s>]|<script>(?!<\/script>)|dangerouslySetInnerHTML/.test(readFileSync(file, 'utf-8')),
    );
    expect(offenders).toEqual([]);
  });
});
