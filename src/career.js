// Career: street cash, the street-race ladder, the dealership and tune-ups. Saved in localStorage.

export const CARS = [
  { id: 'kaze', body: 'coupe', name: 'KAZE GT-S', origin: 'JAPAN', engine: '2.8 L turbo straight-six', sound: 'i6', price: 0, paint: 1, wheels: 0,
    stats: { power: .76, grip: .94, mass: 1260 }, blurb: 'Pop-up coupe with a glass hatch. Light, eager, forgiving.' },
  { id: 'stallion', body: 'ttop', name: 'STALLION T-TOP', origin: 'USA', engine: '5.7 L cross-plane V8', sound: 'v8x', price: 18000, paint: 2, wheels: 1,
    stats: { power: .87, grip: .9, mass: 1480 }, blurb: 'Long hood, shaker scoop, lift-out roof. Torque everywhere, loves to slide.' },
  { id: 'adler', body: 'fastback', name: 'ADLER 930 TURBO', origin: 'W. GERMANY', engine: '3.3 L turbo flat-six', sound: 'f6', price: 34000, paint: 4, wheels: 2,
    stats: { power: .94, grip: 1.0, mass: 1335 }, blurb: 'Rear-engined, whale-tailed widowmaker. Huge traction out of corners.' },
  { id: 'vanta', body: 'wedge', name: 'VANTA 308 TURBO', origin: 'ITALY', engine: '2.9 L twin-turbo flat-plane V8', sound: 'v8f', price: 60000, paint: 0, wheels: 1,
    stats: { power: 1, grip: 1.04, mass: 1290 }, blurb: 'The wedge. Mid-engine, twin turbos, the fastest thing on the street.' },
];
export const carById = id => CARS.find(c => c.id === id) || CARS[0];

export const UPGRADES = [
  { id: 'engine', name: 'ENGINE', desc: 'Cams, ported heads, free-flow exhaust', cost: [2500, 5500, 9500] },
  { id: 'turbo', name: 'TURBO', desc: 'Larger turbine, more boost up top', cost: [3000, 6500, 11000] },
  { id: 'tyres', name: 'TYRES', desc: 'Softer compound, wider tread', cost: [1800, 4000, 7000] },
  { id: 'brakes', name: 'BRAKES', desc: 'Vented discs, four-pot calipers', cost: [1500, 3500, 6000] },
  { id: 'weight', name: 'WEIGHT', desc: 'Strip the trim, glassfibre panels', cost: [2000, 4500, 8000] },
];

export const EVENTS = [
  { id: 'e1', name: 'DOWNTOWN SHAKEDOWN', track: 0, laps: 2, difficulty: 0, prize: 3000 },
  { id: 'e2', name: 'HARBOR RUN', track: 1, laps: 2, difficulty: 0, prize: 4500 },
  { id: 'e3', name: 'NEON MILE', track: 0, laps: 3, difficulty: 1, prize: 7000 },
  { id: 'e4', name: 'BRIDGE BURNER', track: 1, laps: 3, difficulty: 1, prize: 9500 },
  { id: 'e5', name: 'MIDNIGHT CLUB', track: 0, laps: 4, difficulty: 2, prize: 14000 },
  { id: 'e6', name: 'HARBOR KINGS', track: 1, laps: 5, difficulty: 2, prize: 22000 },
];
export const PRICES = { paint: 800, wheels: 1200, stripe: 500 };
const SHARE = [1, .6, .4, .25, .15, .1];      // prize share by finishing position

const KEY = 'overdrive_career';
const fresh = () => ({ cash: 3000, current: 'kaze', owned: { kaze: ownedCar(CARS[0]) }, wins: {}, event: 'e1', races: 0 });
function ownedCar(c) { return { paint: c.paint, wheels: c.wheels, stripe: 0, paints: [c.paint], wheelSets: [c.wheels], stripes: [0], up: { engine: 0, turbo: 0, tyres: 0, brakes: 0, weight: 0 } }; }

export class Career {
  constructor() { this.load(); }
  load() {
    try { this.d = { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { this.d = fresh(); }
    if (!this.d.owned[this.d.current]) this.d.current = Object.keys(this.d.owned)[0] || 'kaze';
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { } }
  get cash() { return this.d.cash; }
  get car() { return carById(this.d.current); }
  get mine() { return this.d.owned[this.d.current]; }
  owns(id) { return !!this.d.owned[id]; }
  spend(n) { if (this.d.cash < n) return false; this.d.cash -= n; this.save(); return true; }

  buyCar(id) {
    const c = carById(id);
    if (this.owns(id)) { this.d.current = id; this.save(); return true; }
    if (!this.spend(c.price)) return false;
    this.d.owned[id] = ownedCar(c); this.d.current = id; this.save(); return true;
  }
  // paint / wheels / stripe: pay once per item per car, then free to switch back
  buyLook(kind, k) {
    const m = this.mine, list = { paint: 'paints', wheels: 'wheelSets', stripe: 'stripes' }[kind];
    if (!m[list].includes(k)) { if (!this.spend(PRICES[kind])) return false; m[list].push(k); }
    m[kind] = k; this.save(); return true;
  }
  upgrade(id) {
    const u = UPGRADES.find(x => x.id === id), lvl = this.mine.up[id];
    if (lvl >= u.cost.length) return false;
    if (!this.spend(Math.round(u.cost[lvl] * (.7 + this.car.price / 100000)))) return false;
    this.mine.up[id]++; this.save(); return true;
  }
  upgradeCost(id) {
    const u = UPGRADES.find(x => x.id === id), lvl = this.mine.up[id];
    return lvl >= u.cost.length ? null : Math.round(u.cost[lvl] * (.7 + this.car.price / 100000));
  }

  unlocked(i) { return i === 0 || !!this.d.wins[EVENTS[i - 1].id]; }
  get event() { return EVENTS.find(e => e.id === this.d.event) || EVENTS[0]; }
  selectEvent(id) { this.d.event = id; this.save(); }

  // finishing pays out; bonus street cred for style
  payout(ev, pos, stats) {
    const prize = Math.round(ev.prize * (SHARE[pos - 1] || 0));
    const style = Math.round(stats.driftTotal / 25) + stats.nearMiss * 150 + stats.overtakes * 75;
    const total = prize + Math.min(style, ev.prize * .5);
    this.d.cash += total; this.d.races++;
    let unlockedNext = false;
    if (pos === 1 && !this.d.wins[ev.id]) {
      this.d.wins[ev.id] = true;
      const i = EVENTS.indexOf(ev);
      if (EVENTS[i + 1]) { this.d.event = EVENTS[i + 1].id; unlockedNext = EVENTS[i + 1].name; }
    }
    this.save();
    return { prize, style: total - prize, total, unlockedNext };
  }

  // physics multipliers for the current car with its upgrades
  tuning() {
    const s = this.car.stats, u = this.mine.up;
    return {
      torque: s.power * (1 + u.engine * .06),
      boostTop: 1 + u.turbo * .07,
      mu: 1.42 * s.grip * (1 + u.tyres * .04),
      brake: 1 + u.brakes * .12,
      mass: s.mass - u.weight * 35,
    };
  }
  reset() { this.d = fresh(); this.save(); }
}

export const money = n => '$' + Math.round(n).toLocaleString('en-US');
