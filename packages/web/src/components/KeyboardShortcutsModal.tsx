import React, { useEffect, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcuts = [
    { key: '?', desc: 'Open / close this keyboard shortcuts guide' },
    { key: '1', desc: 'Navigate to War Room Simulator' },
    { key: '2', desc: 'Navigate to Atlas 2.0 Engine Visualizer' },
    { key: '3', desc: 'Navigate to vs Agentforce Battlecard' },
    { key: '4', desc: 'Navigate to ROI Calculator' },
    { key: '5', desc: 'Navigate to WCAG 2.2 Auditor' },
    { key: 'Esc', desc: 'Close open modal or dialog' },
    { key: 'Tab', desc: 'Advance accessible focus ring' },
  ];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-white/15 shadow-2xl relative animate-in fade-in zoom-in-95"
      >
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-[#00f0ff]" aria-hidden="true" />
            <h2 id="modal-title" className="text-base font-bold text-white">
              Keyboard Navigation Shortcuts
            </h2>
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            className="touch-target p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-2.5 mb-6">
          {shortcuts.map((s, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5">
              <span className="text-slate-300">{s.desc}</span>
              <kbd className="px-2 py-1 rounded bg-slate-950 border border-white/15 text-white font-mono text-[11px] font-bold">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="touch-target w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white transition-all"
        >
          Close Shortcuts Guide
        </button>
      </div>
    </div>
  );
};
