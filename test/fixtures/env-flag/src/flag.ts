export function checkoutEnabled(): boolean {
  const dotted = process.env.ENABLE_NEW_CHECKOUT;
  const bracketed = process.env['ENABLE_NEW_CHECKOUT'];
  return Boolean(dotted || bracketed);
}
