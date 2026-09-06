/**
 * Draw the demo thumbnails.
 *
 * Five species, ten variations each, drawn from code rather than photographed. The point
 * is not realism — it is **contrast**. The mosaic's whole premise is that a page of one
 * predicted species makes the wrong one jump out at you, and you cannot judge whether
 * that premise holds against fifty pictures that all read as an orange blob. A crab in a
 * page of sea stars has to be unmistakable at tile size, and a silhouette does that better
 * than a photograph does.
 *
 * Deterministic: the same seed draws the same fifty every time, so the fixture, the tests
 * and the walkthrough videos all agree about what is on screen. Re-running this is safe.
 *
 * These are demo data and they look it, which is deliberate — nothing drawn here could be
 * mistaken for a real observation. To swap in model-generated imagery instead, drop files
 * with the same names into the same folder; nothing else changes.
 *
 *   node tools/make-thumbs.mjs
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fixtures', 'thumbs');

const S = 256;                                   // every thumbnail is square; #68's crop rule

/* mulberry32, the same generator the fixture uses. Seeded per image so one species
   changing does not reshuffle the others. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * The seabed behind the organism.
 *
 * Varied per image on purpose. A constant background makes every tile read as the same
 * picture at a glance, which is the opposite of what a reviewer needs — the eye has to be
 * catching the organism, not a change of wallpaper.
 */
function seabed(rand) {
  const hue = 150 + rand() * 60;                 // green through to blue-green
  const dark = hsl(hue, 26 + rand() * 12, 11 + rand() * 6);
  const light = hsl(hue - 12, 30 + rand() * 14, 22 + rand() * 8);

  const blobs = [];
  for (let i = 0; i < 16; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const rx = 12 + rand() * 46;
    const ry = 8 + rand() * 30;
    const rot = rand() * 180;
    blobs.push(`<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}"
      transform="rotate(${r2(rot)} ${r2(cx)} ${r2(cy)})"
      fill="${hsl(hue - 6 + rand() * 26, 24 + rand() * 20, 14 + rand() * 16)}"
      opacity="${r2(0.18 + rand() * 0.3)}"/>`);
  }

  /* A few pale flecks: suspended particulate, which is what most survey stills carry and
     what stops the background looking like flat paint. */
  const motes = [];
  for (let i = 0; i < 40; i++) {
    motes.push(`<circle cx="${r2(rand() * S)}" cy="${r2(rand() * S)}" r="${r2(0.4 + rand() * 1.5)}"
      fill="#cfe9e4" opacity="${r2(0.05 + rand() * 0.16)}"/>`);
  }

  return `<rect width="${S}" height="${S}" fill="${dark}"/>
    <ellipse cx="${r2(S * (0.3 + rand() * 0.4))}" cy="${r2(S * (0.2 + rand() * 0.3))}"
      rx="${S * 0.9}" ry="${S * 0.7}" fill="${light}" opacity="0.5"/>
    ${blobs.join('')}${motes.join('')}`;
}

/** A soft shadow under the organism, so it sits on the seabed instead of floating. */
const shadow = (cx, cy, rx) =>
  `<ellipse cx="${r2(cx)}" cy="${r2(cy + rx * 0.55)}" rx="${r2(rx * 0.95)}" ry="${r2(rx * 0.34)}"
     fill="#000" opacity="0.24"/>`;

/* ------------------------------------------------------------------ organisms */

/**
 * A sea star: arms radiating from a disc.
 *
 * Arm count varies 4 to 6. A five-armed star is the common case, and the odd four- or
 * six-armed one is real — they occur, and a reviewer should not learn to count arms as a
 * shortcut for "correctly classified".
 */
function star(rand, hue) {
  const arms = rand() < 0.16 ? (rand() < 0.5 ? 4 : 6) : 5;
  const cx = S / 2 + (rand() - 0.5) * 26;
  const cy = S / 2 + (rand() - 0.5) * 26;
  const R = 72 + rand() * 26;                    // arm tip
  const r = R * (0.34 + rand() * 0.12);          // disc
  const spin = rand() * 360;
  const body = hsl(hue, 58 + rand() * 22, 46 + rand() * 12);
  const edge = hsl(hue - 8, 62, 30);

  /* Each arm is a rounded triangle; the webbing between them is what makes a bat star a
     bat star rather than a starfish outline. */
  const pts = [];
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    const b = a + Math.PI / arms;
    const tip = R * (0.88 + rand() * 0.24);
    pts.push(`${r2(Math.cos(a) * tip)},${r2(Math.sin(a) * tip)}`);
    pts.push(`${r2(Math.cos(b) * r)},${r2(Math.sin(b) * r)}`);
  }

  const speckles = [];
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * R * 0.8;
    speckles.push(`<circle cx="${r2(Math.cos(a) * d)}" cy="${r2(Math.sin(a) * d)}"
      r="${r2(1.4 + rand() * 3.4)}" fill="${hsl(hue + 14, 70, 34 + rand() * 26)}"
      opacity="${r2(0.3 + rand() * 0.45)}"/>`);
  }

  return `${shadow(cx, cy, R * 0.8)}
    <g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(spin)})">
      <polygon points="${pts.join(' ')}" fill="${body}" stroke="${edge}" stroke-width="3"
               stroke-linejoin="round"/>
      ${speckles.join('')}
      <circle r="${r2(r * 0.42)}" fill="${hsl(hue + 8, 46, 38)}" opacity="0.7"/>
    </g>`;
}

/** An urchin: a dark test under a dense corona of spines. */
function urchin(rand, hue) {
  const cx = S / 2 + (rand() - 0.5) * 24;
  const cy = S / 2 + (rand() - 0.5) * 24;
  const body = 34 + rand() * 14;
  const spines = [];
  const n = 42 + Math.floor(rand() * 22);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.09;
    const len = body * (1.25 + rand() * 0.85);
    spines.push(`<line x1="${r2(Math.cos(a) * body * 0.8)}" y1="${r2(Math.sin(a) * body * 0.8)}"
      x2="${r2(Math.cos(a) * len)}" y2="${r2(Math.sin(a) * len)}"
      stroke="${hsl(hue, 60 + rand() * 20, 26 + rand() * 22)}"
      stroke-width="${r2(1.6 + rand() * 2.6)}" stroke-linecap="round"/>`);
  }
  return `${shadow(cx, cy, body * 1.5)}
    <g transform="translate(${r2(cx)} ${r2(cy)})">
      ${spines.join('')}
      <circle r="${r2(body)}" fill="${hsl(hue, 54, 24)}"/>
      <circle r="${r2(body * 0.72)}" fill="${hsl(hue, 60, 31)}" opacity="0.85"/>
    </g>`;
}

/** A rockfish, in profile: the one vertebrate here, and the clearest wrong answer. */
function fish(rand, hue) {
  const cx = S / 2 + (rand() - 0.5) * 20;
  const cy = S / 2 + (rand() - 0.5) * 26;
  const L = 98 + rand() * 30;                    // sized to fill a similar share of the
  const H = L * (0.46 + rand() * 0.12);          // frame as the others, so a page of tiles
                                                 // does not read as one species being far away
  const flip = rand() < 0.5 ? -1 : 1;
  const tilt = (rand() - 0.5) * 26;
  const body = hsl(hue, 44 + rand() * 20, 40 + rand() * 12);
  const belly = hsl(hue + 12, 34, 62);

  const bands = [];
  for (let i = 0; i < 4 + Math.floor(rand() * 3); i++) {
    const x = -L * 0.5 + (i + 0.6) * (L / 6);
    bands.push(`<ellipse cx="${r2(x)}" cy="${r2(-H * 0.12)}" rx="${r2(3 + rand() * 5)}"
      ry="${r2(H * (0.34 + rand() * 0.2))}" fill="${hsl(hue - 16, 50, 26)}"
      opacity="${r2(0.28 + rand() * 0.3)}"/>`);
  }

  return `${shadow(cx, cy, L * 0.55)}
    <g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(tilt)}) scale(${flip} 1)">
      <path d="M ${r2(-L * 0.52)} 0 Q ${r2(-L * 0.2)} ${r2(-H)} ${r2(L * 0.3)} ${r2(-H * 0.3)}
               Q ${r2(L * 0.5)} 0 ${r2(L * 0.3)} ${r2(H * 0.34)}
               Q ${r2(-L * 0.2)} ${r2(H * 0.92)} ${r2(-L * 0.52)} 0 Z"
            fill="${body}"/>
      <path d="M ${r2(-L * 0.52)} 0 L ${r2(-L * 0.86)} ${r2(-H * 0.6)}
               L ${r2(-L * 0.78)} 0 L ${r2(-L * 0.86)} ${r2(H * 0.6)} Z" fill="${body}"/>
      <path d="M ${r2(-L * 0.3)} ${r2(-H * 0.72)} L ${r2(L * 0.02)} ${r2(-H * 1.25)}
               L ${r2(L * 0.16)} ${r2(-H * 0.5)} Z" fill="${hsl(hue - 10, 46, 34)}"/>
      <ellipse cx="${r2(L * 0.02)}" cy="${r2(H * 0.38)}" rx="${r2(L * 0.2)}" ry="${r2(H * 0.2)}"
               fill="${belly}" opacity="0.5"/>
      ${bands.join('')}
      <circle cx="${r2(L * 0.28)}" cy="${r2(-H * 0.28)}" r="${r2(4 + rand() * 2)}" fill="#f4f1e6"/>
      <circle cx="${r2(L * 0.29)}" cy="${r2(-H * 0.28)}" r="${r2(2 + rand())}" fill="#101418"/>
    </g>`;
}

/** A crab: wide carapace, walking legs, two claws held forward. */
function crab(rand, hue) {
  const cx = S / 2 + (rand() - 0.5) * 22;
  const cy = S / 2 + (rand() - 0.5) * 20;
  const w = 46 + rand() * 18;
  const h = w * (0.62 + rand() * 0.12);
  const spin = (rand() - 0.5) * 40;
  const shell = hsl(hue, 50 + rand() * 18, 38 + rand() * 12);
  const limb = hsl(hue - 6, 46, 30);

  const legs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = -h * 0.2 + i * (h * 0.34);
      const reach = w * (0.75 + rand() * 0.5);
      legs.push(`<path d="M ${r2(side * w * 0.7)} ${r2(y)}
        Q ${r2(side * (w * 0.7 + reach * 0.6))} ${r2(y - 10 + rand() * 8)}
          ${r2(side * (w * 0.7 + reach))} ${r2(y + 14 + rand() * 12)}"
        stroke="${limb}" stroke-width="${r2(4 + rand() * 2)}" fill="none" stroke-linecap="round"/>`);
    }
    /* The claw, forward and up. It is the shape that says crab from across the room. */
    legs.push(`<path d="M ${r2(side * w * 0.55)} ${r2(-h * 0.5)}
      Q ${r2(side * w * 1.1)} ${r2(-h * 1.25)} ${r2(side * w * 1.28)} ${r2(-h * 0.72)}"
      stroke="${limb}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <ellipse cx="${r2(side * w * 1.3)}" cy="${r2(-h * 0.74)}" rx="${r2(10 + rand() * 4)}"
        ry="${r2(7 + rand() * 3)}" transform="rotate(${side * -30} ${r2(side * w * 1.3)} ${r2(-h * 0.74)})"
        fill="${shell}"/>`);
  }

  return `${shadow(cx, cy, w * 1.05)}
    <g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(spin)})">
      ${legs.join('')}
      <ellipse rx="${r2(w)}" ry="${r2(h)}" fill="${shell}"/>
      <ellipse rx="${r2(w * 0.72)}" ry="${r2(h * 0.6)}" cy="${r2(-h * 0.12)}"
               fill="${hsl(hue + 8, 44, 46)}" opacity="0.45"/>
      <circle cx="${r2(-w * 0.28)}" cy="${r2(-h * 0.62)}" r="3.4" fill="#12161a"/>
      <circle cx="${r2(w * 0.28)}" cy="${r2(-h * 0.62)}" r="3.4" fill="#12161a"/>
    </g>`;
}

/** A sea cucumber: elongate, papillate, lying along the substrate. */
function cucumber(rand, hue) {
  const cx = S / 2 + (rand() - 0.5) * 20;
  const cy = S / 2 + (rand() - 0.5) * 24;
  const L = 118 + rand() * 38;
  const H = 30 + rand() * 12;
  const spin = (rand() - 0.5) * 70;
  const body = hsl(hue, 48 + rand() * 18, 34 + rand() * 12);

  const papillae = [];
  const n = 16 + Math.floor(rand() * 10);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1;
    const x = t * L * 0.44;
    const up = i % 2 ? -1 : 1;
    const y = up * H * (0.55 + rand() * 0.35);
    papillae.push(`<path d="M ${r2(x)} ${r2(y * 0.5)} L ${r2(x + (rand() - 0.5) * 6)} ${r2(y * 1.5)}"
      stroke="${hsl(hue + 10, 52, 44)}" stroke-width="${r2(2.6 + rand() * 2)}" stroke-linecap="round"/>`);
  }

  return `${shadow(cx, cy, L * 0.5)}
    <g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(spin)})">
      ${papillae.join('')}
      <rect x="${r2(-L / 2)}" y="${r2(-H)}" width="${r2(L)}" height="${r2(H * 2)}"
            rx="${r2(H)}" fill="${body}"/>
      <rect x="${r2(-L / 2 + 6)}" y="${r2(-H * 0.55)}" width="${r2(L - 12)}" height="${r2(H * 0.6)}"
            rx="${r2(H * 0.3)}" fill="${hsl(hue + 14, 40, 50)}" opacity="0.35"/>
    </g>`;
}

/* -------------------------------------------------------------------- species */

/**
 * The five, chosen for silhouette rather than for taxonomy.
 *
 * A radial star, a spiny ball, a fish in profile, a wide crab and a long cucumber cannot
 * be confused with one another at 120 pixels, which is the whole reason these exist.
 */
const KINDS = [
  { slug: 'bat-star',     draw: star,     hue: [14, 30],   seed: 8100 },
  { slug: 'red-urchin',   draw: urchin,   hue: [352, 372], seed: 8200 },
  { slug: 'rockfish',     draw: fish,     hue: [22, 44],   seed: 8300 },
  { slug: 'rock-crab',    draw: crab,     hue: [6, 22],    seed: 8400 },
  { slug: 'sea-cucumber', draw: cucumber, hue: [30, 52],   seed: 8500 }
];

const PER = 10;

mkdirSync(OUT, { recursive: true });

/* Clear the previous run's output so a renamed species cannot leave an orphan behind that
   nothing references and nobody notices. Only ours: the marker png stays. */
for (const f of readdirSync(OUT)) {
  if (KINDS.some((k) => f.startsWith(`${k.slug}-`)) && f.endsWith('.svg')) {
    unlinkSync(join(OUT, f));
  }
}

let written = 0;
for (const kind of KINDS) {
  for (let i = 1; i <= PER; i++) {
    const rand = rng(kind.seed + i * 977);
    const hue = kind.hue[0] + rand() * (kind.hue[1] - kind.hue[0]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"
  viewBox="0 0 ${S} ${S}" role="img" aria-label="${kind.slug} example ${i}">
  ${seabed(rand)}
  ${kind.draw(rand, hue)}
</svg>`;
    writeFileSync(join(OUT, `${kind.slug}-${String(i).padStart(2, '0')}.svg`), svg);
    written++;
  }
}

console.log(`wrote ${written} thumbnails: ${KINDS.length} species x ${PER}`);
console.log(KINDS.map((k) => k.slug).join(', '));
