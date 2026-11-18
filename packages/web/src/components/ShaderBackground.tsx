import React, { useState, useEffect } from 'react';
import { MeshGradient } from '@paper-design/shaders-react';

export const ShaderBackground: React.FC = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [hasShaderError, setHasShaderError] = useState(false);

  useEffect(() => {
    try {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mql.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } catch {
      // ignore in environments without matchMedia
    }
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden w-full h-full"
    >
      {!hasShaderError ? (
        <MeshGradient
          colors={['#000000', '#050508', '#0D0D11', '#141414']}
          distortion={0.85}
          swirl={0.65}
          speed={prefersReducedMotion ? 0 : 0.15}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0.85,
          }}
          onError={() => setHasShaderError(true)}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#000000] via-[#050508] to-[#0D0D11]" />
      )}

      {/* Atmospheric ambient lighting and subtle grid overlay */}
      <div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#FF5500]/8 via-transparent to-transparent pointer-events-none" 
      />
      <div 
        className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" 
      />
    </div>
  );
};
