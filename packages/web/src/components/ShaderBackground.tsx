import React, { useEffect, useRef } from 'react';

export const ShaderBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    // Particle nodes for neural mesh
    const nodeCount = prefersReducedMotion ? 20 : 45;
    const nodes = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * (prefersReducedMotion ? 0 : 0.4),
      vy: (Math.random() - 0.5) * (prefersReducedMotion ? 0 : 0.4),
      radius: Math.random() * 2 + 1,
      color: Math.random() > 0.4 ? '#00f0ff' : '#8b5cf6',
    }));

    let step = 0;

    const render = () => {
      step += 0.005;
      ctx.clearRect(0, 0, width, height);

      // Deep space atmospheric base gradient
      const bgGrad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.3,
        50,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.8
      );
      bgGrad.addColorStop(0, '#0c162d');
      bgGrad.addColorStop(0.5, '#070b16');
      bgGrad.addColorStop(1, '#04060c');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Subtle ambient light orbs
      const orbX = width * 0.7 + Math.sin(step) * 60;
      const orbY = height * 0.2 + Math.cos(step) * 40;
      const orbGrad = ctx.createRadialGradient(orbX, orbY, 10, orbX, orbY, 400);
      orbGrad.addColorStop(0, 'rgba(0, 240, 255, 0.08)');
      orbGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = orbGrad;
      ctx.fillRect(0, 0, width, height);

      // Draw interconnecting neural edges
      ctx.lineWidth = 0.6;
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];

        if (!prefersReducedMotion) {
          n1.x += n1.vx;
          n1.y += n1.vy;

          if (n1.x < 0 || n1.x > width) n1.vx *= -1;
          if (n1.y < 0 || n1.y > height) n1.vy *= -1;
        }

        // Draw connections
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dist = Math.hypot(n1.x - n2.x, n1.y - n2.y);
          if (dist < 160) {
            const alpha = (1 - dist / 160) * 0.22;
            ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.stroke();
          }
        }

        // Draw node
        ctx.fillStyle = n1.color;
        ctx.beginPath();
        ctx.arc(n1.x, n1.y, n1.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 w-full h-full opacity-70"
    />
  );
};
