export const SessionAdapter = {
  async getSession(_name) {
    throw new Error('SessionAdapter.getSession não implementado');
  },
  async createSession(_name) {
    throw new Error('SessionAdapter.createSession não implementado');
  },
  async deleteSession(_name) {
    throw new Error('SessionAdapter.deleteSession não implementado');
  },
  async startSession(_name) {
    throw new Error('SessionAdapter.startSession não implementado');
  },
  async getQRCode(_name) {
    throw new Error('SessionAdapter.getQRCode não implementado');
  },
};
