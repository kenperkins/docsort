import { describe, it, expect } from 'vitest';
import { renderScale, MAX_LONG_EDGE_PX } from './pdf-render.js';

describe('renderScale', () => {
  it('should keep 2x for a US letter page, which stays under the cap', () => {
    expect(renderScale(612, 792)).toBe(2);
  });

  it('should cap a large-format sheet at the long-edge limit', () => {
    const scale = renderScale(2592, 1728); // 36x24in drawing at 72pt/in
    expect(Math.round(2592 * scale)).toBe(MAX_LONG_EDGE_PX);
  });

  it('should cap landscape and portrait pages the same way', () => {
    expect(renderScale(1728, 2592)).toBe(renderScale(2592, 1728));
  });
});
