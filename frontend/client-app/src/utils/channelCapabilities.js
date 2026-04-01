export const CHANNEL_CAPABILITIES = {
  whatsapp: {
    supportsTyping: true,
    supportsReadReceipts: true,
    supportsDelivery: true,
    supportsAttachments: true,
  },
  webchat: {
    supportsTyping: true,
    supportsReadReceipts: false,
    supportsDelivery: false,
    supportsAttachments: true,
  },
  telegram: {
    supportsTyping: true,
    supportsReadReceipts: false,
    supportsDelivery: false,
    supportsAttachments: true,
  },
  instagram: {
    supportsTyping: true,
    supportsReadReceipts: false,
    supportsDelivery: false,
    supportsAttachments: true,
  },
  unknown: {
    supportsTyping: false,
    supportsReadReceipts: false,
    supportsDelivery: false,
    supportsAttachments: false,
  },
};

export function getChannelCapabilities(channelType) {
  return CHANNEL_CAPABILITIES[channelType] || CHANNEL_CAPABILITIES.unknown;
}

