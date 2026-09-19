/* Independent reference quadrature and scenario checks for the broader product. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const waveform=require('../src/model.js'),sample=require('../src/adc.js'),analysis=require('../src/analysis.js');
const common={fc:10000,fe:50,fs:20000,roll:5e-6};
const reports=[];
function near(a,b,tolerance=1e-8){assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);}
// Closed-form event integral is checked against an independently sampled midpoint rule.
function quadrature(m,filtered){
  let sine=0,cosine=0,mean=0,square=0;const w=2*Math.PI*m.fe;
  for(let j=0;j<m.us.length;j++){
    const a=Math.max(0,m.ts[j]),b=Math.min(m.duration,m.ts[j+1]);if(b<=a)continue;
    const count=Math.max(8,Math.ceil((b-a)/Math.min(m.tau/120,m.period/100))),dt=(b-a)/count;
    for(let k=0;k<count;k++){const t=a+(k+.5)*dt,v=filtered?m.filtered(t):m.raw(t);
      sine+=v*Math.sin(w*t)*dt;cosine+=v*Math.cos(w*t)*dt;mean+=v*dt;square+=v*v*dt;}
  }
  const amplitude=2*Math.hypot(sine,cosine)/m.duration,dc=mean/m.duration;
  return {amplitude,phase:Math.atan2(cosine,sine),dc,residual:Math.sqrt(Math.max(0,square/m.duration-dc*dc-amplitude*amplitude/2))};
}
for(const config of [
  {type:'svpwm',scale:100,modulation:.8},{type:'svpwm',scale:3.3,modulation:1},
  {type:'sine',high:5,low:0,duty:.5,depth:.4},
  {type:'sine',high:5,low:-5,duty:.4,depth:.3,alignment:'edge'},
  {type:'fixed',high:100,low:0,duty:.05},{type:'fixed',high:3.3,low:0,duty:0},
  {type:'fixed',high:3.3,low:-1,duty:1},{type:'sine',high:5,low:0,duty:.5,depth:.4,startup:true,initialValue:4}
]){
  const m=waveform.build({...common,...config}),adc=sample.build(m,{fa:200000,phase:0,method:'trapezoid'});
  const results=analysis.evaluate(m,adc);
  for(const filtered of [false,true]){
    const actual=analysis.analog(m,filtered),reference=quadrature(m,filtered);
    near(actual.amplitude,reference.amplitude,m.span*2e-6);
    near(actual.dc,reference.dc,m.span*2e-6);
    near(actual.residual,reference.residual,m.span*2e-5);
    if(actual.amplitude>m.span*1e-6)near(analysis.wrap(actual.phase-reference.phase),0,2e-5);
  }
  for(const c of [adc.cycles[0],adc.cycles[99],adc.cycles.at(-1)]){
    const exact=m.integrals(c.a,c.b);near(exact.input,exact.output+exact.boundary,1e-9);
  }
  if(config.startup)near(m.filtered(0),config.initialValue,1e-9);
  if(config.type==='fixed'){
    near(m.integrals().input/m.duration,m.dc,1e-8);
    near(m.integrals().output/m.duration,m.dc,1e-8);
  }
  reports.push({config,results});
}
// Changing amplitude scales the entire physical solution while preserving gain/phase.
const m1=waveform.build(common),m2=waveform.build({...common,scale:250});
for(const t of [0,.000013,.003,.01,.01999]){near(m2.raw(t),2.5*m1.raw(t));near(m2.filtered(t),2.5*m1.filtered(t),1e-8);}
const h=analysis.evaluate(m1,sample.build(m1,{fa:200000}));near(h.rcGain,m1.gain,1e-8);near(h.rcPhase,m1.phase,1e-8);
// Known pure sine at arbitrary, noninteger sample count verifies ADC LS phase/DC.
const synthetic={fa:230001,values:Float64Array.from({length:4601},(_,i)=>7+2*Math.sin(2*Math.PI*50*i/230001+.31)),
  time:i=>i/230001,sampleRange:()=>({first:0,end:4601,count:4601})};
const fit=analysis.sampled(m1,synthetic);near(fit.amplitude,2,1e-10);near(fit.phase,.31,1e-10);near(fit.dc,7,1e-10);
assert.equal(analysis.sampled(m1,{...synthetic,fa:100}).valid,false);
// Hardware model: quantization, clipping, gain/offset and deterministic noise.
const config={fa:200000,hardware:{bits:8,min:-10,max:10,gain:1.02,offset:.1,noise:.03}};
const a=sample.build(m1,config),b=sample.build(m1,config);
assert.ok(a.clipped>0);assert.deepEqual(a.values,b.values);
for(const value of a.values){assert.ok(value>=-10&&value<=10);near((value+10)/20*255,Math.round((value+10)/20*255),1e-10);}
near(sample.error({truth:20,adc:21,span:40,amplitude:10},'adc','span'),2.5);
near(sample.error({truth:20,adc:21,span:40,amplitude:10},'adc','amplitude'),10);
assert.throws(()=>waveform.build({...common,type:'sine',duty:.1,depth:.2}));
assert.throws(()=>waveform.build({...common,scale:0}));
assert.throws(()=>sample.build(m1,{fa:200000,hardware:{...config.hardware,bits:1}}));
const report={status:'passed',reports,knownSineFit:fit,hardwareClipped:a.clipped,
  checks:['3 waveform types','signal amplitude scaling','0/100% and 5% duty','edge/center alignment',
    'startup initial state','RC conservation','independent harmonic quadrature','ADC least squares',
    'quantization/clipping/gain/offset/noise repeatability','error references','validation']};
fs.writeFileSync(path.join(__dirname,'artifacts/product-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:'passed',scenarios:reports.length,fit,clipped:a.clipped}));
