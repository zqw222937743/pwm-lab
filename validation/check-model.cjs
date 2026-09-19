/* Independent physics checks of the event-driven RC model. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../src/model.js');
const results = [];
const cases = [
  { fc:10000, fe:50, fs:20000 }, { fc:1000, fe:50, fs:20000 },
  { fc:2000, fe:100, fs:20000 }, { fc:10000, fe:5000, fs:20000 },
  { fc:20, fe:50, fs:20000 }, { fc:200000, fe:50, fs:20000 },
  { fc:1000, fe:73, fs:20000 }, { fc:1000, fe:400, fs:1000 }
];
for (const parameters of cases) {
  const m = build(parameters);
  assert.equal(m.ts.length, m.us.length + 1);
  assert.equal(m.ts[0], 0);
  assert.equal(m.ts[m.ts.length - 1], m.duration);
  let maxContinuityError = 0;
  for (let j = 0; j < m.us.length; j++) {
    assert.ok(m.ts[j+1] > m.ts[j]);
    assert.ok(Math.abs(m.us[j]) <= 200/3 + 1e-10);
    if (j+1 < m.us.length) {
      const end = m.us[j] + (m.ys[j] - m.us[j]) * Math.exp(-(m.ts[j+1] - m.ts[j])/m.tau);
      maxContinuityError = Math.max(maxContinuityError, Math.abs(end - m.ys[j+1]));
    }
  }
  assert.ok(maxContinuityError < 1e-7);
  const integral = m.integrals();
  const conservationError = Math.abs(integral.input - integral.output - integral.boundary);
  assert.ok(conservationError < 1e-8);
  const env = m.envelope(0, m.duration, 640);
  assert.ok(env.every(p => [p.rmin,p.rmax,p.fmin,p.fmax].every(Number.isFinite)));
  assert.ok(env.every(p => p.rmin <= p.rmax && p.fmin <= p.fmax));
  const local = m.local(0, Math.min(5*m.period,m.duration));
  assert.ok(local.curve.every(p => Number.isFinite(p.y)));
  results.push({ parameters, segments:m.us.length, gain:m.gain,
    phaseDeg:m.phase*180/Math.PI, maxContinuityError, conservationError });
}

// Fit both actual PWM and actual RC with exact sinusoidal projections over 20 ms.
// This tests the solver against the transfer function, not just its displayed formula.
const m = build(cases[0]);
function harmonic(filtered) {
  const w = 2*Math.PI*m.fe, lambda = 1/m.tau;
  let re = 0, im = 0;
  for (let j=0; j<m.us.length; j++) {
    const a=m.ts[j], b=m.ts[j+1], dt=b-a, u=m.us[j];
    re += u*(Math.sin(w*b)-Math.sin(w*a))/w;
    im += u*(Math.cos(w*b)-Math.cos(w*a))/w;
    if (filtered) {
      const er=Math.exp(-lambda*dt), c=Math.cos(w*dt), s=Math.sin(w*dt);
      // Integral exp(-lambda*s) exp(-i*w*s), then rotate by exp(-i*w*a).
      const nr=1-er*c, ni=er*s, den=lambda*lambda+w*w;
      const qr=(nr*lambda+ni*w)/den, qi=(ni*lambda-nr*w)/den;
      const ca=Math.cos(w*a), sa=Math.sin(w*a), amplitude=m.ys[j]-u;
      re += amplitude*(qr*ca+qi*sa);
      im += amplitude*(qi*ca-qr*sa);
    }
  }
  return { amplitude:2*Math.hypot(re,im)/m.duration, phase:Math.atan2(im,re) };
}
const input = harmonic(false), output = harmonic(true);
const measuredGain = output.amplitude/input.amplitude;
const measuredPhase = output.phase-input.phase;
assert.ok(Math.abs(measuredGain-m.gain)<1e-7);
assert.ok(Math.abs(measuredPhase-m.phase)<1e-7);

// Independently check periodic unipolar PWM: large ripple does not scale its mean.
const tau=1/(2*Math.PI*10000), T=50e-6, width=10e-6, U=100;
const ymax=U*(1-Math.exp(-width/tau))/(1-Math.exp(-T/tau));
const ymin=ymax*Math.exp(-(T-width)/tau);
const mean=(U*width+(ymin-U)*tau*(1-Math.exp(-width/tau))+
  ymax*tau*(1-Math.exp(-(T-width)/tau)))/T;
assert.ok(Math.abs(mean-20)<1e-10);
assert.throws(()=>build({fc:10000,fe:5000,fs:10000}));
assert.throws(()=>build({fc:NaN,fe:50,fs:20000}));
const report = { status:'passed', cases:results,
  harmonic:{input,output,measuredGain,measuredPhase}, periodicPwmMean:mean };
fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'artifacts/model-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:'passed',cases:results.length,measuredGain,
  measuredPhaseDeg:measuredPhase*180/Math.PI,periodicPwmMean:mean}));
