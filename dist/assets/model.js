/* Event-driven two-level PWM/SVPWM and exact first-order RC model.
 * All internal quantities use seconds, volts and hertz. No Euler integration.
 */
(function (host) {
  'use strict';
  const TWO_PI = 2 * Math.PI;

  function build({ fc, fe, fs, roll = 0, type = 'svpwm', scale = 100,
    modulation = 0.8, high = 100, low = 0, duty = 0.5, depth = 0.4,
    alignment = 'center', startup = false, initialValue = 0 }) {
    if (![fc, fe, fs].every(Number.isFinite) || fc < 20 || fc > 200000 ||
        fe < 0.5 || (type !== 'fixed' && (fe < 1 || fe > 5000)) || fs < 1000 || fs > 100000 || fs <= 2 * fe ||
        !Number.isFinite(roll) || roll < 0 || roll > 0.02) {
      throw new Error('RC：20–200000 Hz；基波：1–5000 Hz；载波：1000–100000 Hz，且载波须大于基波的 2 倍。');
    }
    if (!['svpwm','sine','fixed'].includes(type) || !['center','edge'].includes(alignment))
      throw new Error('请选择有效的波形类型和对齐方式。');
    if (!Number.isFinite(initialValue) || Math.abs(initialValue) > 100000)
      throw new Error('RC 初始输出须在 −100000 到 100000 V 之间。');
    if (type === 'svpwm') {
      if (!Number.isFinite(scale) || scale < 0.001 || scale > 100000 ||
          !Number.isFinite(modulation) || modulation < 0 || modulation > 1)
        throw new Error('SVPWM 电平尺度：0.001–100000 V；调制比：0–1。');
    } else {
      if (![high,low,duty].every(Number.isFinite) || high <= low ||
          Math.max(Math.abs(high),Math.abs(low)) > 100000 || high-low < 0.001 || duty < 0 || duty > 1)
        throw new Error('高电平须高于低电平，跨度至少 0.001 V，电平绝对值不超过 100000 V；占空比须在 0–1。');
      if (type === 'sine' && (!Number.isFinite(depth) || depth < 0 || depth > Math.min(duty,1-duty)))
        throw new Error('正弦占空比深度须在 0 到 min(D₀, 1−D₀) 之间。');
    }
    const amplitude = type === 'svpwm' ? scale*modulation/2 : type === 'sine' ? (high-low)*depth : 0;
    const dc = type === 'svpwm' ? 0 : low+(high-low)*duty;
    const span = type === 'svpwm' ? 4*scale/3 : high-low;
    const tau = 1 / (TWO_PI * fc);
    const period = 1 / fs;
    const duration = 1 / fe;
    const gain = 1 / Math.sqrt(1 + (fe / fc) ** 2);
    const phase = -Math.atan(fe / fc);
    // Warm up before t=0. Residual error from arbitrary initial RC state < e^-18.
    // Extra signal on both sides supplies genuine ADC samples for interpolation.
    const storageStart = -roll, storageEnd = duration + roll;
    const first = Math.floor((storageStart - 18 * tau - 2 * period) / period);
    const last = Math.ceil(storageEnd / period);
    const starts = [], levels = [], initial = [];
    let t = first * period, y = 0, state = [0, 0, 0];
    const voltage = () => type === 'svpwm'
      ? scale * (state[0] - (state[0] + state[1] + state[2]) / 3)
      : low + (high-low)*state[0];

    function advance(end) {
      if (end <= t) return;
      const u = voltage();
      const a = Math.max(t, storageStart), b = Math.min(end, storageEnd);
      if (b > a) {
        starts.push(a);
        levels.push(u);
        initial.push(u + (y - u) * Math.exp(-(a - t) / tau));
      }
      y = u + (y - u) * Math.exp(-(end - t) / tau);
      t = end;
    }

    for (let n = first; n <= last; n++) {
      const theta = TWO_PI * fe * ((n + 0.5) * period);
      const abc = [0, -TWO_PI / 3, TWO_PI / 3].map(p => Math.sin(theta + p));
      // Min/max zero-sequence injection gives a center-aligned SVPWM equivalent.
      const zero = -(Math.max(...abc) + Math.min(...abc)) / 2;
      const duties = type === 'svpwm'
        ? abc.map(v => 0.5 + modulation * (v + zero) / 2)
        : [type === 'fixed' ? duty : duty+depth*Math.sin(theta)];
      const edges = [];
      duties.forEach((d, leg) => {
        edges.push({ time: (n + (alignment === 'center' ? (1-d)/2 : 0)) * period, leg, on: 1 });
        edges.push({ time: (n + (alignment === 'center' ? (1+d)/2 : d)) * period, leg, on: 0 });
      });
      edges.sort((a, b) => a.time - b.time);
      for (let j = 0; j < edges.length;) {
        advance(edges[j].time);
        const edgeTime = edges[j].time;
        // Simultaneous switches must not create fictitious narrow voltage pulses.
        do { state[edges[j].leg] = edges[j].on; j++; }
        while (j < edges.length && Math.abs(edges[j].time - edgeTime) < 1e-13);
      }
      advance((n + 1) * period);
    }
    starts.push(storageEnd);
    let ts = Float64Array.from(starts);
    let us = Float64Array.from(levels);
    let ys = Float64Array.from(initial);

    // Startup is an added homogeneous response. Negative-time samples describe
    // the pre-start steady signal; the record is split at zero before correction.
    function index(x) {
      let lo = 0, hi = us.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (ts[mid] <= x) lo = mid + 1; else hi = mid;
      }
      return Math.max(0, Math.min(us.length - 1, lo - 1));
    }
    function raw(x) { return us[index(Math.max(storageStart, Math.min(storageEnd, x)))]; }
    function filtered(x) {
      x = Math.max(storageStart, Math.min(storageEnd, x));
      const j = index(x);
      return us[j] + (ys[j] - us[j]) * Math.exp(-(x - ts[j]) / tau);
    }
    if (startup) {
      const zeroIndex=index(0), zeroState=filtered(0), delta=initialValue-zeroState;
      if (ts[zeroIndex] < 0) {
        const splitTimes=[...ts], splitLevels=[...us], splitValues=[...ys];
        splitTimes.splice(zeroIndex+1,0,0);
        splitLevels.splice(zeroIndex+1,0,us[zeroIndex]);
        splitValues.splice(zeroIndex+1,0,zeroState);
        ts=Float64Array.from(splitTimes); us=Float64Array.from(splitLevels); ys=Float64Array.from(splitValues);
      }
      for (let j=index(0);j<us.length;j++) ys[j]+=delta*Math.exp(-ts[j]/tau);
    }
    const reference = x => dc+amplitude*Math.sin(TWO_PI * fe * x);
    const filteredReference = x => dc+amplitude*gain*Math.sin(TWO_PI * fe * x + phase);

    // A min/max envelope preserves pulses that are denser than screen pixels.
    function envelope(a, b, bins) {
      const result = [];
      let j = index(a);
      for (let k = 0; k < bins; k++) {
        const left = a + (b - a) * k / bins;
        const right = a + (b - a) * (k + 1) / bins;
        let rmin = Infinity, rmax = -Infinity, fmin = Infinity, fmax = -Infinity;
        while (j < us.length && ts[j] < right) {
          const s = Math.max(left, ts[j]), e = Math.min(right, ts[j + 1]);
          if (e >= s) {
            const ya = us[j] + (ys[j] - us[j]) * Math.exp(-(s - ts[j]) / tau);
            const yb = us[j] + (ys[j] - us[j]) * Math.exp(-(e - ts[j]) / tau);
            rmin = Math.min(rmin, us[j]); rmax = Math.max(rmax, us[j]);
            fmin = Math.min(fmin, ya, yb); fmax = Math.max(fmax, ya, yb);
          }
          if (ts[j + 1] >= right) break;
          j++;
        }
        result.push({ x: (left + right) / 2, rmin, rmax, fmin, fmax });
      }
      return result;
    }

    function local(a, b) {
      const steps = [{ x: a, y: raw(a) }];
      const points = new Set([a, b]);
      for (let k = 1; k < 500; k++) points.add(a + (b - a) * k / 500);
      for (let j = index(a); j < us.length && ts[j] <= b; j++) {
        if (ts[j] > a) steps.push({ x: ts[j], y: us[j] });
        if (ts[j] >= a) points.add(ts[j]);
        // Resolve even very fast exponential transitions close to each edge.
        for (const q of [0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 12]) {
          const x = ts[j] + q * tau;
          if (x > a && x < b && x < ts[j + 1]) points.add(x);
        }
      }
      steps.push({ x: b, y: raw(b) });
      const curve = [...points].sort((x, z) => x - z).map(x => ({ x, y: filtered(x) }));
      return { steps, curve };
    }

    // Expose exact interval integrals for physical conservation checks.
    function integrals(a = 0, b = duration) {
      let input = 0, output = 0;
      for (let j = index(a); j < us.length && ts[j] < b; j++) {
        const left = Math.max(a, ts[j]), right = Math.min(b, ts[j + 1]);
        const dt = right - left;
        if (dt <= 0) continue;
        const ya = us[j] + (ys[j] - us[j]) * Math.exp(-(left - ts[j]) / tau);
        input += us[j] * dt;
        output += us[j] * dt + (ya - us[j]) * tau * (-Math.expm1(-dt / tau));
      }
      return { input, output, boundary: tau * (filtered(b) - filtered(a)) };
    }
    return { fc, fe, fs, tau, period, duration, gain, phase, ts, us, ys,
      type, scale, modulation, high, low, duty, depth, alignment, startup, initialValue, amplitude, dc, span,
      raw, filtered, reference, filteredReference, envelope, local, integrals };
  }
  const api = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.PwmRcMathV20 = api;
})(typeof window === 'undefined' ? globalThis : window);
