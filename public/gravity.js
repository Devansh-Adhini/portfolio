/**
 * A quiet field of elastic, drifting particles. The canvas never receives input;
 * pointer coordinates only influence the particles, leaving the native cursor alone.
 */
export function initGravity(canvas, options = {}) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return { setPaused() {}, destroy() {} };

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointerQuery = window.matchMedia("(pointer: fine)");
  const colors = ["#c4b0f5", "#9b75df", "#7753b8", "#eee8fb", "#b28ae9"];
  const pointer = { x: 0, y: 0, active: false, strength: 0 };
  let particles = [];
  let width = 0;
  let height = 0;
  let animationId = 0;
  let previousTime = 0;
  let elapsed = 0;
  let paused = false;
  let destroyed = false;
  let reducedMotion = options.reducedMotion ?? motionQuery.matches;

  canvas.setAttribute("aria-hidden", "true");
  canvas.style.pointerEvents = "none";

  function position(particle, time) {
    // Independent, overlapping waves meander without a shared orbit or abrupt turns.
    const flowX = time * particle.flowX + particle.phase;
    const flowY = time * particle.flowY + particle.phaseY;
    return {
      x:
        width * particle.anchorX +
        (Math.sin(flowX) + Math.sin(flowY * 0.63) * 0.4) * particle.wanderX,
      y:
        height * particle.anchorY +
        (Math.sin(flowY) + Math.cos(flowX * 0.71) * 0.35) * particle.wanderY,
    };
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(scale, 0, 0, scale, 0, 0);

    const baseCount =
      width < 640 || !finePointerQuery.matches
        ? 115
        : Math.min(350, Math.round((width * height) / 3300));
    const count = Math.round(baseCount * 1.1);
    particles = Array.from({ length: count }, () => {
      const ambient = Math.random() < 0.65;
      const particle = {
        angle: Math.random() * Math.PI * 2,
        anchorX: ambient ? Math.random() : 0.4 + Math.random() * 0.6,
        anchorY: Math.random(),
        phase: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        flowX: 0.035 + Math.random() * 0.09,
        flowY: 0.03 + Math.random() * 0.085,
        wanderX: Math.min(width * 0.12, 22 + Math.random() * 65),
        wanderY: Math.min(height * 0.12, 16 + Math.random() * 50),
        size: 0.65 + Math.random() * 1.05,
        alpha: ambient
          ? 0.16 + Math.random() * 0.22
          : 0.28 + Math.random() * 0.46,
        color: colors[Math.floor(Math.random() * colors.length)],
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      };
      const initial = position(particle, elapsed);
      particle.x = initial.x;
      particle.y = initial.y;
      return particle;
    });
    paint(0);
  }

  function paint(delta) {
    context.clearRect(0, 0, width, height);
    pointer.strength +=
      ((pointer.active ? 1 : 0) - pointer.strength) * Math.min(1, delta * 3.5);

    for (const particle of particles) {
      const target = position(particle, elapsed);
      if (!reducedMotion && pointer.strength > 0.001) {
        const dx = pointer.x - target.x;
        const dy = pointer.y - target.y;
        const distance = Math.hypot(dx, dy);
        const influence = Math.max(0, 1 - distance / 340);
        const pull = influence * influence * pointer.strength * 0.55;
        target.x += dx * pull - dy * pull * 0.18;
        target.y += dy * pull + dx * pull * 0.18;
      }

      if (delta > 0) {
        // A damped spring gives each dot a little weight without long trails.
        const damping = Math.exp(-5.2 * delta);
        particle.vx =
          (particle.vx + (target.x - particle.x) * 11 * delta) * damping;
        particle.vy =
          (particle.vy + (target.y - particle.y) * 11 * delta) * damping;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
      }

      const speed = Math.hypot(particle.vx, particle.vy);
      const stretch = 1.3 + Math.min(3.2, speed * 0.045);
      const angle =
        speed > 1
          ? Math.atan2(particle.vy, particle.vx)
          : particle.angle + Math.PI / 2;
      context.globalAlpha = particle.alpha;
      context.fillStyle = particle.color;
      context.beginPath();
      context.ellipse(
        particle.x,
        particle.y,
        particle.size * stretch,
        particle.size * 0.7,
        angle,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function canAnimate() {
    return !destroyed && !paused && !reducedMotion && !document.hidden;
  }

  function frame(time) {
    animationId = 0;
    if (!canAnimate()) return;
    // Cap resumed/slow frames so a stalled tab never launches particles away.
    const delta = previousTime
      ? Math.min((time - previousTime) / 1000, 0.033)
      : 1 / 60;
    previousTime = time;
    elapsed += delta;
    paint(delta);
    animationId = window.requestAnimationFrame(frame);
  }

  function syncAnimation() {
    if (animationId) window.cancelAnimationFrame(animationId);
    animationId = 0;
    previousTime = 0;
    if (canAnimate()) animationId = window.requestAnimationFrame(frame);
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch") return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  }

  function onPointerOut(event) {
    if (!event.relatedTarget) pointer.active = false;
  }

  function onBlur() {
    pointer.active = false;
  }

  function onMotionChange(event) {
    // An explicit initial override is useful for a caller's motion preference.
    reducedMotion = options.reducedMotion ?? event.matches;
    if (reducedMotion) pointer.strength = 0;
    syncAnimation();
    if (reducedMotion) paint(0);
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerout", onPointerOut, { passive: true });
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", syncAnimation);
  motionQuery.addEventListener("change", onMotionChange);
  finePointerQuery.addEventListener("change", resize);
  resize();
  syncAnimation();

  return {
    setPaused(value) {
      paused = Boolean(value);
      syncAnimation();
    },
    destroy() {
      destroyed = true;
      syncAnimation();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", syncAnimation);
      motionQuery.removeEventListener("change", onMotionChange);
      finePointerQuery.removeEventListener("change", resize);
      context.clearRect(0, 0, width, height);
      particles = [];
    },
  };
}
