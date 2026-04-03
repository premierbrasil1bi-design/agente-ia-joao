const PROVIDER_OPTIONS = [
  { value: "evolution", label: "Evolution" },
  { value: "waha", label: "WAHA" },
  { value: "zapi", label: "Z-API" },
] as const;

type ProviderId = (typeof PROVIDER_OPTIONS)[number]["value"];

const PROVIDER_DISPLAY_ORDER: readonly ProviderId[] = PROVIDER_OPTIONS.map((p) => p.value) as ProviderId[];

export type TenantProviderDisplayType = ProviderId | "legacy";

/** Variantes do Badge alinhadas a Evolution (azul), WAHA (roxo), Z-API (verde), legado (neutro). */
export type TenantProviderBadgeVariant = "default" | "info" | "purple" | "success";

export type TenantProviderDisplayItem = {
  label: string;
  type: TenantProviderDisplayType;
  badgeVariant: TenantProviderBadgeVariant;
};

export function sanitizeAllowedProviders(input: unknown): string[] {
  const valid = new Set<string>(PROVIDER_OPTIONS.map((p) => p.value));
  const arr = Array.isArray(input) ? input : [];
  return [...new Set(arr.map((p) => String(p || "").toLowerCase().trim()))].filter((p) => valid.has(p));
}

export function providerLabel(provider: string): string {
  const item = PROVIDER_OPTIONS.find((p) => p.value === provider);
  return item?.label || provider;
}

export function providerOptions() {
  return [...PROVIDER_OPTIONS];
}

function badgeVariantForProvider(id: ProviderId): Exclude<
  TenantProviderBadgeVariant,
  "default"
> {
  if (id === "evolution") return "info";
  if (id === "waha") return "purple";
  return "success";
}

/**
 * Lista para exibição read-only de providers do tenant (listagem, detalhe).
 * Lista vazia ou null na API → um item legado com texto padronizado.
 */
export function getTenantProvidersDisplay(allowedProviders: unknown): TenantProviderDisplayItem[] {
  const sanitized = sanitizeAllowedProviders(allowedProviders);
  if (sanitized.length === 0) {
    return [{ label: "Todos (Legado)", type: "legacy", badgeVariant: "default" }];
  }
  const ordered = PROVIDER_DISPLAY_ORDER.filter((id) => sanitized.includes(id));
  return ordered.map((id) => ({
    label: providerLabel(id),
    type: id,
    badgeVariant: badgeVariantForProvider(id),
  }));
}
