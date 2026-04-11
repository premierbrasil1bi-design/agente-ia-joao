import { getProviderForChannel } from '../../providers/index.js';
import { normalizeQrResult } from '../../utils/normalizeQrResult.js';
import { ChannelProvider } from './ChannelProvider.js';
import { normalizeChannelStatus } from './normalizeChannelStatus.js';

export class EvolutionProvider extends ChannelProvider {
  constructor(channel, opts = {}) {
    super(channel, opts);
    this.provider = getProviderForChannel(channel, opts);
  }

  async getStatus(channel = this.channel) {
    const raw = await this.provider.getStatus(channel);
    const rawStatus = raw?.status ?? raw?.state ?? raw?.instance?.state ?? null;
    return normalizeChannelStatus('evolution', rawStatus);
  }

  async getQr(channel = this.channel) {
    const raw = await this.provider.getQRCode(channel);
    const normalized = normalizeQrResult(raw);
    return normalized?.success && normalized?.qr ? normalized.qr : null;
  }

  async start(channel = this.channel) {
    return this.provider.connect(channel);
  }

  async stop(channel = this.channel) {
    return this.provider.disconnect(channel);
  }

  supportsRealtime() {
    return false;
  }
}
