// Smoke test so `npm test` has something to run and the jest +
// ts-jest toolchain is actually exercised in CI. Replace with real
// tests as coverage expands.
describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
