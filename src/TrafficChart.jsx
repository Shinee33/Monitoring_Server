import { useRef, useEffect } from 'react';

export default function TrafficChart({ history }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = (canvas.width = canvas.offsetWidth * window.devicePixelRatio);
    const H = (canvas.height = canvas.offsetHeight * window.devicePixelRatio);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    ctx.clearRect(0, 0, w, h);

    if (history.length < 2) return;

    const max = Math.max(...history, 500);
    const step = w / (history.length - 1);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = 'rgba(125,133,144,0.5)';
    ctx.font = '9px Inter';
    for (let i = 0; i < 4; i++) {
      const val = Math.round((max * (4 - i)) / 4);
      const y = (h / 4) * i;
      ctx.fillText(val + ' K', 4, y + 10);
    }

    // Line
    ctx.beginPath();
    history.forEach((v, i) => {
      const x = i * step;
      const y = h - (v / max) * h * 0.85 - 4;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill gradient
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(63,185,80,0.2)');
    grad.addColorStop(1, 'rgba(63,185,80,0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }, [history]);

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height: '100px', display: 'block' }}
    />
  );
}
