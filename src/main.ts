import "./style.css";
import { Sound } from "./game/audio";
import { PlayerInput } from "./game/input";
import { Renderer } from "./game/renderer";
import { drawTopBody } from "./game/shapes";
import { loadBest, loadIdentity, loadMuted, recordLife, saveIdentity, saveMuted } from "./game/storage";
import {
  CONFIG,
  createWorld,
  leaderboard,
  spawnTop,
  step,
  TOP_TYPES,
  type Identity,
  type KnockoutCause,
  type SimEvent,
  type Top,
  type TopId,
  type TopType,
} from "./sim";

const BOT_COUNT = 15;
const PICKUP_COUNT = 160;
/** Seconds between the Player's Knockout and the results screen, so the effect can play. */
const RESULTS_DELAY = 1.3;
/** Longest real time simulated in one frame (e.g. after the tab was in the background). */
const MAX_FRAME_TIME = 0.25;

const COLORS = ["#4cc9f0", "#f72585", "#7bf1a8", "#ffb547", "#9d8cff", "#ff5d73", "#ffe45e", "#ffffff"];
const KNOCKOUT_TEXT: Record<KnockoutCause, { title: string; verb: string; by: string; alone: string }> = {
  burst: { title: "Burst", verb: "Burst", by: "Shattered by", alone: "Shattered" },
  "ring-out": { title: "Ring-out", verb: "Rang out", by: "Knocked out by", alone: "Fell off the Rim" },
  "spin-out": { title: "Spin-out", verb: "Spun out", by: "Spun out by", alone: "Ran out of Spin" },
};
const TYPE_INFO: Record<TopType, { label: string; blurb: string }> = {
  attack: { label: "Attack", blurb: "Fast, hard Dash. Loses Spin quickly." },
  defense: { label: "Defense", blurb: "Heavy, hard to push. Slow." },
  stamina: { label: "Stamina", blurb: "Loses Spin slowly. Hits softly." },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("game");
const renderer = new Renderer(canvas, $<HTMLCanvasElement>("minimap"));
const input = new PlayerInput(canvas);
const sound = new Sound();

const world = createWorld({ seed: Date.now() % 2 ** 31, bots: BOT_COUNT, pickups: PICKUP_COUNT });
let player: Top | null = null;
let spawnedAt = 0;
let identity: Identity = loadIdentity() ?? { name: "", color: COLORS[0], type: "attack" };
let resultsDueAt: number | null = null;
let lastKnockout: { cause: KnockoutCause; by: string | null; time: number; newBest: boolean } | null = null;

// ---------- Spawn screen ----------

const nameInput = $<HTMLInputElement>("name");
nameInput.value = identity.name;

const swatches = $("swatches");
for (const color of COLORS) {
  const b = document.createElement("button");
  b.className = "swatch";
  b.style.background = color;
  b.style.color = color;
  b.setAttribute("aria-label", `Colour ${color}`);
  b.addEventListener("click", () => {
    identity = { ...identity, color };
    refreshChoices();
  });
  swatches.appendChild(b);
}

const typeButtons = new Map<TopType, { button: HTMLButtonElement; preview: HTMLCanvasElement }>();
for (const type of TOP_TYPES) {
  const button = document.createElement("button");
  button.className = "type";
  const preview = document.createElement("canvas");
  preview.width = 64;
  preview.height = 64;
  button.append(preview);
  button.insertAdjacentHTML(
    "beforeend",
    `<b>${TYPE_INFO[type].label}</b><small>${TYPE_INFO[type].blurb}</small>`,
  );
  button.addEventListener("click", () => {
    identity = { ...identity, type };
    refreshChoices();
  });
  $("types").appendChild(button);
  typeButtons.set(type, { button, preview });
}

function refreshChoices() {
  swatches.querySelectorAll<HTMLButtonElement>(".swatch").forEach((b, i) => {
    b.classList.toggle("selected", COLORS[i] === identity.color);
  });
  for (const [type, { button }] of typeButtons) button.classList.toggle("selected", type === identity.type);
  const best = loadBest();
  $("best").textContent =
    best.peakMaxSpin > 0
      ? `Personal best: ${Math.round(best.peakMaxSpin)} Max Spin · ${best.knockouts} Knockouts`
      : "";
}

/** Keeps the Top Type previews spinning on the spawn screen. */
function animatePreviews(time: number) {
  for (const [type, { preview }] of typeButtons) {
    const ctx = preview.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 64, 64);
    ctx.translate(32, 32);
    drawTopBody(ctx, type, identity.color, 22, time * 0.012);
  }
}

function play() {
  identity = { ...identity, name: nameInput.value.trim().slice(0, 14) || "Player" };
  saveIdentity(identity);
  sound.unlock();
  input.clear();
  player = spawnTop(world, identity);
  spawnedAt = world.time;
  resultsDueAt = null;
  lastKnockout = null;
  $("spawn").classList.add("hidden");
  $("results").classList.add("hidden");
  $("hud").classList.remove("hidden");
  $("feed").replaceChildren();
}

$("play").addEventListener("click", play);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") play();
});
$("again").addEventListener("click", play);
$("change").addEventListener("click", () => {
  player = null;
  $("results").classList.add("hidden");
  $("spawn").classList.remove("hidden");
  refreshChoices();
});

// ---------- Sound toggle ----------

const muteButton = $<HTMLButtonElement>("mute");
function applyMute(muted: boolean) {
  sound.setMuted(muted);
  saveMuted(muted);
  muteButton.textContent = muted ? "SOUND OFF" : "SOUND ON";
}
muteButton.addEventListener("click", () => applyMute(!sound.muted));
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !(e.target instanceof HTMLInputElement)) applyMute(!sound.muted);
});
applyMute(loadMuted());

// ---------- Player's fate ----------

/** Names of every Top seen, since knocked-out Tops leave the world before their events are read. */
const names = new Map<TopId, string>();
const rememberNames = () => world.tops.forEach((t) => names.set(t.id, t.name));
const nameOf = (id: TopId | null) => (id === null ? null : (names.get(id) ?? null));

function watchPlayer(events: SimEvent[]) {
  if (!player) return;
  for (const e of events) {
    if (e.type !== "knockout") continue;
    if (e.victim === player.id) {
      const newBest = recordLife({ peakMaxSpin: player.maxSpin, knockouts: player.knockouts });
      lastKnockout = { cause: e.cause, by: nameOf(e.credit), time: world.time, newBest };
      resultsDueAt = world.time + RESULTS_DELAY;
    } else if (e.credit === player.id) {
      toast(`${KNOCKOUT_TEXT[e.cause].verb} ${nameOf(e.victim)}!`, true);
    }
  }
}

function toast(text: string, good = false) {
  const el = document.createElement("div");
  el.className = `toast${good ? " good" : ""}`;
  el.textContent = text;
  $("feed").prepend(el);
  setTimeout(() => el.remove(), 2400);
}

function showResults() {
  if (!player || !lastKnockout) return;
  const { cause, by, time, newBest } = lastKnockout;
  const text = KNOCKOUT_TEXT[cause];
  $("cause").textContent = text.title;
  $("cause-detail").textContent = by ? `${text.by} ${by}` : text.alone;
  $("r-kos").textContent = String(player.knockouts);
  $("r-peak").textContent = String(Math.round(player.maxSpin));
  $("r-time").textContent = formatTime(time - spawnedAt);
  $("new-best").classList.toggle("hidden", !newBest);
  $("hud").classList.add("hidden");
  $("results").classList.remove("hidden");
}

function formatTime(seconds: number) {
  const s = Math.floor(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// ---------- HUD ----------

let boardRefreshAt = 0;

function updateHud() {
  if (!player?.alive) return;
  const frac = player.spin / player.maxSpin;
  const fill = $("spin-fill");
  fill.style.width = `${frac * 100}%`;
  fill.classList.toggle("low", frac < 0.3);
  $("spin-text").textContent = `${Math.ceil(player.spin)} / ${Math.round(player.maxSpin)}`;

  const wait = Math.max(0, player.dashReadyAt - world.time);
  $("dash-fill").style.width = `${(1 - wait / CONFIG.dashCooldown) * 100}%`;
  $("dash-text").textContent = wait > 0 ? `${wait.toFixed(1)}s` : "READY";
  $("ko-count").textContent = String(player.knockouts);

  if (world.time < boardRefreshAt) return;
  boardRefreshAt = world.time + 0.25;
  const ranked = leaderboard(world, Infinity);
  const rows = ranked.slice(0, 10).map((t, i) => boardRow(i + 1, t));
  const rank = ranked.indexOf(player) + 1;
  if (rank > 10) rows.push(boardRow(rank, player));
  $("board").replaceChildren(...rows);
}

function boardRow(rank: number, t: Top) {
  const li = document.createElement("li");
  if (t === player) li.className = "me";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = t.color;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = t.name;
  li.innerHTML = `<span class="rank">${rank}</span>`;
  li.append(dot, who);
  li.insertAdjacentHTML("beforeend", `<span class="size">${Math.round(t.maxSpin)}</span>`);
  return li;
}

// ---------- Loop ----------

let lastFrameTime = performance.now();
let accumulator = 0;

function frame(now: number) {
  const elapsed = Math.min(MAX_FRAME_TIME, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  accumulator += elapsed;

  while (accumulator >= CONFIG.dt) {
    const inputs = player?.alive ? { [player.id]: input.take(renderer.worldToScreen(player.pos)) } : {};
    rememberNames();
    const events = step(world, inputs);
    renderer.react(events, player?.id ?? null);
    sound.react(events, player, player?.pos ?? { x: 0, y: 0 });
    watchPlayer(events);
    accumulator -= CONFIG.dt;
  }

  if (resultsDueAt !== null && world.time >= resultsDueAt) {
    resultsDueAt = null;
    showResults();
  }

  renderer.render(world, player, elapsed);
  sound.updateHum(player);
  updateHud();
  if (!$("spawn").classList.contains("hidden")) animatePreviews(now);
  requestAnimationFrame(frame);
}

// A life cut short by closing the tab still counts toward the personal best.
window.addEventListener("pagehide", () => {
  if (player?.alive) recordLife({ peakMaxSpin: player.maxSpin, knockouts: player.knockouts });
});

refreshChoices();
requestAnimationFrame(frame);
