import { useCallback, useEffect, useRef, useState } from "react";
import { GameShell, GameTopbar } from "@freegamestore/games";
import { useGameLoop } from "./hooks/useGameLoop";
import { useControls } from "./hooks/useControls";
import { useHighScore } from "./hooks/useHighScore";
import { drawGlow, drawText, hexToRgba, randomInRange } from "./lib/canvas";
import type { Ball, Brick, BrickType, Paddle, Particle, Phase } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────
const BALL_SPEED = 420; // px/s
const BALL_RADIUS = 10;
const PADDLE_H = 14;
const PADDLE_SPEED = 520; // px/s (arrow keys)
const BRICK_ROWS = 5;
const BRICK_COLS = 10;
const BRICK_H = 28;
const BRICK_GAP = 5;
const BRICK_TOP_OFFSET = 60;
const PADDLE_Y_OFFSET = 48; // from bottom

// Brick definitions: type → { maxHp, color, dimColor }
const BRICK_DEFS: Record<BrickType, { maxHp: number; color: string; dim: string }> = {
  blue:   { maxHp: 1, color: "#48dbfb", dim: "#1a6a7a" },
  green:  { maxHp: 2, color: "#1dd1a1", dim: "#0a5a44" },
  yellow: { maxHp: 3, color: "#feca57", dim: "#7a6010" },
  pink:   { maxHp: 4, color: "#ff9ff3", dim: "#7a2070" },
  purple: { maxHp: 5, color: "#a29bfe", dim: "#3a2a8a" },
};

// Row order top-to-bottom
const ROW_TYPES: BrickType[] = ["purple", "pink", "yellow", "green", "blue"];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildBricks(canvasW: number): Brick[] {
  const bricks: Brick[] = [];
  const totalGap = BRICK_GAP * (BRICK_COLS + 1);
  const brickW = (canvasW - totalGap) / BRICK_COLS;

  for (let row = 0; row < BRICK_ROWS; row++) {
    const type = ROW_TYPES[row] ?? "blue";
    const def = BRICK_DEFS[type];
    for (let col = 0; col < BRICK_COLS; col++) {
      const x = BRICK_GAP + col * (brickW + BRICK_GAP);
      const y = BRICK_TOP_OFFSET + row * (BRICK_H + BRICK_GAP);
      bricks.push({ x, y, w: brickW, h: BRICK_H, type, hp: def.maxHp, maxHp: def.maxHp, crackAnim: 0 });
    }
  }
  return bricks;
}

function spawnParticles(x: number, y: number, color: string, count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomInRange(60, 220);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color,
      size: randomInRange(3, 7),
    });
  }
  return particles;
}

function createInitialState(w: number, h: number) {
  const paddleW = Math.min(120, w * 0.25);
  const paddleX = w / 2 - paddleW / 2;
  const paddleY = h - PADDLE_Y_OFFSET;

  return {
    ball: {
      x: w / 2,
      y: paddleY - BALL_RADIUS - 2,
      vx: randomInRange(-180, 180),
      vy: -BALL_SPEED,
      radius: BALL_RADIUS,
    } as Ball,
    paddle: {
      x: paddleX,
      y: paddleY,
      w: paddleW,
      h: PADDLE_H,
    } as Paddle,
    bricks: buildBricks(w),
    particles: [] as Particle[],
    score: 0,
    launched: false,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controls = useControls();
  const [highScore, updateHighScore] = useHighScore("bouncingball_hs");
  const [phase, setPhase] = useState<Phase>("menu");
  const [displayScore, setDisplayScore] = useState(0);
  const [level, setLevel] = useState(1);

  // Mutable game state (not React state — updated every frame)
  const stateRef = useRef(createInitialState(400, 600));
  const phaseRef = useRef<Phase>("menu");
  const levelRef = useRef(1);
  const canvasSizeRef = useRef({ w: 400, h: 600 });

  // Keep phaseRef in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { levelRef.current = level; }, [level]);

  // Resize canvas to fill container
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w;
    canvas.height = h;
    canvasSizeRef.current = { w, h };
    // Re-init state on resize only if in menu
    if (phaseRef.current === "menu") {
      stateRef.current = createInitialState(w, h);
    }
  }, []);

  useEffect(() => {
    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resize]);

  const startGame = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    stateRef.current = createInitialState(w, h);
    setDisplayScore(0);
    setLevel(1);
    levelRef.current = 1;
    setPhase("playing");
    phaseRef.current = "playing";
  }, []);

  const nextLevel = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    const newLevel = levelRef.current + 1;
    const s = stateRef.current;
    const paddleW = s.paddle.w;
    const paddleX = w / 2 - paddleW / 2;
    const paddleY = h - PADDLE_Y_OFFSET;
    // Reset ball + bricks, keep score + paddle
    stateRef.current = {
      ...createInitialState(w, h),
      score: s.score,
      paddle: { ...s.paddle, x: paddleX, y: paddleY, w: paddleW },
    };
    setLevel(newLevel);
    levelRef.current = newLevel;
    setPhase("playing");
    phaseRef.current = "playing";
  }, []);

  // ─── Game loop ──────────────────────────────────────────────────────────────
  useGameLoop((dt) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = canvasSizeRef.current;
    const s = stateRef.current;
    const { keys, mouse, touch } = controls;

    // ── Update ──
    if (phaseRef.current === "playing") {
      const paddleW = s.paddle.w;

      // Paddle movement: mouse or touch (horizontal only)
      const inputX = touch.active ? touch.x : mouse.x;
      const rect = canvas.getBoundingClientRect();
      const relX = inputX - rect.left;
      // Only follow mouse/touch if it moved (not keyboard-only)
      if (mouse.x !== 0 || touch.active) {
        s.paddle.x = Math.max(0, Math.min(w - paddleW, relX - paddleW / 2));
      }

      // Arrow key paddle movement
      if (keys.has("ArrowLeft")) {
        s.paddle.x = Math.max(0, s.paddle.x - PADDLE_SPEED * dt);
      }
      if (keys.has("ArrowRight")) {
        s.paddle.x = Math.min(w - paddleW, s.paddle.x + PADDLE_SPEED * dt);
      }

      // Launch ball on click / space / touch if not launched
      if (!s.launched) {
        // Stick ball to paddle center
        s.ball.x = s.paddle.x + paddleW / 2;
        s.ball.y = s.paddle.y - BALL_RADIUS - 2;
        if (keys.has(" ") || mouse.down || touch.active) {
          s.launched = true;
          s.ball.vx = randomInRange(-160, 160);
          s.ball.vy = -BALL_SPEED;
        }
      } else {
        // Move ball
        s.ball.x += s.ball.vx * dt;
        s.ball.y += s.ball.vy * dt;

        // Wall bounces (left/right)
        if (s.ball.x - BALL_RADIUS < 0) {
          s.ball.x = BALL_RADIUS;
          s.ball.vx = Math.abs(s.ball.vx);
        }
        if (s.ball.x + BALL_RADIUS > w) {
          s.ball.x = w - BALL_RADIUS;
          s.ball.vx = -Math.abs(s.ball.vx);
        }
        // Top wall bounce
        if (s.ball.y - BALL_RADIUS < 0) {
          s.ball.y = BALL_RADIUS;
          s.ball.vy = Math.abs(s.ball.vy);
        }

        // Paddle collision
        const px = s.paddle.x, py = s.paddle.y, pw = s.paddle.w, ph = s.paddle.h;
        if (
          s.ball.vy > 0 &&
          s.ball.y + BALL_RADIUS >= py &&
          s.ball.y - BALL_RADIUS <= py + ph &&
          s.ball.x >= px &&
          s.ball.x <= px + pw
        ) {
          s.ball.y = py - BALL_RADIUS;
          // Angle based on hit position
          const hitPos = (s.ball.x - px) / pw; // 0–1
          const angle = (hitPos - 0.5) * Math.PI * 0.75; // -67.5° to +67.5°
          const speed = Math.hypot(s.ball.vx, s.ball.vy);
          s.ball.vx = Math.sin(angle) * speed;
          s.ball.vy = -Math.abs(Math.cos(angle) * speed);
        }

        // Bottom → lose
        if (s.ball.y - BALL_RADIUS > h) {
          updateHighScore(s.score);
          setDisplayScore(s.score);
          setPhase("lost");
          phaseRef.current = "lost";
        }

        // Brick collisions
        for (const brick of s.bricks) {
          if (brick.hp <= 0) continue;

          const bLeft = brick.x, bRight = brick.x + brick.w;
          const bTop = brick.y, bBottom = brick.y + brick.h;
          const bx = s.ball.x, by = s.ball.y, br = BALL_RADIUS;

          // AABB circle check
          const nearX = Math.max(bLeft, Math.min(bRight, bx));
          const nearY = Math.max(bTop, Math.min(bBottom, by));
          const dx = bx - nearX;
          const dy = by - nearY;
          if (dx * dx + dy * dy > br * br) continue;

          // Determine bounce axis
          const overlapX = Math.min(bx + br - bLeft, bRight - bx + br);
          const overlapY = Math.min(by + br - bTop, bBottom - by + br);
          if (overlapX < overlapY) {
            s.ball.vx = -s.ball.vx;
            s.ball.x += s.ball.vx > 0 ? overlapX : -overlapX;
          } else {
            s.ball.vy = -s.ball.vy;
            s.ball.y += s.ball.vy > 0 ? overlapY : -overlapY;
          }

          // Damage brick
          brick.hp -= 1;
          brick.crackAnim = 1;

          const def = BRICK_DEFS[brick.type];
          if (brick.hp <= 0) {
            // Fully broken
            const pts = def.maxHp * 10 * levelRef.current;
            s.score += pts;
            setDisplayScore(s.score);
            s.particles.push(...spawnParticles(brick.x + brick.w / 2, brick.y + brick.h / 2, def.color, 14));
          } else {
            s.particles.push(...spawnParticles(brick.x + brick.w / 2, brick.y + brick.h / 2, def.color, 5));
          }
          break; // one brick per frame
        }

        // Check win: all bricks gone
        if (s.bricks.every(b => b.hp <= 0)) {
          updateHighScore(s.score);
          setDisplayScore(s.score);
          setPhase("won");
          phaseRef.current = "won";
        }
      }

      // Update crack animations
      for (const brick of s.bricks) {
        if (brick.crackAnim > 0) brick.crackAnim = Math.max(0, brick.crackAnim - dt * 4);
      }

      // Update particles
      for (const p of s.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 300 * dt; // gravity
        p.life -= dt * 1.8;
      }
      s.particles = s.particles.filter(p => p.life > 0);
    }

    // ── Render ──
    ctx.clearRect(0, 0, w, h);

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0d0d1a");
    bg.addColorStop(1, "#1a0d2e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Draw bricks
    for (const brick of s.bricks) {
      if (brick.hp <= 0) continue;
      const def = BRICK_DEFS[brick.type];
      const ratio = brick.hp / brick.maxHp;

      // Glow behind brick
      drawGlow(ctx, brick.x + brick.w / 2, brick.y + brick.h / 2, brick.w * 0.7, def.color);

      // Brick body — interpolate color based on hp ratio
      const flash = brick.crackAnim;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(brick.x + 1, brick.y + 1, brick.w - 2, brick.h - 2, 5);
      // Mix between dim and full color based on hp ratio + flash
      const r1 = parseInt(def.dim.slice(1, 3), 16);
      const g1 = parseInt(def.dim.slice(3, 5), 16);
      const b1 = parseInt(def.dim.slice(5, 7), 16);
      const r2 = parseInt(def.color.slice(1, 3), 16);
      const g2 = parseInt(def.color.slice(3, 5), 16);
      const b2 = parseInt(def.color.slice(5, 7), 16);
      const t = ratio + flash * 0.4;
      const r = Math.round(r1 + (r2 - r1) * Math.min(1, t));
      const g = Math.round(g1 + (g2 - g1) * Math.min(1, t));
      const b = Math.round(b1 + (b2 - b1) * Math.min(1, t));
      const grad = ctx.createLinearGradient(brick.x, brick.y, brick.x, brick.y + brick.h);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
      grad.addColorStop(1, `rgba(${Math.round(r * 0.6)},${Math.round(g * 0.6)},${Math.round(b * 0.6)},0.95)`);
      ctx.fillStyle = grad;
      ctx.fill();

      // Border highlight
      ctx.strokeStyle = hexToRgba(def.color, 0.6 + flash * 0.4);
      ctx.lineWidth = flash > 0.1 ? 2.5 : 1.5;
      ctx.stroke();

      // HP dots
      if (brick.maxHp > 1) {
        const dotR = 3;
        const spacing = 9;
        const totalW = brick.maxHp * dotR * 2 + (brick.maxHp - 1) * (spacing - dotR * 2);
        const startX = brick.x + brick.w / 2 - totalW / 2 + dotR;
        for (let i = 0; i < brick.maxHp; i++) {
          const dx = startX + i * spacing;
          const dy = brick.y + brick.h / 2;
          ctx.beginPath();
          ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
          ctx.fillStyle = i < brick.hp
            ? hexToRgba(def.color, 0.95)
            : hexToRgba(def.color, 0.2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Draw particles
    for (const p of s.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      drawGlow(ctx, p.x, p.y, p.size * 3, p.color);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    }

    // Draw paddle
    {
      const { x, y, w: pw, h: ph } = s.paddle;
      drawGlow(ctx, x + pw / 2, y + ph / 2, pw * 0.6, "#a29bfe");
      const pGrad = ctx.createLinearGradient(x, y, x, y + ph);
      pGrad.addColorStop(0, "#c8b8ff");
      pGrad.addColorStop(1, "#6c5ce7");
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, pw, ph, ph / 2);
      ctx.fillStyle = pGrad;
      ctx.fill();
      ctx.strokeStyle = "rgba(200,184,255,0.8)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Draw ball
    if (phaseRef.current === "playing") {
      const { x, y } = s.ball;
      drawGlow(ctx, x, y, BALL_RADIUS * 4, "#ffffff");
      const ballGrad = ctx.createRadialGradient(x - BALL_RADIUS * 0.3, y - BALL_RADIUS * 0.3, 1, x, y, BALL_RADIUS);
      ballGrad.addColorStop(0, "#ffffff");
      ballGrad.addColorStop(0.5, "#dfe6e9");
      ballGrad.addColorStop(1, "#b2bec3");
      ctx.beginPath();
      ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── Overlays ──
    if (phaseRef.current === "menu") {
      ctx.save();
      ctx.fillStyle = "rgba(10,10,26,0.75)";
      ctx.fillRect(0, 0, w, h);

      drawText(ctx, "BRICK BREAKER", w / 2, h * 0.28, {
        font: "bold 34px Fraunces, serif",
        color: "#a29bfe",
        shadow: "#a29bfe",
        shadowBlur: 24,
      });

      // Stone legend
      const legendY = h * 0.42;
      const items: { type: BrickType; label: string }[] = [
        { type: "blue",   label: "1 hit" },
        { type: "green",  label: "2 hits" },
        { type: "yellow", label: "3 hits" },
        { type: "pink",   label: "4 hits" },
        { type: "purple", label: "5 hits" },
      ];
      drawText(ctx, "Stone Types", w / 2, legendY - 20, { font: "14px Manrope, sans-serif", color: "#b2bec3" });
      items.forEach((item, i) => {
        const def = BRICK_DEFS[item.type];
        const lx = w / 2 - (items.length - 1) * 36 / 2 + i * 36;
        const ly = legendY + 20;
        drawGlow(ctx, lx, ly, 20, def.color);
        ctx.beginPath();
        ctx.roundRect(lx - 14, ly - 9, 28, 18, 4);
        ctx.fillStyle = def.color;
        ctx.fill();
        drawText(ctx, item.label, lx, ly + 26, { font: "11px Manrope, sans-serif", color: def.color });
      });

      drawText(ctx, "Click / Tap / Space to launch", w / 2, h * 0.68, {
        font: "15px Manrope, sans-serif",
        color: "#dfe6e9",
      });
      drawText(ctx, "← → Arrow Keys or Mouse to move paddle", w / 2, h * 0.73, {
        font: "13px Manrope, sans-serif",
        color: "#b2bec3",
      });
      if (highScore > 0) {
        drawText(ctx, `Best: ${highScore}`, w / 2, h * 0.79, {
          font: "14px Manrope, sans-serif",
          color: "#feca57",
          shadow: "#feca57",
          shadowBlur: 10,
        });
      }
      ctx.restore();
    }

    if (phaseRef.current === "won") {
      ctx.save();
      ctx.fillStyle = "rgba(10,10,26,0.78)";
      ctx.fillRect(0, 0, w, h);
      drawText(ctx, "LEVEL CLEAR!", w / 2, h * 0.35, {
        font: "bold 36px Fraunces, serif",
        color: "#1dd1a1",
        shadow: "#1dd1a1",
        shadowBlur: 28,
      });
      drawText(ctx, `Score: ${s.score}`, w / 2, h * 0.46, {
        font: "22px Manrope, sans-serif",
        color: "#feca57",
        shadow: "#feca57",
        shadowBlur: 12,
      });
      drawText(ctx, "Tap / Click for Next Level", w / 2, h * 0.58, {
        font: "16px Manrope, sans-serif",
        color: "#dfe6e9",
      });
      ctx.restore();
    }

    if (phaseRef.current === "lost") {
      ctx.save();
      ctx.fillStyle = "rgba(10,10,26,0.78)";
      ctx.fillRect(0, 0, w, h);
      drawText(ctx, "GAME OVER", w / 2, h * 0.35, {
        font: "bold 36px Fraunces, serif",
        color: "#ff6b6b",
        shadow: "#ff6b6b",
        shadowBlur: 28,
      });
      drawText(ctx, `Score: ${s.score}`, w / 2, h * 0.46, {
        font: "22px Manrope, sans-serif",
        color: "#feca57",
        shadow: "#feca57",
        shadowBlur: 12,
      });
      if (highScore > 0) {
        drawText(ctx, `Best: ${highScore}`, w / 2, h * 0.54, {
          font: "16px Manrope, sans-serif",
          color: "#a29bfe",
          shadow: "#a29bfe",
          shadowBlur: 10,
        });
      }
      drawText(ctx, "Tap / Click to Play Again", w / 2, h * 0.64, {
        font: "16px Manrope, sans-serif",
        color: "#dfe6e9",
      });
      ctx.restore();
    }

    // Score + level HUD (in-game)
    if (phaseRef.current === "playing") {
      drawText(ctx, `Score: ${s.score}`, 12, 18, {
        font: "14px Manrope, sans-serif",
        color: "#dfe6e9",
        align: "left",
        baseline: "top",
      });
      drawText(ctx, `Level ${levelRef.current}`, w - 12, 18, {
        font: "14px Manrope, sans-serif",
        color: "#a29bfe",
        align: "right",
        baseline: "top",
      });
      if (!s.launched) {
        drawText(ctx, "Click / Space to launch!", w / 2, h - 20, {
          font: "13px Manrope, sans-serif",
          color: "#b2bec3",
        });
      }
    }
  }, phase !== "playing" && phase !== "won" && phase !== "lost");

  // Click / tap handler for phase transitions
  const handleInteract = useCallback(() => {
    if (phaseRef.current === "menu") startGame();
    else if (phaseRef.current === "won") nextLevel();
    else if (phaseRef.current === "lost") startGame();
  }, [startGame, nextLevel]);

  return (
    <GameShell topbar={<GameTopbar title="Brick Breaker" score={displayScore} highScore={highScore} />}>
      <div
        ref={containerRef}
        className="w-full h-full relative overflow-hidden cursor-none"
        onClick={handleInteract}
        onTouchEnd={handleInteract}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
    </GameShell>
  );
}
