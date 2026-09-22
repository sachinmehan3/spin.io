import "./style.css";
import { Sounds, type SoundStyle } from "./game/sounds";
import { PlayerInput } from "./game/input";
import { goLandscape, isTouch, watchViewport } from "./game/viewport";
import { Renderer } from "./game/renderer";
import { COLORS, drawTop } from "./game/art";
import { loadBest, loadSoundStyle, loadIdentity, loadMuted, recordLife, saveSoundStyle, saveIdentity, saveMuted } from "./game/storage";
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

/** The colours a Player can pick for their Top. */
const STICKS: { name: string; color: string }[] = [
  { name: "Blue", color: COLORS.blue },
  { name: "Red", color: COLORS.red },
  { name: "Gold", color: COLORS.gold },
  { name: "Green", color: COLORS.green },
  { name: "Purple", color: COLORS.purple },
  { name: "Pink", color: COLORS.pink },
  { name: "Cyan", color: COLORS.cyan },
  { name: "White", color: COLORS.white },
];
const KNOCKOUT_TEXT: Record<KnockoutCause, { verb: string; by: string; alone: string }> = {
  burst: { verb: "You burst", by: "Burst by", alone: "You burst apart" },
  "ring-out": { verb: "You rang out", by: "Rung out by", alone: "You rolled out of the ring" },
  "spin-out": { verb: "You spun out", by: "Spun out by", alone: "You ran out of spin" },
};
const TYPE_INFO: Record<TopType, { label: string; blurb: string }> = {
  attack: { label: "Attack", blurb: "Quick, with a hard dash. Tires fast." },
  defense: { label: "Defense", blurb: "Heavy and hard to shove. Slow." },
  stamina: { label: "Stamina", blurb: "Spins for ages. Hits softly." },
};
const SCRIBBLE = `<svg class="scribble" aria-hidden="true"><use href="#scribble" width="100%" height="100%" /></svg>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("game");
const renderer = new Renderer(canvas, $<HTMLCanvasElement>("minimap"));
watchViewport();
const input = new PlayerInput(canvas, {
  zone: $("joy-zone"),
  base: $("joy-base"),
  knob: $("joy-knob"),
  dash: $("dash-button"),
});
if (isTouch) $("controls-note").textContent = "Left thumb steers. Tap dash on the right to dash.";
const sound = new Sounds();

const world = createWorld({ seed: Date.now() % 2 ** 31, bots: BOT_COUNT, pickups: PICKUP_COUNT });
let player: Top | null = null;
let spawnedAt = 0;
let identity: Identity = loadIdentity() ?? { name: "", color: COLORS.blue, type: "attack" };
// Older saves may hold a colour from an earlier palette.
if (!STICKS.some((s) => s.color === identity.color)) identity = { ...identity, color: COLORS.blue };
let resultsDueAt: number | null = null;
let lastKnockout: { cause: KnockoutCause; by: string | null; time: number; newBest: boolean } | null = null;

// ---------- Spawn screen ----------

const nameInput = $<HTMLInputElement>("name");
nameInput.value = identity.name;

const swatches = $("swatches");
for (const { name, color } of STICKS) {
  const b = document.createElement("button");
  b.className = "stick";
  b.style.setProperty("--stick", color);
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", name);
  b.addEventListener("click", () => {
    identity = { ...identity, color };
    refreshChoices();
  });
  swatches.appendChild(b);
}

const typeButtons = new Map<TopType, { button: HTMLButtonElement; preview: HTMLCanvasElement }>();
for (const type of TOP_TYPES) {
  const button = document.createElement("button");
  button.className = "type chalk-text";
  button.setAttribute("role", "radio");
  const preview = document.createElement("canvas");
  preview.width = 152;
  preview.height = 152;
  button.append(preview);
  button.insertAdjacentHTML(
    "beforeend",
    `<b>${TYPE_INFO[type].label}</b><small>${TYPE_INFO[type].blurb}</small>${SCRIBBLE}`,
  );
  button.addEventListener("click", () => {
    identity = { ...identity, type };
    refreshChoices();
  });
  $("types").appendChild(button);
  typeButtons.set(type, { button, preview });
}

function refreshChoices() {
  swatches.querySelectorAll<HTMLButtonElement>(".stick").forEach((b, i) => {
    b.setAttribute("aria-checked", String(STICKS[i].color === identity.color));
  });
  for (const [type, { button }] of typeButtons) button.setAttribute("aria-checked", String(type === identity.type));
  const best = loadBest();
  $("best").textContent =
    best.peakMaxSpin > 0
      ? `Your best so far: grew to ${Math.round(best.peakMaxSpin)} spin and knocked out ${best.knockouts}.`
      : "";
}

/** Keeps the Top Type previews spinning on the spawn screen. */
function animatePreviews(time: number) {
  for (const [type, { preview }] of typeButtons) {
    const ctx = preview.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.translate(preview.width / 2, preview.height / 2);
    drawTop(ctx, type, identity.color, 54, time * 0.006);
  }
}

function play() {
  identity = { ...identity, name: nameInput.value.trim().slice(0, 14) || "Player" };
  saveIdentity(identity);
  sound.unlock();
  sound.launch();
  void goLandscape();
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

// ---------- Sound toggles ----------

const muteButton = $<HTMLButtonElement>("mute");
function applyMute(muted: boolean) {
  sound.setMuted(muted);
  saveMuted(muted);
  muteButton.textContent = muted ? "sound off" : "sound on";
}
muteButton.addEventListener("click", () => applyMute(!sound.muted));
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !(e.target instanceof HTMLInputElement)) applyMute(!sound.muted);
});
applyMute(loadMuted());

const styleButton = $<HTMLButtonElement>("sound-style");
function applySoundStyle(style: SoundStyle) {
  sound.setStyle(style);
  saveSoundStyle(style);
  styleButton.textContent = `sounds: ${style}`;
}
styleButton.addEventListener("click", () => applySoundStyle(sound.style === "heavy" ? "classic" : "heavy"));
applySoundStyle(loadSoundStyle());

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
      toast(`${KNOCKOUT_TEXT[e.cause].verb} ${nameOf(e.victim)}!`);
    }
  }
}

function toast(text: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("feed").prepend(el);
  setTimeout(() => el.remove(), 2400);
}

function showResults() {
  if (!player || !lastKnockout) return;
  const { cause, by, time, newBest } = lastKnockout;
  const text = KNOCKOUT_TEXT[cause];
  $("cause-detail").textContent = by ? `${text.by} ${by}` : text.alone;
  $("r-kos").innerHTML = tally(player.knockouts);
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

/** Knockouts counted the playground way: tally marks in fives. Big numbers are just written. */
function tally(n: number): string {
  if (n === 0 || n > 20) return `<span class="count">${n}</span>`;
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.floor(i / 5) * 44 + (i % 5) * 8 + 4;
    if (i % 5 === 4) {
      lines.push(`<line x1="${x - 36}" y1="20" x2="${x - 2}" y2="6" />`);
    } else {
      const lean = ((i * 7) % 3) - 1;
      lines.push(`<line x1="${x}" y1="3" x2="${x + lean}" y2="24" />`);
    }
  }
  const width = Math.ceil(n / 5) * 44;
  return `<svg viewBox="0 0 ${width} 27" width="${width}" role="img" aria-label="${n}" stroke="currentColor" stroke-width="3" stroke-linecap="round">${lines.join("")}</svg>`;
}

let shownKnockouts = -1;

// ---------- HUD ----------

let boardRefreshAt = 0;

function updateHud() {
  if (!player?.alive) return;
  const frac = player.spin / player.maxSpin;
  const fill = $("spin-fill");
  fill.style.width = `${frac * 100}%`;
  fill.classList.toggle("low", frac < 0.3);
  $("spin-text").textContent = String(Math.ceil(player.spin));

  const wait = Math.max(0, player.dashReadyAt - world.time);
  $("dash-fill").style.width = `${(1 - wait / CONFIG.dashCooldown) * 100}%`;
  $("dash-text").textContent = wait > 0 ? `${wait.toFixed(1)}s` : "ready";
  const dashButton = $("dash-button");
  dashButton.classList.toggle("cooling", wait > 0);
  dashButton.style.setProperty("--charge", String(1 - wait / CONFIG.dashCooldown));
  if (player.knockouts !== shownKnockouts) {
    shownKnockouts = player.knockouts;
    $("ko-count").innerHTML = tally(player.knockouts);
  }

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
  const who = document.createElement("span");
  who.className = "who";
  who.style.setProperty("--dot", t.color);
  who.textContent = t.name;
  li.innerHTML = `<span class="rank">${rank}</span>`;
  li.append(who);
  li.insertAdjacentHTML("beforeend", `<span class="size">${Math.round(t.maxSpin)}</span>`);
  return li;
}

// ---------- Loop ----------

let lastFrameTime = performance.now();
let accumulator = 0;

function frame(now: number) {
  const elapsed = Math.min(MAX_FRAME_TIME, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  // A heavy hit freezes the action for a split second (hit-stop), then play resumes.
  if (renderer.hitStop > 0) renderer.hitStop -= elapsed;
  else accumulator += elapsed;

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
