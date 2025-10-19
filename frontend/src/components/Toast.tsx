import { useEffect } from 'react';
import './Toast.css';

export interface ToastProps {
  message: string;
  type?: 'info' | 'success' | 'error';
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type = 'info', duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className={`toast toast-${type}`} onClick={onClose}>
      <div className="toast-content">
        <span className="toast-icon">
          {type === 'success' && '✓'}
          {type === 'error' && '✕'}
          {type === 'info' && 'ℹ'}
        </span>
        <span className="toast-message">{message}</span>
      </div>
      <button className="toast-close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
