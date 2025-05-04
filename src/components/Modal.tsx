import React from 'react';

const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
      justifyContent: 'flex-end',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        width: '60vw',
        height: '100vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        boxSizing: 'border-box',
      }}>
        <h2>{title}</h2>
        <div style={{ flexGrow: 1, overflowY: 'auto' }}>
          {children}
        </div>

        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-start',
            marginBottom: '15px',
            padding: '8px 15px',
            backgroundColor: 'black',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9em',
            fontWeight: 'bold',
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
};

export default Modal;
