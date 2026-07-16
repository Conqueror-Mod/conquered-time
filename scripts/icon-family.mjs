// One vector design family for Conquered Time — rich at large, simplified small.
// Exports svgFor(px) so builder + preview share identical artwork.

export function svgFor(px) {
  const large = px >= 48;   // full detail: pillars, glass, sand glow, spark
  const mid   = px >= 24 && px < 48;
  // Shared palette
  const G  = '#e9b949', GD = '#b8862e', GL = '#f6d987';
  const B  = '#5b7fd4', BD = '#3a5cb0';
  const defs = `
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="75%">
        <stop offset="0%" stop-color="#1d2740"/><stop offset="70%" stop-color="#121a2e"/><stop offset="100%" stop-color="#0c1220"/>
      </radialGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${GD}"/><stop offset="35%" stop-color="${GL}"/><stop offset="60%" stop-color="${G}"/><stop offset="100%" stop-color="${GD}"/>
      </linearGradient>
      <linearGradient id="goldv" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GL}"/><stop offset="50%" stop-color="${G}"/><stop offset="100%" stop-color="${GD}"/>
      </linearGradient>
      <radialGradient id="sand" cx="50%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#8aa7e8"/><stop offset="60%" stop-color="${B}"/><stop offset="100%" stop-color="${BD}"/>
      </radialGradient>
      <radialGradient id="spark" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff8e0" stop-opacity="0.95"/><stop offset="40%" stop-color="${GL}" stop-opacity="0.55"/><stop offset="100%" stop-color="${GL}" stop-opacity="0"/>
      </radialGradient>
    </defs>`;

  if (large) return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 128 128">${defs}
    <defs>
      <radialGradient id="glow" cx="50%" cy="62%" r="45%">
        <stop offset="0%" stop-color="#4f74d4" stop-opacity="0.35"/><stop offset="100%" stop-color="#4f74d4" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#dcebff" stop-opacity="0.30"/>
        <stop offset="25%" stop-color="#aecbff" stop-opacity="0.06"/>
        <stop offset="75%" stop-color="#aecbff" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#dcebff" stop-opacity="0.22"/>
      </linearGradient>
    </defs>
    <clipPath id="badge"><circle cx="64" cy="64" r="62"/></clipPath>
    <circle cx="64" cy="64" r="62" fill="url(#bg)"/>
    <circle cx="64" cy="64" r="78" fill="url(#glow)" clip-path="url(#badge)"/>
    <circle cx="64" cy="64" r="60" fill="none" stroke="url(#gold)" stroke-width="3.5"/>
    <circle cx="64" cy="64" r="56.5" fill="none" stroke="#8a6a24" stroke-width="0.8" opacity="0.7"/>
    <!-- pillars with capitals -->
    <rect x="30.5" y="27" width="6" height="74" rx="2.5" fill="url(#goldv)"/>
    <rect x="91.5" y="27" width="6" height="74" rx="2.5" fill="url(#goldv)"/>
    <rect x="28.5" y="26" width="10" height="4" rx="1.8" fill="${GL}"/>
    <rect x="89.5" y="26" width="10" height="4" rx="1.8" fill="${GL}"/>
    <rect x="28.5" y="98" width="10" height="4" rx="1.8" fill="${GD}"/>
    <rect x="89.5" y="98" width="10" height="4" rx="1.8" fill="${GD}"/>
    <!-- caps: bar + thin lip -->
    <rect x="25" y="17.5" width="78" height="9" rx="3.5" fill="url(#gold)"/>
    <rect x="27.5" y="26" width="73" height="2.2" rx="1.1" fill="#8a6a24"/>
    <rect x="25" y="101.5" width="78" height="9" rx="3.5" fill="url(#gold)"/>
    <rect x="27.5" y="99.8" width="73" height="2.2" rx="1.1" fill="#8a6a24"/>
    <!-- glass: proper bulbs, narrow neck at (64,64) -->
    <path d="M44 28.5 v8 C44 49 53 56.5 60.5 61.5 c1.6 1.1 1.6 3.9 0 5
             C53 71.5 44 79 44 91.5 v8 h40 v-8 C84 79 75 71.5 67.5 66.5
             c-1.6 -1.1 -1.6 -3.9 0 -5 C75 56.5 84 49 84 36.5 v-8 z"
          fill="url(#glass)" stroke="#cfe0ff" stroke-opacity="0.45" stroke-width="1.8"/>
    <!-- sand: top reserve (meniscus), stream, bottom pile -->
    <path d="M47.5 33 h33 v3 c0 10 -7.5 15.5 -13.5 19.8 l-3 2 -3 -2 C55 51.5 47.5 46 47.5 36 z" fill="url(#sand)"/>
    <path d="M47.5 33 h33 v3 q-16.5 4 -33 0 z" fill="#8aa7e8" opacity="0.55"/>
    <rect x="62.9" y="60" width="2.2" height="32" rx="1.1" fill="#9db8f0" opacity="0.95"/>
    <path d="M64 72.5 l13.5 11.5 c4.5 4 6 8.5 6 13.5 h-39 c0 -5 1.5 -9.5 6 -13.5 z" fill="url(#sand)"/>
    <path d="M56 84 l8 -7 8 7 c-5 3 -11 3 -16 0 z" fill="#8aa7e8" opacity="0.5"/>
    <!-- neck spark -->
    <circle cx="64" cy="64" r="10" fill="url(#spark)"/>
    <circle cx="64" cy="64" r="3.2" fill="#fff8e0" opacity="0.9"/>
    <!-- glass highlight sweep -->
    <path d="M49 31 c-1 10 2 17 7 22" fill="none" stroke="#e8f1ff" stroke-opacity="0.5" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M49 96 c-1 -9 2 -15 6 -19" fill="none" stroke="#e8f1ff" stroke-opacity="0.35" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;

  if (mid) return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">${defs}
    <circle cx="32" cy="32" r="31" fill="url(#bg)"/>
    <circle cx="32" cy="32" r="29.75" fill="none" stroke="url(#gold)" stroke-width="2.5"/>
    <rect x="13" y="9" width="38" height="6" rx="2.5" fill="url(#gold)"/>
    <rect x="13" y="49" width="38" height="6" rx="2.5" fill="url(#gold)"/>
    <path d="M17 15 v5 c0 6 6 9 10 12 q2 1.5 2 0 t-2 0 M17 15" fill="none"/>
    <path d="M17 15 h30 v5 c0 6 -7 10 -11 13 l-4 3 -4 -3 c-4 -3 -11 -7 -11 -13 z" fill="url(#sand)" stroke="url(#goldv)" stroke-width="2.5"/>
    <path d="M17 49 h30 v-5 c0 -6 -7 -10 -11 -13 l-4 -3 -4 3 c-4 3 -11 7 -11 13 z" fill="#16203a" stroke="url(#goldv)" stroke-width="2.5"/>
    <path d="M32 34 l9 7 c3 2.5 4 5 4 8 h-26 c0 -3 1 -5.5 4 -8 z" fill="url(#sand)"/>
  </svg>`;

  // 16px: same family silhouette — gold frame + blue sand, no ring/circle.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">${defs}
    <rect x="6" y="0" width="52" height="10" rx="3" fill="${G}"/>
    <rect x="6" y="54" width="52" height="10" rx="3" fill="${G}"/>
    <path d="M12 10 h40 v6 c0 9 -9 14 -15 19 6 5 15 10 15 19 v6 h-40 v-6 c0 -9 9 -14 15 -19 -6 -5 -15 -10 -15 -19 z" fill="${G}"/>
    <path d="M20 14 h24 v3 c0 6 -7 10 -12 14 -5 -4 -12 -8 -12 -14 z" fill="${B}"/>
    <path d="M32 36 l9 8 c2.5 2.5 3 5 3 8 h-24 c0 -3 0.5 -5.5 3 -8 z" fill="${B}"/>
  </svg>`;
}
