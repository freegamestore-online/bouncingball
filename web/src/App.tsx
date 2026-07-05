import { useCallback, useEffect, useRef, useState } from "react";
import { GameShell, GameTopbar, useGameSounds } from "@freegamestore/games";
import { useGameLoop } from "./hooks/useGameLoop";
import { useControls } from "./hooks/useControls";
import { useHighScore } from "./hooks/useHighScore";
import { clamp, dist, drawGlow, drawText, randomInRange } from "./lib/canvas";

// ─── Tuning ───────────────────────────────────────────────────────────────────
const GRAVITY = 1400; // px/s²
const BALL_RADIUS = 16;
const PADDLE_W = 120;
const PADDLE_H = 16;
const PADDLE_Y_FROM_BOTTOM = 60;
const ORB_RADIUS = 14;
const BOUNCE_SPEEDUP = 1.03; // paddle bounce accelerates the ball
const MAX_FALL = 1500;

type Phase = "menu" | "playing" | "dead";

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Orb {
  x: number;
  y: number;
  hue: string;
  pulse: number;
}

interface GameState {
  ball: Ball;
  orb: Orb;
  paddleX: number;
  score: number;
  trail: { x: number; y: number }[];
}

function randomOrb(w: number, h: number): Orb {
  const hues = ["#feca57", "#48dbfb", "#ff9ff3", "#1dd1a1", "#54a0ff"];
  return {
    x: randomInRange(ORB_RADIUS + 20, w - ORB_RADIUS - 20),
    y: randomInRange(h * 0.15, h * 0.55),
    hue: hues[Math.floor(Math.random() * hues.length)]!,
    pulse: 0,
  };
}

function createState(w: number, h: number): GameState {
  return {
    ball: { x: w / 2, y: h * 0.3, vx: randomInRange(-180, 180), vy: 0 },
    orb: randomOrb(w, h),
    paddleX: w / 2,
    score: 0,
    trail: [],
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const controls = useControls();
  const sounds = useGameSounds();

  const [phase, setPhase] = useState<Phase>("menu");
  const [score, setScore] = useState(0);
  const [highScore, updateHighScore] = useHighScore("bouncingball_highscore");

  // ── Canvas sizing (device-pixel-ratio aware) ───────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      const ctx = canvas!.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const start = useCallback(() => {
    const { w, h } = sizeRef.current;
    stateRef.current = createState(w, h);
    setScore(0);
    setPhase("playing");
  }, []);

  // ── Simulation ──────────────────────────────────────────────────────────────
  const step = useCallback(
    (dt: number) => {
      const canvas = canvasRef.current;
      const state = stateRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h } = sizeRef.current;
      const paddleY = h - PADDLE_Y_FROM_BOTTOM;

      if (state && phase === "playing") {
        // Paddle follows pointer (mouse/touch); arrow keys as fallback.
        const rect = canvas.getBoundingClientRect();
        let target = state.paddleX;
        if (controls.touch.active) target = controls.touch.x - rect.left;
        else if (controls.mouse.down || controls.mouse.x > 0) target = controls.mouse.x - rect.left;
        if (controls.keys.has("ArrowLeft")) target -= 600 * dt;
        if (controls.keys.has("ArrowRight")) target += 600 * dt;
        state.paddleX = clamp(target, PADDLE_W / 2, w - PADDLE_W / 2);

        const b = state.ball;
        b.vy = clamp(b.vy + GRAVITY * dt, -MAX_FALL, MAX_FALL);
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Walls
        if (b.x < BALL_RADIUS) {
          b.x = BALL_RADIUS;
          b.vx = Math.abs(b.vx);
          sounds.playTick();
        } else if (b.x > w - BALL_RADIUS) {
          b.x = w - BALL_RADIUS;
          b.vx = -Math.abs(b.vx);
          sounds.playTick();
        }
        // Ceiling
        if (b.y < BALL_RADIUS) {
          b.y = BALL_RADIUS;
          b.vy = Math.abs(b.vy) * 0.6;
        }

        // Paddle collision (only while descending)
        if (
          b.vy > 0 &&
          b.y + BALL_RADIUS >= paddleY &&
          b.y + BALL_RADIUS <= paddleY + PADDLE_H + 12 &&
          b.x >= state.paddleX - PADDLE_W / 2 - BALL_RADIUS &&
          b.x <= state.paddleX + PADDLE_W / 2 + BALL_RADIUS
        ) {
          b.y = paddleY - BALL_RADIUS;
          b.vy = -Math.abs(b.vy) * BOUNCE_SPEEDUP;
          // English: hitting off-center adds horizontal steer
          const offset = (b.x - state.paddleX) / (PADDLE_W / 2);
          b.vx = clamp(b.vx + offset * 260, -700, 700);
          state.score += 1;
          setScore(state.score);
          sounds.playMove();
        }

        // Orb collection
        state.orb.pulse += dt * 4;
        if (dist(b.x, b.y, state.orb.x, state.orb.y) < BALL_RADIUS + ORB_RADIUS) {
          state.score += 5;
          setScore(state.score);
          state.orb = randomOrb(w, h);
          sounds.playScore();
        }

        // Trail
        state.trail.push({ x: b.x, y: b.y });
        if (state.trail.length > 14) state.trail.shift();

        // Fell below paddle → game over
        if (b.y - BALL_RADIUS > h) {
          updateHighScore(state.score);
          sounds.playGameOver();
          setPhase("dead");
        }
      }

      // ── Render ────────────────────────────────────────────────────────────────
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#0b1026");
      grad.addColorStop(1, "#161a3a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      if (state) {
        // Orb
        const orbR = ORB_RADIUS + Math.sin(state.orb.pulse) * 2;
        drawGlow(ctx, state.orb.x, state.orb.y, 46, state.orb.hue);
        ctx.beginPath();
        ctx.arc(state.orb.x, state.orb.y, orbR, 0, Math.PI * 2);
        ctx.fillStyle = state.orb.hue;
        ctx.fill();

        // Ball trail
        state.trail.forEach((p, i) => {
          const a = (i / state.trail.length) * 0.35;
          ctx.beginPath();
          ctx.arc(p.x, p.y, BALL_RADIUS * (i / state.trail.length), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,107,107,${a})`;
          ctx.fill();
        });

        // Ball
        drawGlow(ctx, state.ball.x, state.ball.y, 44, "#ff6b6b");
        ctx.beginPath();
        ctx.arc(state.ball.x, state.ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#ff6b6b";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(state.ball.x - 5, state.ball.y - 5, BALL_RADIUS * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();

        // Paddle
        const px = state.paddleX - PADDLE_W / 2;
        ctx.fillStyle = "#48dbfb";
        ctx.shadowColor = "#48dbfb";
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.roundRect(px, paddleY, PADDLE_W, PADDLE_H, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Overlays
      if (phase === "menu") {
        drawText(ctx, "Bouncing Ball", w / 2, h / 2 - 40, {
          font: "700 40px Fraunces, serif",
          color: "#ffffff",
          shadow: "#000",
          shadowBlur: 12,
        });
        drawText(ctx, "Move the paddle — keep the ball alive", w / 2, h / 2 + 6, {
          font: "16px Manrope, sans-serif",
          color: "#c7cbe8",
        });
        drawText(ctx, "Tap / Click to start", w / 2, h / 2 + 46, {
          font: "600 18px Manrope, sans-serif",
          color: "#48dbfb",
        });
      } else if (phase === "dead") {
        drawText(ctx, "Game Over", w / 2, h / 2 - 30, {
          font: "700 40px Fraunces, serif",
          color: "#ff6b6b",
          shadow: "#000",
          shadowBlur: 12,
        });
        drawText(ctx, `Score ${score}   ·   Best ${Math.max(highScore, score)}`, w / 2, h / 2 + 14, {
          font: "18px Manrope, sans-serif",
          color: "#ffffff",
        });
        drawText(ctx, "Tap / Click to play again", w / 2, h / 2 + 52, {
          font: "600 16px Manrope, sans-serif",
          color: "#48dbfb",
        });
      }
    },
    [phase, score, highScore, controls, sounds, updateHighScore],
  );

  useGameLoop(step);

  // Start / restart on pointer or key when not playing.
  useEffect(() => {
    if (phase === "playing") return;
    function go() {
      start();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Enter") go();
    }
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", onKey);
    };
  }, [phase, start]);

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Bouncing Ball"
          stats={[
            { label: "Score", value: score, accent: true },
            { label: "Best", value: Math.max(highScore, score) },
          ]}
          rules={
            <div style={{ lineHeight: 1.6 }}>
              <p>Keep the bouncing ball alive!</p>
              <ul>
                <li>Move the paddle with your mouse, finger, or ← → keys.</li>
                <li>Bounce the ball off the paddle — each hit scores +1.</li>
                <li>Catch glowing orbs for +5.</li>
                <li>Every paddle hit speeds the ball up. Don't let it fall.</li>
              </ul>
            </div>
          }
          onRestart={phase === "playing" ? start : undefined}
        />
      }
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }} />
    </GameShell>
  );
}
