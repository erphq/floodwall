const canvas = document.querySelector("#wall-canvas");

if (canvas) {
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0;
  let height = 0;
  let scale = 1;
  let particles = [];
  let raf = 0;

  const colors = ["#3b78d8", "#d6a83d", "#2f8f67", "#cc6b2c", "#b94343"];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    scale = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    seedParticles();
    draw(performance.now());
  }

  function seedParticles() {
    const count = Math.max(28, Math.min(86, Math.floor(width / 18)));
    particles = Array.from({ length: count }, (_, i) => ({
      x: -80 + Math.random() * width * 0.74,
      y: 110 + Math.random() * Math.max(180, height - 250),
      size: 3 + Math.random() * 5,
      speed: 0.24 + Math.random() * 0.52,
      color: colors[i % colors.length],
      lane: Math.floor(Math.random() * 5),
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function drawGrid() {
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.strokeStyle = "#fff8eb";
    ctx.lineWidth = 1;
    const gap = 42;
    for (let x = 0; x < width; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWall(now) {
    const wallX = width * 0.68;
    const top = Math.max(86, height * 0.16);
    const bottom = height - Math.max(86, height * 0.14);
    const pulse = reduceMotion.matches ? 0 : Math.sin(now / 620) * 0.08;

    ctx.save();
    ctx.shadowColor = "rgba(244, 180, 94, 0.38)";
    ctx.shadowBlur = 34;
    ctx.strokeStyle = `rgba(244, 180, 94, ${0.82 + pulse})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(wallX, top);
    ctx.lineTo(wallX, bottom);
    ctx.stroke();
    ctx.shadowBlur = 0;

    const labels = [
      ["admission", "#3b78d8"],
      ["gate", "#cc6b2c"],
      ["ledger", "#2f8f67"],
    ];
    labels.forEach(([label, color], index) => {
      const y = top + 48 + index * 74;
      ctx.fillStyle = "rgba(20, 17, 15, 0.72)";
      ctx.strokeStyle = "rgba(255, 248, 235, 0.22)";
      roundRect(ctx, wallX + 20, y - 19, 126, 38, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, wallX + 38, y + 4);
    });
    ctx.restore();
  }

  function drawParticles(now) {
    const wallX = width * 0.68;
    particles.forEach((p) => {
      if (!reduceMotion.matches) {
        p.x += p.speed;
        if (p.x > wallX - 16) {
          p.x = -80 - Math.random() * 220;
          p.y = 110 + Math.random() * Math.max(180, height - 250);
        }
      }
      const wave = reduceMotion.matches ? 0 : Math.sin(now / 520 + p.phase) * 8;
      const y = p.y + wave + p.lane * 5;
      ctx.save();
      ctx.globalAlpha = p.x < 20 ? 0.45 : 0.9;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 16;
      roundRect(ctx, p.x, y, p.size * 5, p.size * 2.2, p.size);
      ctx.fill();

      ctx.globalAlpha = 0.18;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, p.x - 78), y + p.size);
      ctx.lineTo(p.x - 10, y + p.size);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawLedger(now) {
    const startX = width * 0.74;
    const startY = Math.max(230, height * 0.48);
    const rows = 5;
    ctx.save();
    for (let i = 0; i < rows; i += 1) {
      const alpha = 0.3 + i * 0.12;
      ctx.fillStyle = `rgba(255, 248, 235, ${alpha})`;
      ctx.strokeStyle = "rgba(255, 248, 235, 0.16)";
      roundRect(ctx, startX + i * 18, startY + i * 34, 136, 24, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = i % 3 === 0 ? "#2f8f67" : i % 3 === 1 ? "#d6a83d" : "#b94343";
      roundRect(ctx, startX + 10 + i * 18, startY + 7 + i * 34, 34, 10, 4);
      ctx.fill();
    }
    if (!reduceMotion.matches) {
      ctx.strokeStyle = `rgba(47, 143, 103, ${0.42 + Math.sin(now / 480) * 0.12})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX + 68, startY + 24);
      ctx.lineTo(startX + 68 + (rows - 1) * 18, startY + (rows - 1) * 34);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    drawGrid();
    drawParticles(now);
    drawWall(now);
    drawLedger(now);
    if (!reduceMotion.matches) {
      raf = requestAnimationFrame(draw);
    }
  }

  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
  }

  window.addEventListener("resize", resize);
  reduceMotion.addEventListener("change", () => {
    cancelAnimationFrame(raf);
    draw(performance.now());
    if (!reduceMotion.matches) {
      raf = requestAnimationFrame(draw);
    }
  });
  resize();
  if (!reduceMotion.matches) {
    raf = requestAnimationFrame(draw);
  }
}
