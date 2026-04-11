export class ChannelProvider {
  constructor(channel, opts = {}) {
    this.channel = channel;
    this.opts = opts;
  }

  async getStatus(_channel = this.channel) {
    throw new Error('getStatus() não implementado');
  }

  async getQr(_channel = this.channel) {
    throw new Error('getQr() não implementado');
  }

  async start(_channel = this.channel) {
    throw new Error('start() não implementado');
  }

  async stop(_channel = this.channel) {
    throw new Error('stop() não implementado');
  }

  supportsRealtime() {
    return false;
  }
}
