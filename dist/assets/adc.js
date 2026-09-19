/* Uniform ADC clock and per-carrier integral reconstruction.
 * Compensation uses interpolated ADC boundary voltages, not hidden exact values.
 */
(function (host) {
  'use strict';
  const MIN_RATE = 100, MAX_RATE = 2000000;
  function validate(fa, phase) {
    if (!Number.isFinite(fa) || fa < MIN_RATE || fa > MAX_RATE ||
        !Number.isFinite(phase) || phase < 0 || phase >= 1) {
      throw new Error('ADC 采样率范围为 100–2000000 S/s，采样相位须在 0–100% 之间且不含 100%。');
    }
  }
  function build(model, { fa, phase = 0, method = 'mean', hardware = null }) {
    validate(fa, phase);
    if (!['mean', 'trapezoid'].includes(method)) throw new Error('未知积分方法。');
    if (hardware && (![hardware.min,hardware.max,hardware.gain,hardware.offset,hardware.noise].every(Number.isFinite) ||
        hardware.max <= hardware.min || Math.max(Math.abs(hardware.min),Math.abs(hardware.max))>100000 ||
        hardware.max-hardware.min<0.001 || hardware.gain < 0.01 || hardware.gain>10 ||
        Math.abs(hardware.offset)>100000 || hardware.noise<0 || hardware.noise>100000 ||
        !Number.isInteger(hardware.bits) || hardware.bits<2 || hardware.bits>24))
      throw new Error('ADC 范围须递增且跨度 ≥0.001 V；位数 2–24；增益 0.01–10；零偏与噪声不超过 100000 V。');
    let seed=123456789, clipped=0;
    const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return ((seed>>>0)+0.5)/4294967296;};
    const gaussian=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
    const dt = 1 / fa;
    if (model.ts[0] > -dt + 1e-12 || model.ts.at(-1) < model.duration + dt - 1e-12) {
      throw new Error('ADC 边界插值需要前后各一个采样间隔的实际 RC 响应。');
    }
    const kmin = Math.floor(-phase);
    const kmax = Math.ceil(model.duration * fa - phase);
    const values = new Float64Array(kmax - kmin + 1);
    const sum = new Float64Array(values.length + 1);
    const area = new Float64Array(values.length);
    let j = 0;
    for (let i = 0; i < values.length; i++) {
      const t = (kmin + i + phase) * dt;
      while (j + 1 < model.us.length && model.ts[j + 1] <= t) j++;
      values[i] = model.us[j] + (model.ys[j] - model.us[j]) * Math.exp(-(t - model.ts[j]) / model.tau);
      if (hardware) {
        let value=values[i]*hardware.gain+hardware.offset+(hardware.noise ? hardware.noise*gaussian() : 0);
        if (value<hardware.min || value>hardware.max) clipped++;
        value=Math.max(hardware.min,Math.min(hardware.max,value));
        const lsb=(hardware.max-hardware.min)/(2**hardware.bits-1);
        values[i]=hardware.min+Math.round((value-hardware.min)/lsb)*lsb;
      }
      sum[i + 1] = sum[i] + values[i];
      if (i > 0) area[i] = area[i - 1] + (values[i - 1] + values[i]) * dt / 2;
    }
    const time = i => (kmin + i + phase) * dt;
    function location(t) {
      const q = t * fa - phase - kmin;
      return Math.max(0, Math.min(values.length - 2, Math.floor(q)));
    }
    function interpolated(t) {
      const i = location(t), fraction = (t - time(i)) / dt;
      return values[i] + fraction * (values[i + 1] - values[i]);
    }
    function primitive(t) {
      const i = location(t), width = t - time(i);
      return area[i] + values[i] * width + (values[i + 1] - values[i]) * width * width / (2 * dt);
    }
    function ceilClock(q) {
      // Half-open carrier windows must not double-count grid-aligned samples.
      return Math.ceil(q - 32 * Number.EPSILON * Math.max(1, Math.abs(q)));
    }
    function sampleRange(a, b) {
      const first = Math.max(0, ceilClock(a * fa - phase) - kmin);
      const end = Math.min(values.length, ceilClock(b * fa - phase) - kmin);
      return { first, end, count: Math.max(0, end - first) };
    }
    const cycles = [];
    const cycleCount = Math.floor(model.duration / model.period + 1e-9);
    for (let n = 0; n < cycleCount; n++) {
      const a = n * model.period, b = Math.min(model.duration, (n + 1) * model.period);
      const T = b - a, exact = model.integrals(a, b), range = sampleRange(a, b);
      // Mean estimator intentionally reproduces the user's "N points per PWM" rule.
      // Trapezoid integrates the globally interpolated ADC signal over the full window.
      const adcVs = method === 'mean'
        ? (range.count ? T * (sum[range.end] - sum[range.first]) / range.count : NaN)
        : primitive(b) - primitive(a);
      const boundaryVs = model.tau * (interpolated(b) - interpolated(a));
      cycles.push({ index: n, a, b, x: (a + b) / 2, count: range.count,
        truthVs: exact.input, analogVs: exact.output, adcVs,
        correctedVs: adcVs + boundaryVs, boundaryVs,
        span:model.span, amplitude:model.amplitude, truth: exact.input / T, analog: exact.output / T,
        adc: adcVs / T, corrected: (adcVs + boundaryVs) / T });
    }
    function points(a, b, limit = 1400) {
      const range = sampleRange(a, b + 1e-13);
      const stride = Math.max(1, Math.ceil(range.count / limit));
      const points = [];
      for (let i = range.first; i < range.end; i += stride) points.push({ x: time(i), y: values[i] });
      return { points, stride, total: range.count };
    }
    const counts = cycles.reduce((range,c) => [Math.min(range[0],c.count),Math.max(range[1],c.count)],[Infinity,-Infinity]);
    return { fa, phase, method, hardware, clipped, dt, values, cycles, time, interpolated, points, sampleRange,
      minCount:counts[0], maxCount:counts[1] };
  }
  function error(cycle, kind, basis) {
    const estimate = kind === 'analog' ? cycle.analog : kind === 'adc' ? cycle.adc : cycle.corrected;
    // References describe the signal, not an ADC manufacturer's accuracy spec.
    const denominator = basis === 'relative' ? Math.abs(cycle.truth)
      : basis === 'amplitude' ? cycle.amplitude : (cycle.span ?? 100);
    const threshold=basis==='relative' ? Math.max(1e-9,(cycle.span??100)*1e-4) : 1e-12;
    if (!Number.isFinite(estimate) || !Number.isFinite(denominator) || denominator < threshold) return NaN;
    return 100 * (estimate - cycle.truth) / denominator;
  }
  const api = { build, validate, error, MIN_RATE, MAX_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.PwmRcAdcV20 = api;
})(typeof window === 'undefined' ? globalThis : window);
