import React from 'react';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: '1rem',
};

const modalStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '1.5rem',
  minWidth: 320,
  maxWidth: 480,
  maxHeight: '90vh',
  overflowY: 'auto',
};

const titleStyle = {
  margin: '0 0 1rem',
  fontSize: '1.1rem',
  color: 'var(--text)',
};

const actionsStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: '1rem',
};

const buttonStyle = {
  padding: '0.5rem 1rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: '0.9rem',
};

export function QRCodeModal({ open, qrCode, onClose }) {
  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose} role="dialog" aria-modal="true">
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={titleStyle}>WhatsApp QR Code</h3>
        {qrCode && <img src={qrCode} alt="WhatsApp QR Code" style={{ width: 300, display: 'block', margin: '0 auto' }} />}
        <div style={actionsStyle}>
          <button type="button" style={buttonStyle} onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

