import styles from './CreateChannelCard.module.css';

/**
 * Formulário de criação de canal — layout vertical, sem acionar conexão automaticamente.
 */
export function CreateChannelCard({
  name,
  setName,
  agentId,
  setAgentId,
  channelType,
  onChannelTypeChange,
  whatsappProvider,
  onWhatsappProviderChange,
  allowedProviders,
  whatsappAdvanced,
  setWhatsappAdvanced,
  evolutionInstanceNames,
  whatsappInstanceSelect,
  setWhatsappInstanceSelect,
  whatsappInstanceManual,
  setWhatsappInstanceManual,
  agents,
  loadingCreate,
  onSubmit,
  onClear,
  providersBlocked,
}) {
  return (
    <section className={styles.card} aria-labelledby="create-channel-title">
      <header className={styles.header}>
        <h2 id="create-channel-title" className={styles.title}>
          Criar novo canal
        </h2>
        <p className={styles.subtitle}>
          Preencha os dados abaixo. Depois de salvar, use a lista de canais para conectar o WhatsApp ou configurar
          outros tipos.
        </p>
      </header>

      {providersBlocked ? (
        <p className={styles.warning}>
          Nenhum provider de WhatsApp está liberado para seu plano. Entre em contato para habilitar.
        </p>
      ) : null}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="cc-name">
            Nome do canal
          </label>
          <input
            id="cc-name"
            className={styles.input}
            placeholder="Ex.: Atendimento comercial"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="cc-type">
            Tipo de canal
          </label>
          <select
            id="cc-type"
            className={styles.select}
            value={channelType}
            onChange={(e) => onChannelTypeChange(e.target.value)}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="telegram">Telegram</option>
            <option value="web">Web Chat</option>
            <option value="api">API / Webhook</option>
          </select>
        </div>

        {channelType === 'whatsapp' && allowedProviders.length > 0 ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="cc-provider">
              Conexão WhatsApp
            </label>
            <select
              id="cc-provider"
              className={styles.select}
              value={whatsappProvider}
              onChange={(e) => onWhatsappProviderChange(e.target.value)}
            >
              {allowedProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider === 'evolution'
                    ? 'Evolution'
                    : provider === 'waha'
                      ? 'WAHA'
                      : provider === 'zapi'
                        ? 'Z-API'
                        : provider}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {channelType === 'whatsapp' ? (
          <div className={styles.field}>
            <div className={styles.label}>Tipo de integração</div>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={whatsappAdvanced}
                onChange={(e) => {
                  setWhatsappAdvanced(e.target.checked);
                  setWhatsappInstanceSelect('');
                  setWhatsappInstanceManual('');
                }}
              />
              <span>Vincular instância já existente no provedor</span>
            </label>
            <p className={styles.hint}>
              Padrão: nova instância criada automaticamente. Marque apenas se a instância já existir na API do
              provedor.
            </p>
          </div>
        ) : null}

        {channelType === 'whatsapp' && whatsappAdvanced ? (
          <>
            {whatsappProvider === 'evolution' ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="cc-evolution-inst">
                  Instância Evolution (lista)
                </label>
                <select
                  id="cc-evolution-inst"
                  className={styles.select}
                  value={whatsappInstanceSelect}
                  onChange={(e) => setWhatsappInstanceSelect(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {evolutionInstanceNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="cc-inst-manual">
                Nome da instância
              </label>
              <input
                id="cc-inst-manual"
                className={styles.input}
                placeholder="Nome exato na API do provider"
                value={whatsappInstanceManual}
                onChange={(e) => setWhatsappInstanceManual(e.target.value)}
              />
            </div>
          </>
        ) : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="cc-agent">
            Agente responsável
          </label>
          <select
            id="cc-agent"
            className={styles.select}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Selecione um agente</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={loadingCreate || (channelType === 'whatsapp' && allowedProviders.length === 0)}
          >
            {loadingCreate
              ? channelType === 'whatsapp'
                ? 'Criando canal WhatsApp…'
                : 'Criando canal…'
              : channelType === 'whatsapp'
                ? 'Criar canal WhatsApp'
                : 'Criar canal'}
          </button>
          <button type="button" className={styles.btnGhost} onClick={onClear}>
            Limpar formulário
          </button>
        </div>
      </form>
    </section>
  );
}
