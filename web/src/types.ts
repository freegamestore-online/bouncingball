export type BrickType = "blue" | "green" | "yellow" | "pink" | "purple";

export interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  type: BrickType;
  hp: number;
  maxHp: number;
  crackAnim: number; // 0–1 flash on hit
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Paddle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0–1
  color: string;
  size: number;
}

export type Phase = "menu" | "playing" | "won" | "lost";
