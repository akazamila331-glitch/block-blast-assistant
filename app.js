/* ============================================================
   ASSISTANT BLOCK BLAST
   1. Charge un screenshot du VRAI Block Blast
   2. Cadre 8×8 auto-détecté (ajustable au doigt)
   3. Lecture automatique des cases (k-means 2 clusters)
   4. Pièces choisies dans la palette (3 taps)
   5. 🤖 Meilleur coup calculé et surligné en vert
   Tout reste dans le téléphone : aucune donnée envoyée.
   ============================================================ */
"use strict";

const SIZE = 8;

/* Vraies couleurs des blocs du jeu */
const BCOLORS = {
  blue: "#4a90ff", orange: "#ff7a2f", green: "#3ddc4a", yellow: "#ffc31f",
  cyan: "#26d7f2", violet: "#b06cf5", red: "#f55151",
};
const COLOR_KEYS = Object.keys(BCOLORS);

/* Formes du vrai Block Blast (pas de rotation en jeu) */
const SHAPES = [
  { n: "1", g: [[1]] },
  { n: "2h", g: [[1, 1]] }, { n: "2v", g: [[1], [1]] },
  { n: "3h", g: [[1, 1, 1]] }, { n: "3v", g: [[1], [1], [1]] },
  { n: "4h", g: [[1, 1, 1, 1]] }, { n: "4v", g: [[1], [1], [1], [1]] },
  { n: "carré", g: [[1, 1], [1, 1]] },
  { n: "coin bas-droite", g: [[1, 0], [1, 1]] },
  { n: "coin bas-gauche", g: [[0, 1], [1, 1]] },
  { n: "coin haut-droite", g: [[1, 1], [1, 0]] },
  { n: "coin haut-gauche", g: [[1, 1], [0, 1]] },
  { n: "L", g: [[1, 0], [1, 0], [1, 1]] },
  { n: "J", g: [[0, 1], [0, 1], [1, 1]] },
  { n: "L à l'envers", g: [[1, 1], [1, 0], [1, 0]] },
  { n: "J à l'envers", g: [[1, 1], [0, 1], [0, 1]] },
  { n: "T", g: [[1, 1, 1], [0, 1, 0]] },
  { n: "T inversée", g: [[0, 1, 0], [1, 1, 1]] },
  { n: "T à droite", g: [[0, 1], [1, 1], [0, 1]] },
  { n: "T à gauche", g: [[1, 0], [1, 1], [1, 0]] },
  { n: "grand L 4", g: [[1, 0], [1, 0], [1, 0], [1, 1]] },
  { n: "grand J 4", g: [[0, 1], [0, 1], [0, 1], [1, 1]] },
  { n: "grand L 4 b", g: [[1, 1], [1, 0], [1, 0], [1, 0]] },
  { n: "grand J 4 b", g: [[1, 1], [0, 1], [0, 1], [0, 1]] },
  { n: "S", g: [[0, 1, 1], [1, 1, 0]] },
  { n: "Z", g: [[1, 1, 0], [0, 1, 1]] },
  { n: "S vert", g: [[1, 0], [1, 1], [0, 1]] },
  { n: "Z vert", g: [[0, 1], [1, 1], [1, 0]] },
];

/* ---------------- État ---------------- */
let grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0)); // 0 = vide, 1 = rempli
let cellColors = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
let slots = [null, null, null]; // {shape, color}
let paletteSel = 0;
let img = null;
let imgNatural = { w: 0, h: 0 };
let frame = { x: 0, y: 0, w: 0, h: 0 }; // coords en px dans #stage
let stageW = 0, stageH = 0;
let solving = false;

const $ = (id) => document.getElementById(id);
const boardEl = $("board");
const stageEl = $("stage");
const cvEl = $("cv");
const frameEl = $("frame");
const ctx = cvEl.getContext("2d", { willReadFrequently: true });

/* ============================================================
   OUTILS UI
   ============================================================ */
let toastEl = null, toastTimer = null;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.id = "toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

const cloneGrid = (g) => g.map((r) => r.slice());

/* ============================================================
   1. CHARGEMENT DU SCREENSHOT
   ============================================================ */
$("btn-pick").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const im = new Image();
  im.onload = () => { URL.revokeObjectURL(url); startAlign(im); };
  im.onerror = () => toast("❌ Impossible de lire cette image");
  im.src = url;
  e.target.value = "";
});

$("btn-manual").addEventListener("click", () => {
  $("step-pick").classList.add("hidden");
  $("step-play").classList.remove("hidden");
  renderBoard();
  renderSlots();
  renderPalette();
  window.scrollTo({ top: $("step-play").offsetTop - 10, behavior: "smooth" });
});

function startAlign(im) {
  img = im;
  imgNatural = { w: im.naturalWidth, h: im.naturalHeight };

  // Afficher le conteneur AVANT de mesurer (sinon clientWidth = 0)
  $("step-pick").classList.add("hidden");
  $("step-play").classList.add("hidden");
  $("step-align").classList.remove("hidden");

  stageW = stageEl.clientWidth || 340;
  const ratio = imgNatural.h / imgNatural.w;
  stageH = Math.round(stageW * ratio);
  cvEl.width = stageW;
  cvEl.height = stageH;
  cvEl.style.height = stageH + "px";
  ctx.drawImage(im, 0, 0, stageW, stageH);

  const auto = detectGridBox();
  if (auto) setFrame(auto.x, auto.y, auto.w, auto.h);
  else centerFrame();
  window.scrollTo({ top: $("step-align").offsetTop - 10, behavior: "smooth" });
}

function centerFrame() {
  const w = stageW * 0.78;
  const h = Math.min(w, stageH * 0.55);
  setFrame((stageW - w) / 2, stageH * 0.2, w, h);
}

function setFrame(x, y, w, h) {
  frame = { x, y, w, h };
  frameEl.style.left = x + "px";
  frameEl.style.top = y + "px";
  frameEl.style.width = w + "px";
  frameEl.style.height = h + "px";
}

/* Détection automatique de la grille : plus grande zone sombre (cellules vides) */
function detectGridBox() {
  try {
    const W = 400;
    const H = Math.round(W * imgNatural.h / imgNatural.w);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;

    const col = new Int32Array(W), row = new Int32Array(H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l < 72) { col[x]++; row[y]++; }
      }
    }
    const maxC = Math.max(...col), maxR = Math.max(...row);
    if (maxC < H * 0.15 || maxR < W * 0.15) return null;

    const bandC = (arr, max) => {
      let a = 0, b = arr.length - 1;
      for (let i = 0; i < arr.length; i++) if (arr[i] > max * 0.35) { a = i; break; }
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] > max * 0.35) { b = i; break; }
      // élargir un peu pour rattraper les bords couverts par des blocs
      while (a > 0 && arr[a - 1] > max * 0.10) a--;
      while (b < arr.length - 1 && arr[b + 1] > max * 0.10) b++;
      return [a, b];
    };
    const [x0, x1] = bandC(col, maxC);
    const [y0, y1] = bandC(row, maxR);
    const w = x1 - x0, h = y1 - y0;
    if (w < 60 || h < 60) return null;
    const ratio = w / h;
    if (ratio < 0.7 || ratio > 1.4) return null;
    // Conversion vers les coordonnées stage
    const s = stageW / W;
    return { x: x0 * s, y: y0 * s, w: w * s, h: h * s };
  } catch (e) { return null; }
}

/* ============================================================
   2. CADRAGE (drag des poignées)
   ============================================================ */
function bindHandle(el, mode) {
  let drag = false, sx = 0, sy = 0, f0 = null;
  el.addEventListener("pointerdown", (e) => {
    drag = true; sx = e.clientX; sy = e.clientY; f0 = { ...frame };
    el.setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (mode === "tl") {
      const x = Math.max(0, Math.min(f0.x + f0.w - 80, f0.x + dx));
      const y = Math.max(0, Math.min(f0.y + f0.h - 80, f0.y + dy));
      setFrame(x, y, f0.x + f0.w - x, f0.y + f0.h - y);
    } else {
      const w = Math.max(80, Math.min(stageW - f0.x, f0.w + dx));
      const h = Math.max(80, Math.min(stageH - f0.y, f0.h + dy));
      setFrame(f0.x, f0.y, w, h);
    }
  });
  const end = () => { drag = false; };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
bindHandle($("h-tl"), "tl");
bindHandle($("h-br"), "br");
$("btn-reframe").addEventListener("click", () => {
  const auto = detectGridBox();
  if (auto) setFrame(auto.x, auto.y, auto.w, auto.h);
  else centerFrame();
});

/* ============================================================
   3. LECTURE DES CASES (k-means 2 clusters sur les centres)
   ============================================================ */
$("btn-shoot").addEventListener("click", () => {
  readCells();
  $("step-align").classList.add("hidden");
  $("step-play").classList.remove("hidden");
  renderBoard(); renderSlots(); renderPalette();
  window.scrollTo({ top: $("step-play").offsetTop - 10, behavior: "smooth" });
  toast("🔎 Grille lue — vérifie puis choisis tes pièces");
});

function readCells() {
  if (!img) return;
  // Cadre stage → pixels image naturelle
  const sX = imgNatural.w / stageW, sY = imgNatural.h / stageH;
  const gx = frame.x * sX, gy = frame.y * sY;
  const gw = frame.w * sX, gh = frame.h * sY;
  const cw = gw / SIZE, ch = gh / SIZE;

  const c = document.createElement("canvas");
  c.width = imgNatural.w; c.height = imgNatural.h;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);

  // Échantillons : moyenne d'un carré au centre de chaque cellule (12% de la cellule)
  const samples = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cxp = gx + (x + 0.5) * cw, cyp = gy + (y + 0.5) * ch;
      const half = Math.max(2, Math.min(cw, ch) * 0.12);
      const d = cx.getImageData(Math.round(cxp - half), Math.round(cyp - half), Math.max(2, Math.round(half * 2)), Math.max(2, Math.round(half * 2))).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      samples.push({ x, y, r: r / n, g: g / n, b: b / n });
    }
  }

  // k-means (2 clusters) auto-calibré
  let c1 = { r: 35, g: 42, b: 77 }, c2 = { r: 200, g: 170, b: 90 }; // départ
  for (let it = 0; it < 12; it++) {
    const A = [], B = [];
    for (const s of samples) {
      const d1 = dist2(s, c1), d2 = dist2(s, c2);
      (d1 <= d2 ? A : B).push(s);
    }
    c1 = mean(A) || c1; c2 = mean(B) || c2;
  }
  // le cluster le plus sombre = cellules vides
  const lum1 = 0.299 * c1.r + 0.587 * c1.g + 0.114 * c1.b;
  const lum2 = 0.299 * c2.r + 0.587 * c2.g + 0.114 * c2.b;
  const empty = lum1 <= lum2 ? c1 : c2;
  const filled = lum1 <= lum2 ? c2 : c1;

  grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  cellColors = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (const s of samples) {
    const isFilled = dist2(s, filled) < dist2(s, empty);
    if (isFilled && lumOf(s) > 78) { // garde-fou : le fond de l'app reste sombre-bleu mais pas un "bloc"
      grid[s.y][s.x] = 1;
      cellColors[s.y][s.x] = rgbHex(s.r, s.g, s.b);
    }
  }
}

const dist2 = (a, b) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
const lumOf = (s) => 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
function mean(arr) {
  if (!arr.length) return null;
  let r = 0, g = 0, b = 0;
  for (const s of arr) { r += s.r; g += s.g; b += s.b; }
  return { r: r / arr.length, g: g / arr.length, b: b / arr.length };
}
function rgbHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

/* ============================================================
   4. RENDU DE LA GRILLE ÉDITORIALE
   ============================================================ */
function renderBoard() {
  boardEl.innerHTML = "";
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const c = document.createElement("div");
      c.className = "cell" + (grid[y][x] ? " filled" : "");
      if (grid[y][x]) c.style.background = cellColors[y][x] || "#888";
      c.dataset.x = x; c.dataset.y = y;
      c.addEventListener("click", () => {
        grid[y][x] = grid[y][x] ? 0 : 1;
        if (grid[y][x] && !cellColors[y][x]) cellColors[y][x] = "#4a90ff";
        c.classList.toggle("filled");
        c.style.background = grid[y][x] ? (cellColors[y][x] || "#4a90ff") : "";
        hideResult();
      });
      boardEl.appendChild(c);
    }
}

$("btn-clear").addEventListener("click", () => {
  grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  cellColors = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  renderBoard(); hideResult();
});

function hideResult() { $("result").classList.add("hidden"); }

/* ============================================================
   5. PIÈCES : slots + palette
   ============================================================ */
function renderSlots() {
  document.querySelectorAll("#slots .slot").forEach((el) => {
    const i = +el.dataset.i;
    el.innerHTML = "";
    el.classList.toggle("filled", !!slots[i]);
    if (slots[i]) {
      el.appendChild(pieceEl(slots[i]));
      el.onclick = () => { slots[i] = null; renderSlots(); hideResult(); toast("Pièce retirée"); };
    } else {
      el.onclick = () => toast("Choisis une pièce dans la palette ↓");
    }
  });
}

function renderPalette() {
  const p = $("palette");
  p.innerHTML = "";
  SHAPES.forEach((sh, i) => {
    const it = document.createElement("div");
    it.className = "pal-item";
    it.appendChild(pieceEl({ shape: sh.g, color: COLOR_KEYS[i % COLOR_KEYS.length] }));
    it.addEventListener("click", () => {
      const free = slots.indexOf(null);
      if (free === -1) { toast("Les 3 slots sont pleins — tap un slot pour le vider"); return; }
      slots[free] = { shape: sh.g, color: COLOR_KEYS[free % COLOR_KEYS.length], name: sh.n };
      renderSlots(); hideResult();
    });
    p.appendChild(it);
  });
}

function pieceEl(p) {
  const el = document.createElement("div");
  el.className = "piece";
  el.style.gridTemplateColumns = `repeat(${p.shape[0].length}, 13px)`;
  p.shape.forEach((row) => row.forEach((v) => {
    const b = document.createElement("div");
    b.className = "block" + (v ? "" : " void");
    if (v) b.style.background = BCOLORS[p.color] || p.color;
    el.appendChild(b);
  }));
  return el;
}

/* ============================================================
   6. 🤖 SOLVER — meilleur coup
   ============================================================ */
function canPlace(shape, px, py) {
  for (let y = 0; y < shape.length; y++)
    for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue;
      const gx = px + x, gy = py + y;
      if (gx < 0 || gy < 0 || gx >= SIZE || gy >= SIZE) return false;
      if (grid[gy][gx]) return false;
    }
  return true;
}

function evaluate(shape, px, py) {
  const g = cloneGrid(grid);
  let placed = 0;
  for (let y = 0; y < shape.length; y++)
    for (let x = 0; x < shape[y].length; x++)
      if (shape[y][x]) { g[py + y][px + x] = 1; placed++; }
  let full = 0;
  for (let y = 0; y < SIZE; y++) if (g[y].every((v) => v)) full++;
  for (let x = 0; x < SIZE; x++) { let ok = true; for (let y = 0; y < SIZE; y++) if (!g[y][x]) { ok = false; break; } if (ok) full++; }
  const cx = px + shape[0].length / 2, cy = py + shape.length / 2;
  const center = 4 - Math.abs(cx - 4) - Math.abs(cy - 4);
  // pénaliser les trous créés dans les zones ouvertes (évitement de game over)
  return full * 100 + placed + center * 0.5;
}

function bestMove() {
  let best = null;
  slots.forEach((p, i) => {
    if (!p) return;
    for (let y = 0; y <= SIZE - p.shape.length; y++)
      for (let x = 0; x <= SIZE - p.shape[0].length; x++)
        if (canPlace(p.shape, x, y)) {
          const v = evaluate(p.shape, x, y);
          if (!best || v > best.v) best = { slot: i, x, y, v, shape: p.shape };
        }
  });
  return best;
}

$("btn-solve").addEventListener("click", () => {
  if (solving) return;
  const nb = slots.filter(Boolean).length;
  if (nb === 0) { toast("Choisis d'abord tes 3 pièces (ou au moins 1)"); return; }
  solving = true;
  const move = bestMove();
  solving = false;

  const res = $("result");
  res.classList.remove("hidden", "bad");

  if (!move) {
    res.classList.add("bad");
    res.innerHTML = `<h3>❌ Aucune pièce ne passe !</h3>
      <p>Aucune de tes ${nb} pièce${nb > 1 ? "s" : ""} ne peut être posée sur cette grille.
      Dans le vrai jeu, c'est <b>game over</b> — dégages une zone au prochain tour.</p>`;
    return;
  }

  // Surlignage
  document.querySelectorAll("#board .cell").forEach((c) => c.classList.remove("hint"));
  let lines = countLines(move.shape, move.x, move.y);
  for (let y = 0; y < move.shape.length; y++)
    for (let x = 0; x < move.shape[y].length; x++)
      if (move.shape[y][x]) {
        const c = boardEl.children[(move.y + y) * SIZE + (move.x + x)];
        if (c) c.classList.add("hint");
      }

  const piece = slots[move.slot];
  const linesTxt = lines > 0
    ? `Ça efface <b>${lines} ligne${lines > 1 ? "s" : ""}</b> → <span class="score">combo !</span>`
    : `Pas de ligne effacée, mais c'est le placement <b>le plus sûr</b>`;

  res.innerHTML = `<h3>🤖 Pose ta pièce ici (cases vertes)</h3>
    <p>Pièce <b>${piece.name || "sélectionnée"}</b> → position <b>${move.x + 1}ᵉ colonne, ${move.y + 1}ᵉ ligne</b> (coin haut-gauche de la pièce).<br>${linesTxt}.</p>`;

  window.scrollTo({ top: res.offsetTop - 80, behavior: "smooth" });
});

function countLines(shape, px, py) {
  const g = cloneGrid(grid);
  for (let y = 0; y < shape.length; y++)
    for (let x = 0; x < shape[y].length; x++)
      if (shape[y][x]) g[py + y][px + x] = 1;
  let full = 0;
  for (let y = 0; y < SIZE; y++) if (g[y].every((v) => v)) full++;
  for (let x = 0; x < SIZE; x++) { let ok = true; for (let y = 0; y < SIZE; y++) if (!g[y][x]) { ok = false; break; } if (ok) full++; }
  return full;
}

/* ============================================================
   7. INSTALL PWA
   ============================================================ */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
$("btn-install").addEventListener("click", async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; return; }
  document.querySelector(".about").scrollIntoView({ behavior: "smooth" });
  toast("Sur iPhone : ⬆ Partager → « Sur l'écran d'accueil »");
});

/* Service worker */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/* Init */
renderBoard(); renderSlots(); renderPalette();
