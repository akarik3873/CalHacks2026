// Last checks before a cart is shown or filled. These run even though the planner already follows the same rules.
import { CATALOG, fmt, Kit, matches } from "./catalog";
import { Cart, cartTotalCents } from "./planner";

export class GuardrailError extends Error {}

// No prescription items, only pre-approved products, and never over the budget cap.
export function checkCart(cart: Cart, kit: Kit) {
  const rules = Object.fromEntries(kit.items.map((i) => [i.key, i.match]));
  for (const line of cart.lines) {
    const product = CATALOG[line.sku];
    if (!product) throw new GuardrailError(`Unknown product ${line.sku}`);
    if (product.rx) throw new GuardrailError(`${product.name} is prescription-only`);
    if (!rules[line.itemKey] || !matches(product, rules[line.itemKey])) {
      throw new GuardrailError(`${product.name} is not the product approved for ${line.itemLabel}`);
    }
  }
  if (cart.budgetCapCents > kit.budgetCapCents) {
    throw new GuardrailError(`Budget ${fmt(cart.budgetCapCents)} is above the profile cap ${fmt(kit.budgetCapCents)}`);
  }
  const total = cartTotalCents(cart);
  if (total > cart.budgetCapCents) throw new GuardrailError(`Total ${fmt(total)} is over the ${fmt(cart.budgetCapCents)} budget`);
}
