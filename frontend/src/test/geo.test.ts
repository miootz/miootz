import { describe, it, expect } from 'vitest';
import { haversineKm } from '../utils/geo';

describe('haversineKm', () => {
  it('is ~0 for identical points', () => {
    expect(haversineKm(-33.86, 151.2, -33.86, 151.2)).toBeLessThan(0.001);
  });

  it('matches known short distance order of magnitude', () => {
    // Roughly 1 km apart in similar latitude
    const km = haversineKm(51.5, -0.1, 51.509, -0.1);
    expect(km).toBeGreaterThan(0.9);
    expect(km).toBeLessThan(1.2);
  });
});
