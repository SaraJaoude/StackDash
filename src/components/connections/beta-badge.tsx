/**
 * Marks a provider whose adapter declares it is in beta (`ProviderAdapter.beta`, #242). Words, not
 * color alone, like `SimulatedBadge`. No `title`: the caller shows the adapter's reason as visible
 * text beside the badge and ties it to the connect link with `aria-describedby`, so keyboard and
 * screen reader users get the reason too, not only people who can hover.
 */
export function BetaBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-line-strong px-2 py-0.5 text-xs font-medium text-foreground">
      Beta
    </span>
  );
}
