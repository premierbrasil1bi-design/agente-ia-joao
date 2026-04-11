import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, Badge, Button, Tabs, Skeleton, Modal } from "../components/ui";
import {
  adminApi,
  type Tenant,
  type TenantAgent,
  type TenantChannel,
  type TenantUser,
  type TenantUsage,
  type TenantLogRow,
  type TenantBilling,
  type TenantFeatureFlagsMap,
  type TenantFeatureFlagAuditItem,
  type FeatureTemplateItem,
} from "../api/admin";
import styles from "./TenantDetailPage.module.css";
import { getTenantProvidersDisplay, providerOptions, sanitizeAllowedProviders } from "../utils/tenantProviders";

const DEFAULT_PLAN_FEATURES: TenantFeatureFlagsMap = {
  realtimeMonitoring: false,
  autoHealing: false,
  providerFallback: false,
  advancedArtifacts: false,
  extendedMonitoringHistory: false,
};

const TENANT_FEATURE_KEYS = [
  "realtimeMonitoring",
  "autoHealing",
  "providerFallback",
  "advancedArtifacts",
  "extendedMonitoringHistory",
] as const;

const TENANT_FEATURE_LABELS: Record<(typeof TENANT_FEATURE_KEYS)[number], string> = {
  realtimeMonitoring: "Monitoramento em tempo real",
  autoHealing: "Auto-healing de canais",
  providerFallback: "Fallback entre providers",
  advancedArtifacts: "Artefatos avançados",
  extendedMonitoringHistory: "Histórico estendido de monitoramento",
};

const TEMPLATE_DISPLAY_LABELS: Record<string, string> = {
  enterprise_safe: "Enterprise (seguro)",
  pilot_restricted: "Piloto restrito",
};

function boolFromJson(v: unknown): boolean {
  return v === true;
}

function savedOverrideLabel(t: Tenant | null, key: (typeof TENANT_FEATURE_KEYS)[number]): string {
  const f = t?.feature_flags as Record<string, unknown> | undefined;
  if (!f || !(key in f) || typeof f[key] !== "boolean") return "sem override";
  return f[key] ? "true" : "false";
}

function summarizeEffectiveFlagChange(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  for (const key of TENANT_FEATURE_KEYS) {
    const a = boolFromJson(prev[key]);
    const b = boolFromJson(next[key]);
    if (a !== b) {
      lines.push(`${TENANT_FEATURE_LABELS[key]}: ${a} -> ${b}`);
    }
  }
  return lines;
}

/** Overrides persistidos que serão restaurados (previous_flags da auditoria). */
function summarizeStoredOverridesLines(flags: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const key of TENANT_FEATURE_KEYS) {
    if (key in flags && typeof flags[key] === "boolean") {
      lines.push(`${TENANT_FEATURE_LABELS[key]}: ${flags[key] ? "true" : "false"}`);
    }
  }
  if (lines.length === 0) return ["(nenhum override salvo — seguirá apenas o plano para as flags conhecidas)"];
  return lines;
}

/** Alinhado a validateTenantFeatureFlags: só chaves conhecidas com boolean. */
function validatedSparseFromRow(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const key of TENANT_FEATURE_KEYS) {
    if (typeof o[key] === "boolean") out[key] = o[key];
  }
  return out;
}

function sparseMapsEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  for (const key of TENANT_FEATURE_KEYS) {
    const hasA = Object.prototype.hasOwnProperty.call(a, key);
    const hasB = Object.prototype.hasOwnProperty.call(b, key);
    if (hasA !== hasB) return false;
    if (hasA && a[key] !== b[key]) return false;
  }
  return true;
}

/** Efetivo atual vs efetivo após aplicar previous_flags da auditoria (effective_previous). */
function normalizeSparseOverridesLocal(
  sparse: Record<string, boolean>,
  planBase: TenantFeatureFlagsMap
): Record<string, boolean> {
  const out: Record<string, boolean> = { ...sparse };
  for (const key of TENANT_FEATURE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(out, key) && out[key] === planBase[key]) {
      delete out[key];
    }
  }
  return out;
}

function effectiveAfterSparse(sparse: Record<string, boolean>, planBase: TenantFeatureFlagsMap): TenantFeatureFlagsMap {
  const out: TenantFeatureFlagsMap = { ...planBase };
  for (const key of TENANT_FEATURE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(sparse, key)) out[key] = sparse[key];
  }
  return out;
}

function summarizeRevertEffectivePreview(
  currentEffective: TenantFeatureFlagsMap | undefined,
  targetEffectivePrevious: Record<string, unknown>
): string[] {
  if (!currentEffective) return [];
  const lines: string[] = [];
  for (const key of TENANT_FEATURE_KEYS) {
    const cur = Boolean(currentEffective[key]);
    const tgt = boolFromJson(targetEffectivePrevious[key]);
    if (cur !== tgt) {
      lines.push(`${TENANT_FEATURE_LABELS[key]}: ${cur} → ${tgt}`);
    }
  }
  return lines;
}

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "agents", label: "Agentes" },
  { id: "channels", label: "Canais" },
  { id: "users", label: "Usuários" },
  { id: "usage", label: "Uso" },
  { id: "logs", label: "Logs" },
  { id: "billing", label: "Billing" },
];

export default function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tab, setTab] = useState("overview");

  const [agents, setAgents] = useState<TenantAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [channels, setChannels] = useState<TenantChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [logs, setLogs] = useState<TenantLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [billing, setBilling] = useState<TenantBilling | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [featureDraft, setFeatureDraft] = useState<TenantFeatureFlagsMap>({ ...DEFAULT_PLAN_FEATURES });
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [featuresError, setFeaturesError] = useState("");
  const [featureHistory, setFeatureHistory] = useState<TenantFeatureFlagAuditItem[]>([]);
  const [featureHistoryLoading, setFeatureHistoryLoading] = useState(false);
  const [revertTarget, setRevertTarget] = useState<TenantFeatureFlagAuditItem | null>(null);
  const [revertLoading, setRevertLoading] = useState(false);
  const [revertError, setRevertError] = useState("");
  const [revertToast, setRevertToast] = useState<string | null>(null);
  const [featureTemplates, setFeatureTemplates] = useState<FeatureTemplateItem[]>([]);
  const [featureTemplatesLoading, setFeatureTemplatesLoading] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [editForm, setEditForm] = useState({
    nome_empresa: "",
    slug: "",
    plan: "free",
    status: "ativo",
    max_agents: 0,
    max_messages: 0,
    allowed_providers: [] as string[],
  });

  useEffect(() => {
    if (!tenantId) return;
    adminApi.getTenant(tenantId).then((data) => {
      setTenant(data);
      if (data) {
        setEditForm({
          nome_empresa: data.nome_empresa || "",
          slug: data.slug || "",
          plan: data.plan || "free",
          status: data.status || "ativo",
          max_agents: Number(data.max_agents ?? 0),
          max_messages: Number(data.max_messages ?? 0),
          allowed_providers: sanitizeAllowedProviders(data.allowed_providers),
        });
      }
    });
  }, [tenantId]);

  useEffect(() => {
    if (!tenant) return;
    const eff = tenant.effective_feature_flags;
    if (eff) {
      setFeatureDraft({ ...eff });
      return;
    }
    setFeatureDraft({ ...DEFAULT_PLAN_FEATURES });
  }, [tenant]);

  const refreshFeatureHistory = useCallback(async () => {
    if (!tenantId) return;
    setFeatureHistoryLoading(true);
    try {
      const data = await adminApi.getTenantFeatureFlagHistory(tenantId, 20);
      setFeatureHistory(data.items);
    } catch {
      setFeatureHistory([]);
    } finally {
      setFeatureHistoryLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || tab !== "overview") return;
    void refreshFeatureHistory();
  }, [tenantId, tab, refreshFeatureHistory]);

  useEffect(() => {
    if (!revertToast) return;
    const t = window.setTimeout(() => setRevertToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [revertToast]);

  useEffect(() => {
    if (!tenantId || tab !== "overview") return;
    let cancelled = false;
    setFeatureTemplatesLoading(true);
    adminApi
      .getFeatureTemplates()
      .then((data) => {
        if (!cancelled) setFeatureTemplates(data.items || []);
      })
      .catch(() => {
        if (!cancelled) setFeatureTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setFeatureTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, tab]);

  const templatePreviewLines = useMemo(() => {
    if (!selectedTemplateKey || !tenant) return [];
    const tpl = featureTemplates.find((t) => t.key === selectedTemplateKey);
    if (!tpl) return [];
    const planBase = tenant.plan_feature_defaults ?? DEFAULT_PLAN_FEATURES;
    const sparse = normalizeSparseOverridesLocal(validatedSparseFromRow(tpl.flags), planBase);
    const nextEff = effectiveAfterSparse(sparse, planBase);
    const currentEff = tenant.effective_feature_flags ?? DEFAULT_PLAN_FEATURES;
    const lines: string[] = [];
    for (const key of TENANT_FEATURE_KEYS) {
      const a = Boolean(currentEff[key]);
      const b = Boolean(nextEff[key]);
      if (a !== b) lines.push(`${TENANT_FEATURE_LABELS[key]}: ${a} → ${b}`);
    }
    return lines;
  }, [selectedTemplateKey, tenant, featureTemplates]);

  function toggleProvider(provider: string) {
    setEditForm((prev) => {
      const current = new Set(prev.allowed_providers || []);
      if (current.has(provider)) current.delete(provider);
      else current.add(provider);
      return { ...prev, allowed_providers: [...current] };
    });
  }

  async function handleSaveTenant() {
    if (!tenantId) return;
    setSavingTenant(true);
    setSaveError("");
    try {
      const updated = await adminApi.updateTenant(tenantId, {
        name: editForm.nome_empresa,
        slug: editForm.slug,
        plan: editForm.plan,
        status: editForm.status,
        max_agents: Number(editForm.max_agents || 0),
        max_messages: Number(editForm.max_messages || 0),
        allowed_providers: sanitizeAllowedProviders(editForm.allowed_providers),
      });
      setTenant(updated);
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err?.message || "Erro ao salvar tenant.");
    } finally {
      setSavingTenant(false);
    }
  }

  async function handleSaveFeatures() {
    if (!tenantId || !tenant) return;
    setFeaturesSaving(true);
    setFeaturesError("");
    try {
      const planBase = tenant.plan_feature_defaults ?? DEFAULT_PLAN_FEATURES;
      const sparse: Record<string, boolean> = {};
      for (const key of TENANT_FEATURE_KEYS) {
        if (featureDraft[key] !== planBase[key]) sparse[key] = featureDraft[key];
      }
      const res = await adminApi.patchTenantFeatures(tenantId, sparse);
      setTenant((prev) =>
        prev
          ? {
              ...prev,
              feature_flags: res.feature_flags as Tenant["feature_flags"],
              effective_feature_flags: res.effective_feature_flags,
            }
          : null
      );
      setFeatureDraft({ ...res.effective_feature_flags });
      await refreshFeatureHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar features.";
      setFeaturesError(msg);
    } finally {
      setFeaturesSaving(false);
    }
  }

  async function handleResetFeaturesToPlan() {
    if (!tenantId || !tenant) return;
    setFeaturesSaving(true);
    setFeaturesError("");
    try {
      const res = await adminApi.patchTenantFeatures(tenantId, {});
      setTenant((prev) =>
        prev
          ? {
              ...prev,
              feature_flags: res.feature_flags as Tenant["feature_flags"],
              effective_feature_flags: res.effective_feature_flags,
            }
          : null
      );
      setFeatureDraft({ ...res.effective_feature_flags });
      await refreshFeatureHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao restaurar padrão do plano.";
      setFeaturesError(msg);
    } finally {
      setFeaturesSaving(false);
    }
  }

  async function handleApplyFeatureTemplate() {
    if (!tenantId || !tenant || !selectedTemplateKey) return;
    const tpl = featureTemplates.find((t) => t.key === selectedTemplateKey);
    if (!tpl) return;
    const planBase = tenant.plan_feature_defaults ?? DEFAULT_PLAN_FEATURES;
    const sparse = normalizeSparseOverridesLocal(validatedSparseFromRow(tpl.flags), planBase);
    const nextEff = effectiveAfterSparse(sparse, planBase);
    const currentEff = tenant.effective_feature_flags ?? featureDraft;
    const changeLines: string[] = [];
    for (const key of TENANT_FEATURE_KEYS) {
      const a = Boolean(currentEff[key]);
      const b = Boolean(nextEff[key]);
      if (a !== b) changeLines.push(`${TENANT_FEATURE_LABELS[key]}: ${a} → ${b}`);
    }
    const intro =
      changeLines.length > 0
        ? changeLines.join("\n")
        : "Nenhuma mudança efetiva será aplicada (apenas normalização de overrides em relação ao plano).";
    const label = TEMPLATE_DISPLAY_LABELS[selectedTemplateKey] || selectedTemplateKey;
    if (!window.confirm(`Aplicar template "${label}"?\n\n${intro}`)) return;
    setFeaturesSaving(true);
    setFeaturesError("");
    try {
      await adminApi.applyFeatureTemplate(tenantId, selectedTemplateKey);
      const fresh = await adminApi.getTenant(tenantId);
      setTenant(fresh);
      if (fresh?.effective_feature_flags) setFeatureDraft({ ...fresh.effective_feature_flags });
      await refreshFeatureHistory();
    } catch (err: unknown) {
      setFeaturesError(err instanceof Error ? err.message : "Erro ao aplicar template.");
    } finally {
      setFeaturesSaving(false);
    }
  }

  async function handleConfirmRevert() {
    if (!tenantId || !revertTarget) return;
    setRevertLoading(true);
    setRevertError("");
    try {
      const res = await adminApi.revertTenantFeatures(tenantId, revertTarget.id);
      if (res.noop) {
        setRevertToast("Este estado já está aplicado");
        setRevertTarget(null);
        return;
      }
      const fresh = await adminApi.getTenant(tenantId);
      setTenant(fresh);
      if (fresh?.effective_feature_flags) setFeatureDraft({ ...fresh.effective_feature_flags });
      await refreshFeatureHistory();
      setRevertTarget(null);
    } catch (err: unknown) {
      setRevertError(err instanceof Error ? err.message : "Erro ao reverter.");
    } finally {
      setRevertLoading(false);
    }
  }

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "agents") {
      setAgentsLoading(true);
      adminApi
        .getTenantAgents(tenantId)
        .then(setAgents)
        .catch(() => setAgents([]))
        .finally(() => setAgentsLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "channels") {
      setChannelsLoading(true);
      adminApi
        .getTenantChannels(tenantId)
        .then(setChannels)
        .catch(() => setChannels([]))
        .finally(() => setChannelsLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "users") {
      setUsersLoading(true);
      adminApi
        .getTenantUsers(tenantId)
        .then(setUsers)
        .catch(() => setUsers([]))
        .finally(() => setUsersLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "usage") {
      setUsageLoading(true);
      adminApi
        .getTenantUsage(tenantId)
        .then(setUsage)
        .catch(() => setUsage(null))
        .finally(() => setUsageLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "logs") {
      setLogsLoading(true);
      adminApi
        .getTenantLogs(tenantId)
        .then(setLogs)
        .catch(() => setLogs([]))
        .finally(() => setLogsLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "billing") {
      setBillingLoading(true);
      adminApi
        .getTenantBilling(tenantId)
        .then(setBilling)
        .catch(() => setBilling(null))
        .finally(() => setBillingLoading(false));
    }
  }, [tenantId, tab]);

  if (!tenant && tenantId) {
    return (
      <div className={styles.page}>
        <Skeleton height={48} width={300} />
        <Skeleton height={200} width="100%" style={{ marginTop: 24 }} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className={styles.page}>
        <p>Tenant não encontrado.</p>
        <Link to="/tenants">Voltar para Tenants</Link>
      </div>
    );
  }

  const planBaseForFeatures = tenant.plan_feature_defaults ?? DEFAULT_PLAN_FEATURES;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{tenant.nome_empresa}</h1>
          <p className={styles.subtitle}>
            {tenant.slug} · <Badge variant={tenant.status === "ativo" ? "success" : "default"}>{tenant.status}</Badge>
          </p>
        </div>
        <div className={styles.actions}>
          <Link to={`/tenants/${tenantId}/users`}>
            <Button variant="secondary">Usuários do tenant</Button>
          </Link>
          <Button variant="secondary" onClick={() => setIsEditing((v) => !v)}>
            {isEditing ? "Cancelar edição" : "Editar"}
          </Button>
          {tenant.status === "ativo" ? (
            <Button variant="danger">Suspender</Button>
          ) : (
            <Button>Ativar</Button>
          )}
        </div>
      </div>

      <Tabs tabs={TABS} activeId={tab} onChange={setTab}>
        {tab === "overview" && (
          <Fragment>
          <Card title="Visão geral">
            <dl className={styles.dl}>
              <dt>Plano</dt>
              <dd>{tenant.plan}</dd>
              <dt>Max agentes</dt>
              <dd>{tenant.max_agents ?? "-"}</dd>
              <dt>Max mensagens</dt>
              <dd>{Number(tenant?.max_messages ?? 0).toLocaleString("pt-BR")}</dd>
              <dt>Agentes no período</dt>
              <dd>{tenant.agents_used_current_period ?? 0}</dd>
              <dt>Mensagens no período</dt>
              <dd>{Number(tenant?.messages_used_current_period ?? 0).toLocaleString("pt-BR")}</dd>
              <dt>Início do ciclo</dt>
              <dd>{tenant.billing_cycle_start?.slice(0, 10) ?? "-"}</dd>
              <dt>Providers liberados</dt>
              <dd>
                <div className={styles.providersWrap}>
                  {getTenantProvidersDisplay(tenant.allowed_providers).map((item) => (
                    <Badge key={item.type} variant={item.badgeVariant} className={styles.providerBadge}>
                      {item.label}
                    </Badge>
                  ))}
                </div>
              </dd>
            </dl>
            {isEditing ? (
              <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Editar tenant</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  <label>
                    <div>Empresa</div>
                    <input
                      value={editForm.nome_empresa}
                      onChange={(e) => setEditForm((p) => ({ ...p, nome_empresa: e.target.value }))}
                    />
                  </label>
                  <label>
                    <div>Slug</div>
                    <input
                      value={editForm.slug}
                      onChange={(e) => setEditForm((p) => ({ ...p, slug: e.target.value }))}
                    />
                  </label>
                  <label>
                    <div>Plano</div>
                    <select
                      value={editForm.plan}
                      onChange={(e) => setEditForm((p) => ({ ...p, plan: e.target.value }))}
                    >
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </label>
                  <label>
                    <div>Status</div>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}
                    >
                      <option value="ativo">Ativo</option>
                      <option value="inativo">Inativo</option>
                      <option value="active">Ativo</option>
                      <option value="inactive">Inativo</option>
                    </select>
                  </label>
                  <label>
                    <div>Max agentes</div>
                    <input
                      type="number"
                      value={editForm.max_agents}
                      onChange={(e) => setEditForm((p) => ({ ...p, max_agents: Number(e.target.value) }))}
                    />
                  </label>
                  <label>
                    <div>Max mensagens</div>
                    <input
                      type="number"
                      value={editForm.max_messages}
                      onChange={(e) => setEditForm((p) => ({ ...p, max_messages: Number(e.target.value) }))}
                    />
                  </label>
                </div>
                <div style={{ marginTop: 16 }}>
                  <strong>Providers de WhatsApp liberados</strong>
                  <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                    {providerOptions().map((provider) => (
                      <label key={provider.value} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editForm.allowed_providers.includes(provider.value)}
                          onChange={() => toggleProvider(provider.value)}
                        />
                        <span>{provider.label}</span>
                      </label>
                    ))}
                  </div>
                  <small style={{ display: "block", color: "var(--text-muted)", marginTop: 6 }}>
                    Esses providers ficarão disponíveis para os usuários deste tenant conforme o pacote contratado.
                  </small>
                </div>
                {saveError ? <p style={{ color: "var(--danger)", marginTop: 10 }}>{saveError}</p> : null}
                <div style={{ marginTop: 12 }}>
                  <Button onClick={handleSaveTenant} disabled={savingTenant}>
                    {savingTenant ? "Salvando..." : "Salvar alterações"}
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>

          <Card title="Features" className={styles.featureCardSpacer}>
            <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Plano <strong>{tenant.plan}</strong> define o padrão; overrides gravados só para chaves que diferem do
              plano. O valor efetivo é sempre plano + override.
            </p>
            <div
              style={{
                marginBottom: 16,
                paddingBottom: 16,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Template rápido</div>
              {featureTemplatesLoading ? (
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>Carregando templates...</p>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                    <label style={{ flex: "1 1 220px" }}>
                      <div style={{ fontSize: "0.8rem", marginBottom: 4 }}>Preset</div>
                      <select
                        style={{ width: "100%", minHeight: 36 }}
                        value={selectedTemplateKey}
                        onChange={(e) => setSelectedTemplateKey(e.target.value)}
                      >
                        <option value="">— Escolher template —</option>
                        {featureTemplates.map((t) => (
                          <option key={t.key} value={t.key}>
                            {TEMPLATE_DISPLAY_LABELS[t.key] ?? t.key}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="secondary"
                      disabled={featuresSaving || !selectedTemplateKey}
                      onClick={() => void handleApplyFeatureTemplate()}
                    >
                      Aplicar template
                    </Button>
                  </div>
                  {selectedTemplateKey ? (
                    <div style={{ marginTop: 10, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      <strong>Template:</strong>{" "}
                      {TEMPLATE_DISPLAY_LABELS[selectedTemplateKey] || selectedTemplateKey}
                      <div style={{ marginTop: 6 }}>
                        <strong>Flags que mudarão (efetivo)</strong>
                      </div>
                      <div className={styles.historySummary} style={{ marginTop: 4 }}>
                        {templatePreviewLines.length > 0 ? (
                          templatePreviewLines.map((line, i) => (
                            <div key={i} className={styles.historySummaryLine}>
                              {line}
                            </div>
                          ))
                        ) : (
                          <span className={styles.historySummaryLine}>
                            Nenhuma mudança efetiva será aplicada
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            {TENANT_FEATURE_KEYS.map((key) => (
              <div key={key} className={styles.featureRowBlock}>
                <div className={styles.featureRowMain}>
                  <div className={styles.featureTitle}>{TENANT_FEATURE_LABELS[key]}</div>
                  <div className={styles.featureMeta}>
                    <div>Plano: {String(boolFromJson(planBaseForFeatures[key]))}</div>
                    <div>Override: {savedOverrideLabel(tenant, key)}</div>
                    <div>Efetivo: {String(Boolean(featureDraft[key]))}</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  className={styles.featureSwitch}
                  checked={Boolean(featureDraft[key])}
                  onChange={(e) => setFeatureDraft((prev) => ({ ...prev, [key]: e.target.checked }))}
                  aria-label={TENANT_FEATURE_LABELS[key]}
                />
              </div>
            ))}
            {featuresError ? <p style={{ color: "var(--danger)", marginTop: 10 }}>{featuresError}</p> : null}
            <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Button onClick={handleSaveFeatures} disabled={featuresSaving}>
                {featuresSaving ? "Salvando..." : "Salvar features"}
              </Button>
              <Button variant="secondary" onClick={handleResetFeaturesToPlan} disabled={featuresSaving}>
                Voltar ao padrão do plano
              </Button>
            </div>
          </Card>

          <Card title="Histórico de features" className={styles.featureCardSpacer}>
            {featureHistoryLoading ? (
              <p className={styles.placeholder}>Carregando histórico...</p>
            ) : featureHistory.length === 0 ? (
              <p className={styles.placeholder}>Nenhuma alteração registrada ainda.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Data / hora</th>
                    <th>Alterado por</th>
                    <th>Resumo</th>
                    <th style={{ width: "11rem" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {featureHistory.map((row) => {
                    const prev = (row.effective_previous_flags || {}) as Record<string, unknown>;
                    const next = (row.effective_new_flags || {}) as Record<string, unknown>;
                    const deltas = summarizeEffectiveFlagChange(prev, next);
                    const auditPrev = validatedSparseFromRow(row.previous_flags);
                    const tenantSparse = validatedSparseFromRow(tenant.feature_flags);
                    const isSameAsCurrent = sparseMapsEqual(auditPrev, tenantSparse);
                    return (
                      <tr key={row.id}>
                        <td>{row.created_at ? new Date(row.created_at).toLocaleString("pt-BR") : "-"}</td>
                        <td>{row.changed_by || "-"}</td>
                        <td>
                          {isSameAsCurrent ? (
                            <div className={styles.historyBadgeWrap}>
                              <Badge variant="default">Igual ao estado atual</Badge>
                            </div>
                          ) : null}
                          <div className={styles.historySummary}>
                            {deltas.length > 0 ? (
                              deltas.map((line, i) => (
                                <div key={i} className={styles.historySummaryLine}>
                                  {line}
                                </div>
                              ))
                            ) : (
                              <span className={styles.historySummaryLine}>
                                Sem mudança no mapa efetivo (ajuste só nos overrides persistidos).
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            title={isSameAsCurrent ? "Este estado já está aplicado" : undefined}
                            style={{ display: "inline-block", maxWidth: "100%" }}
                          >
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={featuresSaving || revertLoading || isSameAsCurrent}
                              onClick={() => {
                                setRevertError("");
                                setRevertTarget(row);
                              }}
                            >
                              Reverter para este estado anterior
                            </Button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          </Fragment>
        )}
        {tab === "agents" && (
          <Card title="Agentes">
            {agentsLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : agents.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Slug</th>
                    <th>Descrição</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.slug}</td>
                      <td>{a.description ?? "-"}</td>
                      <td>
                        <Badge variant={a.status === "ativo" ? "success" : "default"}>{a.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {tab === "channels" && (
          <Card title="Canais">
            {channelsLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : channels.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Agent ID</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.type}</td>
                      <td>
                        <Badge variant={c.status === "online" ? "success" : "default"}>{c.status}</Badge>
                      </td>
                      <td className={styles.mono}>{c.agent_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {tab === "users" && (
          <Card title="Usuários">
            {usersLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : users.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Nome</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name ?? "-"}</td>
                      <td>{u.created_at ? new Date(u.created_at).toLocaleString("pt-BR") : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.placeholder} style={{ marginTop: "1rem" }}>
              <Link to={`/tenants/${tenantId}/users`}>Ver página de usuários do tenant</Link>
            </p>
          </Card>
        )}
        {tab === "usage" && (
          <Card title="Uso">
            {usageLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : !usage ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <div className={styles.cards}>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Mensagens</span>
                  <span className={styles.cardValue}>{Number(usage.messages_count).toLocaleString("pt-BR")}</span>
                </div>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Agentes</span>
                  <span className={styles.cardValue}>{usage.agents_count}</span>
                </div>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Canais</span>
                  <span className={styles.cardValue}>{usage.channels_count}</span>
                </div>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Plano</span>
                  <span className={styles.cardValue}>{usage.current_plan_limit?.plan ?? "-"}</span>
                </div>
              </div>
            )}
          </Card>
        )}
        {tab === "logs" && (
          <Card title="Logs">
            {logsLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : logs.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Metadados</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={log.id ?? i}>
                      <td>{log.channel_type ?? "usage"}</td>
                      <td className={styles.mono}>
                        {[
                          log.messages_sent != null && `enviadas: ${log.messages_sent}`,
                          log.messages_received != null && `recebidas: ${log.messages_received}`,
                          log.tokens != null && `tokens: ${log.tokens}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "-"}
                      </td>
                      <td>
                        {log.recorded_at
                          ? new Date(log.recorded_at).toLocaleString("pt-BR")
                          : log.created_at
                            ? new Date(log.created_at).toLocaleString("pt-BR")
                            : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {tab === "billing" && (
          <Card title="Billing">
            {billingLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : !billing ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <dl className={styles.dl}>
                <dt>Plano</dt>
                <dd>{billing.plan}</dd>
                <dt>Max agentes</dt>
                <dd>{billing.max_agents}</dd>
                <dt>Max mensagens</dt>
                <dd>{Number(billing.max_messages).toLocaleString("pt-BR")}</dd>
                <dt>Mensagens usadas</dt>
                <dd>{Number(billing.messages_count).toLocaleString("pt-BR")}</dd>
                <dt>Agentes usados</dt>
                <dd>{billing.agents_count}</dd>
                <dt>Ativo</dt>
                <dd>
                  <Badge variant={billing.active ? "success" : "default"}>{billing.active ? "Sim" : "Não"}</Badge>
                </dd>
              </dl>
            )}
          </Card>
        )}
      </Tabs>

      <Modal
        open={revertTarget !== null}
        onClose={() => {
          if (!revertLoading) {
            setRevertTarget(null);
            setRevertError("");
          }
        }}
        title="Reverter feature flags"
      >
        {revertTarget && tenant ? (
          <div>
            {(() => {
              const originalEffectLines = summarizeEffectiveFlagChange(
                (revertTarget.effective_previous_flags || {}) as Record<string, unknown>,
                (revertTarget.effective_new_flags || {}) as Record<string, unknown>
              );
              const impactPreviewLines = summarizeRevertEffectivePreview(
                tenant.effective_feature_flags,
                (revertTarget.effective_previous_flags || {}) as Record<string, unknown>
              );
              return (
                <Fragment>
                  <p style={{ marginTop: 0, fontSize: "0.9rem", lineHeight: 1.5 }}>
                    Isso vai restaurar os overrides anteriores registrados nesta alteração.
                  </p>
                  <dl className={styles.dl} style={{ marginTop: 12 }}>
                    <dt>Data / hora</dt>
                    <dd>
                      {revertTarget.created_at ? new Date(revertTarget.created_at).toLocaleString("pt-BR") : "-"}
                    </dd>
                    <dt>Alterado por</dt>
                    <dd>{revertTarget.changed_by || "-"}</dd>
                    <dt>Resumo da reversão</dt>
                    <dd>
                      <div className={styles.historySummary}>
                        {summarizeStoredOverridesLines(
                          (revertTarget.previous_flags || {}) as Record<string, unknown>
                        ).map((line, i) => (
                          <div key={i} className={styles.historySummaryLine}>
                            {line}
                          </div>
                        ))}
                      </div>
                    </dd>
                    <dt>FLAGS QUE VÃO MUDAR</dt>
                    <dd>
                      <div className={styles.historySummary}>
                        {impactPreviewLines.length > 0 ? (
                          impactPreviewLines.map((line, i) => (
                            <div key={i} className={styles.historySummaryLine}>
                              {line}
                            </div>
                          ))
                        ) : (
                          <span className={styles.historySummaryLine}>
                            Nenhuma mudança efetiva será aplicada
                          </span>
                        )}
                      </div>
                    </dd>
                    <dt>Contexto (efeito da alteração original)</dt>
                    <dd>
                      <div className={styles.historySummary}>
                        {originalEffectLines.length > 0 ? (
                          originalEffectLines.map((line, i) => (
                            <div key={i} className={styles.historySummaryLine}>
                              {line}
                            </div>
                          ))
                        ) : (
                          <span className={styles.historySummaryLine}>
                            Sem mudança no mapa efetivo nesta entrada.
                          </span>
                        )}
                      </div>
                    </dd>
                  </dl>
                </Fragment>
              );
            })()}
            {revertError ? <p style={{ color: "var(--danger)", marginTop: 8 }}>{revertError}</p> : null}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <Button
                variant="secondary"
                disabled={revertLoading}
                onClick={() => {
                  setRevertTarget(null);
                  setRevertError("");
                }}
              >
                Cancelar
              </Button>
              <Button disabled={revertLoading} onClick={() => void handleConfirmRevert()}>
                {revertLoading ? "Revertendo..." : "Confirmar reversão"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {revertToast ? (
        <div role="status" aria-live="polite" className={`${styles.toast} ${styles.toastInfo}`}>
          {revertToast}
        </div>
      ) : null}
    </div>
  );
}
