/**
 * kundli.js - deterministic Vedic birth chart engine. Zero dependencies.
 *
 * Runs entirely on-device: birth date, time and place never leave the browser.
 *
 * PRIVACY WARNING. The derived chart is NOT anonymous. A full set of graha
 * placements is effectively a fingerprint of the birth moment - brute-forcing
 * 20 years of candidate dates against `chartTokens` output returns exactly one
 * match. Treat anything produced here as personal data: send it over TLS, do
 * not log it, do not retain it. The honest claim is "your birth details stay on
 * your device", not "we cannot identify you".
 *
 * Astronomy:
 *   Sun, Moon  - Meeus, "Astronomical Algorithms" 2nd ed, ch. 25 and 47.
 *   Planets    - Standish/JPL approximate Keplerian elements (valid 1800-2050),
 *                plus Jupiter/Saturn great-inequality perturbation terms.
 *   Ayanamsa   - Lahiri (Chitrapaksha).
 *   Houses     - whole sign (rashi = bhava), the common North Indian convention.
 *
 * Measured accuracy in ecliptic longitude, verified in kundli.test.mjs against
 * Meeus' worked examples and two independently confirmed Jupiter-Saturn
 * conjunctions:
 *
 *   Sun                       ~0.001 deg   (Meeus ex. 25.b)
 *   Moon                      ~0.001 deg   (Meeus ex. 47.a)
 *   Ascendant                  exact geometry, limited only by the ayanamsa
 *   Mars, Venus, Mercury      ~0.02 deg
 *   Jupiter, Saturn           up to ~0.3 deg  <-- the real limit here
 *
 * Jupiter and Saturn are the weak point: their mutual 5:2 near-resonance is
 * only partly captured by Keplerian elements. Each placement therefore carries
 * a `boundary` flag set from that body's own uncertainty, so a Jupiter sitting
 * 0.2 deg from a rashi cusp is marked as unsafe while a Moon at the same
 * distance is not. The Moon, which seeds the whole Vimshottari dasha, is
 * accurate to ~4 arcseconds.
 *
 * Latitudes beyond the polar circles are rejected: the ecliptic can sit wholly
 * above or below the horizon there and the ascendant becomes degenerate.
 *
 * For readings that must match Swiss Ephemeris output degree-for-degree, this
 * engine is not sufficient for Jupiter and Saturn.
 */

const RAD = Math.PI / 180;
const sin = d => Math.sin(d * RAD);
const cos = d => Math.cos(d * RAD);
const tan = d => Math.tan(d * RAD);
const norm360 = d => ((d % 360) + 360) % 360;

export const RASHIS = ["Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya",
  "Tula", "Vrischika", "Dhanu", "Makara", "Kumbha", "Meena"];

export const RASHIS_EN = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

export const NAKSHATRAS = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira",
  "Ardra", "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
  "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
  "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha",
  "Purva Bhadrapada", "Uttara Bhadrapada", "Revati"];

// Vimshottari: lord of each nakshatra, cycling in this 9-lord order, and years ruled.
const DASHA_LORDS = ["Ketu", "Shukra", "Surya", "Chandra", "Mangala", "Rahu",
  "Guru", "Shani", "Budha"];
const DASHA_YEARS = { Ketu: 7, Shukra: 20, Surya: 6, Chandra: 10, Mangala: 7,
  Rahu: 18, Guru: 16, Shani: 19, Budha: 17 };
const DASHA_TOTAL = 120;
const VIMSHOTTARI_YEAR = 365.25; // days per year, by convention

/* ---------------------------------------------------------------- time --- */

/** Julian Day from a UTC calendar date. `day` may carry a fraction. */
export function julianDay(year, month, day) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  // Gregorian calendar correction; the Julian calendar applies before 1582-10-15.
  const b = (year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15))))
    ? 2 - a + Math.floor(a / 4) : 0;
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/** Calendar date (UTC) from a Julian Day. */
export function jdToDate(jd) {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const dayF = b - d - Math.floor(30.6001 * e) + f;
  const day = Math.floor(dayF);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  // Nudge past floating-point noise so 06:59:59.9999 reads as 07:00.
  const hours = (dayF - day) * 24 + 1e-9;
  return { year, month, day, hour: Math.floor(hours),
    minute: Math.floor((hours % 1) * 60) };
}

/**
 * Delta-T in seconds (TT - UT). Espenak & Meeus polynomial fits.
 * Matters little for the chart but keeps planetary positions honest.
 */
export function deltaT(year) {
  if (year >= 2005 && year <= 2050) { const t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  if (year >= 1986 && year < 2005) { const t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (year >= 1961 && year < 1986) { const t = year - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
  if (year >= 1941 && year < 1961) { const t = year - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
  if (year >= 1920 && year < 1941) { const t = year - 1920; return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t ** 3; }
  if (year >= 1900 && year < 1920) { const t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (year > 2050) { const t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

/* ------------------------------------------------------- earth geometry --- */

/** Nutation in longitude (deg) and true obliquity of the ecliptic (deg). */
function nutationObliquity(T) {
  const omega = 125.04452 - 1934.136261 * T;
  const L = 280.4665 + 36000.7698 * T;
  const Lp = 218.3165 + 481267.8813 * T;
  const dPsi = (-17.20 * sin(omega) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lp)
    + 0.21 * sin(2 * omega)) / 3600;
  const dEps = (9.20 * cos(omega) + 0.57 * cos(2 * L) + 0.10 * cos(2 * Lp)
    - 0.09 * cos(2 * omega)) / 3600;
  const eps0 = 23 + 26 / 60 + 21.448 / 3600
    - (46.8150 * T + 0.00059 * T * T - 0.001813 * T ** 3) / 3600;
  return { dPsi, eps: eps0 + dEps };
}

/**
 * Lahiri (Chitrapaksha) ayanamsa in degrees.
 * Anchored at 23deg 51' 11" for J2000.0 with the IAU precession rate.
 */
export function lahiriAyanamsa(T) {
  return 23.85304 + 1.396042 * T + 0.0003086 * T * T;
}

/* ------------------------------------------------------------- the sun --- */

/** Apparent geocentric ecliptic longitude of the Sun (deg). Meeus ch. 25. */
export function sunLongitude(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
    + (0.019993 - 0.000101 * T) * sin(2 * M)
    + 0.000289 * sin(3 * M);
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  return norm360(trueLong - 0.00569 - 0.00478 * sin(omega));
}

/* ------------------------------------------------------------ the moon --- */

// Meeus table 47.A: [D, M, M', F, longitude coefficient in 1e-6 deg]
const MOON_TERMS = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314],
  [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322],
  [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888], [2, 1, 0, 0, -6766],
  [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665],
  [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390],
  [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236], [0, 1, 2, 0, -2120],
  [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110],
  [3, 0, -1, 0, -892], [2, 1, 1, 0, -810], [4, -1, -2, 0, 759],
  [0, 2, -1, 0, -713], [2, 2, -1, 0, -700], [2, 1, -2, 0, 691],
  [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
  [4, -1, 0, 0, 520], [1, 0, -2, 0, -487], [2, 1, 0, -2, -399],
  [0, 0, 2, -2, -381], [1, 1, 1, 0, 351], [3, 0, -2, 0, -340],
  [4, 0, -3, 0, 330], [2, -1, 2, 0, 327], [0, 2, 1, 0, -323],
  [1, 1, -1, 0, 299], [2, 0, 3, 0, 294],
];

/** Geocentric ecliptic longitude of the Moon (deg). Meeus ch. 47. */
export function moonLongitude(T) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
    + T ** 3 / 538841 - T ** 4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
    + T ** 3 / 545868 - T ** 4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
    + T ** 3 / 69699 - T ** 4 / 14712000;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T
    - T ** 3 / 3526000 + T ** 4 / 863310000;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sum = 0;
  for (const [d, m, mp, f, coeff] of MOON_TERMS) {
    // Terms involving the Sun's anomaly are damped by Earth's changing eccentricity.
    const ecc = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sum += coeff * ecc * sin(d * D + m * M + mp * Mp + f * F);
  }
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.290 * T;
  sum += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);

  return norm360(Lp + sum / 1e6);
}

/** Mean longitude of the ascending lunar node - Rahu (deg). */
export function meanNode(T) {
  return norm360(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T
    + T ** 3 / 467441 - T ** 4 / 60616000);
}

/* ------------------------------------------------------------- planets --- */

// Standish/JPL approximate elements at J2000 and their per-century rates:
// [a, e, I, L, longPeri, longNode]
const PLANET_ELEMENTS = {
  Budha:   { el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
             rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  Shukra:  { el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
             rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  Earth:   { el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
             rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  Mangala: { el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
             rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  Guru:    { el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
             rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  Shani:   { el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
             rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
};

/** Mean anomaly of a planet (deg, -180..180). */
function meanAnomaly(name, T) {
  const { el, rate } = PLANET_ELEMENTS[name];
  let M = norm360((el[3] + rate[3] * T) - (el[4] + rate[4] * T));
  return M > 180 ? M - 360 : M;
}

/**
 * Correction to heliocentric longitude (deg) for Jupiter and Saturn.
 *
 * The two planets sit close to a 5:2 orbital resonance - the "great
 * inequality" - which pure Keplerian elements cannot represent. These are the
 * standard leading periodic terms in their mutual perturbation.
 */
function giantPerturbation(name, T) {
  const Mj = meanAnomaly("Guru", T);
  const Ms = meanAnomaly("Shani", T);
  if (name === "Guru") {
    return -0.332 * sin(2 * Mj - 5 * Ms - 67.6)
      - 0.056 * sin(2 * Mj - 2 * Ms + 21)
      + 0.042 * sin(3 * Mj - 5 * Ms + 21)
      - 0.036 * sin(Mj - 2 * Ms)
      + 0.022 * cos(Mj - Ms)
      + 0.023 * sin(2 * Mj - 3 * Ms + 52)
      - 0.016 * sin(Mj - 5 * Ms - 69);
  }
  return 0.812 * sin(2 * Mj - 5 * Ms - 67.6)
    - 0.229 * cos(2 * Mj - 4 * Ms - 2)
    + 0.119 * sin(Mj - 2 * Ms - 3)
    + 0.046 * sin(2 * Mj - 6 * Ms - 69)
    + 0.014 * sin(Mj - 3 * Ms + 32);
}

/** Heliocentric ecliptic rectangular coordinates (AU) for a planet. */
function heliocentric(name, T) {
  const { el, rate } = PLANET_ELEMENTS[name];
  const a = el[0] + rate[0] * T;
  const e = el[1] + rate[1] * T;
  const I = el[2] + rate[2] * T;
  const L = el[3] + rate[3] * T;
  const wbar = el[4] + rate[4] * T;
  const Omega = el[5] + rate[5] * T;

  const omega = wbar - Omega;
  let M = norm360(L - wbar);
  if (M > 180) M -= 360;

  // Kepler's equation, solved in degrees to match the tabulated elements.
  const eDeg = e * (180 / Math.PI);
  let E = M + eDeg * sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (M - (E - eDeg * sin(E))) / (1 - e * cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-9) break;
  }

  const xp = a * (cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * sin(E);

  const x = (cos(omega) * cos(Omega) - sin(omega) * sin(Omega) * cos(I)) * xp
    + (-sin(omega) * cos(Omega) - cos(omega) * sin(Omega) * cos(I)) * yp;
  const y = (cos(omega) * sin(Omega) + sin(omega) * cos(Omega) * cos(I)) * xp
    + (-sin(omega) * sin(Omega) + cos(omega) * cos(Omega) * cos(I)) * yp;
  const z = (sin(omega) * sin(I)) * xp + (cos(omega) * sin(I)) * yp;

  if (name !== "Guru" && name !== "Shani") return { x, y, z };

  // Rotate the great-inequality correction into the rectangular coordinates.
  const r = Math.hypot(x, y, z);
  const lat = Math.asin(z / r) / RAD;
  const lon = Math.atan2(y, x) / RAD + giantPerturbation(name, T);
  return {
    x: r * cos(lat) * cos(lon),
    y: r * cos(lat) * sin(lon),
    z: r * sin(lat),
  };
}

/** Geocentric ecliptic longitude of a planet (deg). */
export function planetLongitude(name, T) {
  const p = heliocentric(name, T);
  const earth = heliocentric("Earth", T);
  return norm360(Math.atan2(p.y - earth.y, p.x - earth.x) / RAD);
}

/* ------------------------------------------------------------ ascendant --- */

/** Greenwich mean sidereal time (deg) for a UT Julian Day. */
export function gmst(jdUT) {
  const T = (jdUT - 2451545.0) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jdUT - 2451545.0)
    + 0.000387933 * T * T - T ** 3 / 38710000);
}

/**
 * Tropical ecliptic longitude of the ascendant (deg).
 * `lonEast` is positive east of Greenwich. Passing `dPsi` uses apparent
 * sidereal time, keeping the ascendant in the same frame as the planets.
 */
export function ascendant(jdUT, latitude, lonEast, eps, dPsi = 0) {
  // Equation of the equinoxes converts mean sidereal time to apparent.
  const ramc = norm360(gmst(jdUT) + dPsi * cos(eps) + lonEast);
  const asc = Math.atan2(cos(ramc), -(sin(ramc) * cos(eps) + tan(latitude) * sin(eps))) / RAD;
  return norm360(asc);
}

/* -------------------------------------------------------------- buckets --- */

/**
 * How far each body's longitude may be wrong, in degrees, from the accuracy
 * measured in kundli.test.mjs. Used to decide whether a placement is close
 * enough to a cusp that the sign or nakshatra could genuinely flip.
 */
export const UNCERTAINTY = {
  Surya: 0.001, Chandra: 0.001, Rahu: 0.001, Ketu: 0.001,
  Mangala: 0.02, Budha: 0.02, Shukra: 0.02,
  Guru: 0.3, Shani: 0.3,
  // The ascendant moves ~0.25 deg per minute of clock time, so birth-time
  // precision dominates any astronomical error.
  Lagna: 0.25,
};

const DEFAULT_UNCERTAINTY = 1 / 60;

export function toRashi(lon, uncertainty = DEFAULT_UNCERTAINTY) {
  const idx = Math.floor(norm360(lon) / 30);
  const deg = norm360(lon) - idx * 30;
  return {
    index: idx, name: RASHIS[idx], english: RASHIS_EN[idx], degree: deg,
    // True when this body's own error bar could push it into the next sign.
    boundary: deg < uncertainty || deg > 30 - uncertainty,
  };
}

export function toNakshatra(lon, uncertainty = DEFAULT_UNCERTAINTY) {
  const span = 360 / 27;
  const l = norm360(lon);
  const idx = Math.floor(l / span);
  const within = l - idx * span;
  return {
    index: idx, name: NAKSHATRAS[idx],
    pada: Math.floor(within / (span / 4)) + 1,
    fraction: within / span,
    lord: DASHA_LORDS[idx % 9],
    boundary: within < uncertainty || within > span - uncertainty,
  };
}

/* ---------------------------------------------------------------- dasha --- */

/**
 * Vimshottari mahadasha sequence, seeded by the Moon's position within its
 * nakshatra. Returns every mahadasha across one 120-year cycle.
 */
export function vimshottari(moonLon, birthJD) {
  const nak = toNakshatra(moonLon);
  const startIdx = DASHA_LORDS.indexOf(nak.lord);
  const balance = (1 - nak.fraction) * DASHA_YEARS[nak.lord];

  const periods = [];
  let jd = birthJD - (DASHA_YEARS[nak.lord] - balance) * VIMSHOTTARI_YEAR;
  for (let i = 0; i < 9; i++) {
    const lord = DASHA_LORDS[(startIdx + i) % 9];
    const years = DASHA_YEARS[lord];
    const end = jd + years * VIMSHOTTARI_YEAR;
    periods.push({ lord, years, startJD: jd, endJD: end,
      start: jdToDate(jd), end: jdToDate(end) });
    jd = end;
  }
  return { balance, periods, total: DASHA_TOTAL };
}

/** Antardasha (sub-period) breakdown within one mahadasha. */
export function antardasha(maha) {
  const startIdx = DASHA_LORDS.indexOf(maha.lord);
  const out = [];
  let jd = maha.startJD;
  for (let i = 0; i < 9; i++) {
    const lord = DASHA_LORDS[(startIdx + i) % 9];
    const days = (maha.years * DASHA_YEARS[lord] / DASHA_TOTAL) * VIMSHOTTARI_YEAR;
    out.push({ lord, startJD: jd, endJD: jd + days,
      start: jdToDate(jd), end: jdToDate(jd + days) });
    jd += days;
  }
  return out;
}

/* ----------------------------------------------------------------- chart --- */

const BODIES = ["Surya", "Chandra", "Mangala", "Budha", "Guru", "Shukra", "Shani", "Rahu", "Ketu"];

/**
 * Full sidereal birth chart.
 *
 * birth = { year, month, day, hour, minute, tz, latitude, longitude }
 *   tz          - hours east of UTC (India = 5.5). This is the offset in force
 *                 at the birth date and place, so callers are responsible for
 *                 historical zones and any daylight saving.
 *   latitude    - degrees north positive, must be within the polar circles
 *   longitude   - degrees east positive
 *   unknownTime - pass true to accept a chart without a birth time. The chart
 *                 is then computed for local noon and `timeKnown` is false;
 *                 the lagna and every bhava are meaningless in that case.
 *
 * Throws on missing or out-of-range input rather than returning a NaN chart.
 */
export function computeKundli(birth) {
  const { year, month, day, hour, minute, tz = 0,
    latitude, longitude, unknownTime = false } = birth;

  const num = (v, name) => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`kundli: ${name} must be a finite number`);
    return v;
  };
  num(year, "year"); num(month, "month"); num(day, "day"); num(tz, "tz");
  num(latitude, "latitude"); num(longitude, "longitude");
  if (month < 1 || month > 12) throw new Error("kundli: month must be 1-12");
  if (day < 1 || day >= 32) throw new Error("kundli: day must be 1-31");
  if (Math.abs(latitude) > 66.5) throw new Error("kundli: latitude must be within the polar circles; the ascendant is degenerate beyond them");
  if (Math.abs(longitude) > 180) throw new Error("kundli: longitude must be -180 to 180");
  if (Math.abs(tz) > 14) throw new Error("kundli: tz must be -14 to 14 hours");

  // A missing birth time is common and must never be guessed silently: a
  // midnight default yields a confident lagna that is simply wrong.
  const timeKnown = !unknownTime;
  if (timeKnown && (hour === undefined || minute === undefined)) {
    throw new Error("kundli: hour and minute are required; pass unknownTime:true to compute a time-free chart");
  }
  const h = timeKnown ? num(hour, "hour") : 12;
  const mi = timeKnown ? num(minute, "minute") : 0;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) throw new Error("kundli: hour must be 0-23 and minute 0-59");

  const hourUT = h + mi / 60 - tz;
  const jdUT = julianDay(year, month, day + hourUT / 24);
  const jdTT = jdUT + deltaT(year) / 86400;
  const T = (jdTT - 2451545.0) / 36525;

  const { dPsi, eps } = nutationObliquity(T);
  const ayanamsa = lahiriAyanamsa(T);
  const sidereal = tropical => norm360(tropical - ayanamsa);

  // sunLongitude already returns an apparent position; the Moon and planets
  // need nutation added so every body is expressed in the same frame.
  const tropicalLon = {
    Surya: sunLongitude(T),
    Chandra: norm360(moonLongitude(T) + dPsi),
    Mangala: norm360(planetLongitude("Mangala", T) + dPsi),
    Budha: norm360(planetLongitude("Budha", T) + dPsi),
    Guru: norm360(planetLongitude("Guru", T) + dPsi),
    Shukra: norm360(planetLongitude("Shukra", T) + dPsi),
    Shani: norm360(planetLongitude("Shani", T) + dPsi),
    // Rahu and Ketu are the mean node, used without nutation by convention.
    Rahu: meanNode(T),
    Ketu: norm360(meanNode(T) + 180),
  };

  const ascTropical = ascendant(jdUT, latitude, longitude, eps, dPsi);
  const lagnaLon = sidereal(ascTropical);
  const lagna = toRashi(lagnaLon, UNCERTAINTY.Lagna);

  const planets = {};
  for (const body of BODIES) {
    const lon = sidereal(tropicalLon[body]);
    const rashi = toRashi(lon, UNCERTAINTY[body]);
    planets[body] = {
      longitude: lon,
      rashi,
      nakshatra: toNakshatra(lon, UNCERTAINTY[body]),
      // Whole sign houses: the lagna's rashi is the first bhava. Meaningless
      // when the birth time is unknown, since the lagna itself is a guess.
      bhava: timeKnown ? ((rashi.index - lagna.index + 12) % 12) + 1 : null,
      retrograde: isRetrograde(body, T),
    };
  }

  const moonLon = planets.Chandra.longitude;
  return {
    jdUT,
    timeKnown,
    ayanamsa,
    lagna: timeKnown
      ? { longitude: lagnaLon, rashi: lagna, nakshatra: toNakshatra(lagnaLon, UNCERTAINTY.Lagna) }
      : null,
    planets,
    moonRashi: planets.Chandra.rashi,
    moonNakshatra: planets.Chandra.nakshatra,
    sunRashi: planets.Surya.rashi,
    dasha: vimshottari(moonLon, jdUT),
  };
}

/** Retrograde test by finite difference. Rahu and Ketu are always retrograde. */
function isRetrograde(body, T) {
  if (body === "Rahu" || body === "Ketu") return true;
  if (body === "Surya" || body === "Chandra") return false;
  const step = 1 / 36525; // one day in Julian centuries
  const a = planetLongitude(body, T - step);
  const b = planetLongitude(body, T + step);
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff < 0;
}

/**
 * Compact chart summary for sending to a narration service.
 *
 * This is NOT anonymous - see the privacy warning at the top of this file. It
 * omits the date, time and place, but the placements themselves identify the
 * birth moment, so it must be handled as personal data. Bhavas and the lagna
 * are dropped when the birth time is unknown.
 */
export function chartTokens(k) {
  const bodies = BODIES.map(b => {
    const p = k.planets[b];
    const house = k.timeKnown ? ` H${p.bhava}` : "";
    return `${b} ${p.rashi.name}${house}${p.retrograde ? " R" : ""}`;
  });
  const current = currentDasha(k, k.jdUT);
  return [
    k.timeKnown ? `Lagna ${k.lagna.rashi.name}` : "Lagna unknown",
    `Chandra ${k.moonNakshatra.name} pada ${k.moonNakshatra.pada}`,
    ...bodies,
    `Mahadasha ${current ? current.lord : "n/a"}`,
  ].join("; ");
}

/** The mahadasha covering a given Julian Day. */
export function currentDasha(k, jd) {
  return k.dasha.periods.find(p => jd >= p.startJD && jd < p.endJD) || null;
}
