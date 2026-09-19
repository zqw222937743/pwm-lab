/* Independent ADC window counts, quadrature and boundary-estimator checks. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {build:waveform}=require('../src/model.js');
const {build:sample,error}=require('../src/adc.js');
const reports=[];
const configurations=[
  {fa:200000,phase:0,method:'mean'},
  {fa:200000,phase:0.499,method:'mean'},
  {fa:200000,phase:0.999,method:'mean'},
  {fa:230000,phase:0.317,method:'mean'},
  {fa:230000,phase:0.317,method:'trapezoid'},
  {fa:100,phase:0.5,method:'mean'},
  {fa:100,phase:0.5,method:'trapezoid'}
];
for(const config of configurations){
  const m=waveform({fc:10000,fe:50,fs:20000,roll:1/config.fa});
  const adc=sample(m,config);
  assert.equal(adc.cycles.length,400);
  if(config.fa===200000)assert.ok(adc.cycles.every(c=>c.count===10));
  if(config.fa===230000){assert.equal(adc.minCount,11);assert.equal(adc.maxCount,12);}
  for(const c of [adc.cycles[0],adc.cycles[19],adc.cycles[99],adc.cycles[199],adc.cycles[399]]){
    const actualTimes=[];
    for(let k=-1;k<=Math.ceil(m.duration*config.fa);k++){
      const t=(k+config.phase)/config.fa;
      if(t>=c.a-1e-14 && t<c.b-1e-14)actualTimes.push(t);
    }
    assert.equal(actualTimes.length,c.count);
    if(config.method==='mean' && actualTimes.length){
      const mean=actualTimes.reduce((sum,t)=>sum+m.filtered(t),0)/actualTimes.length;
      assert.ok(Math.abs(mean-c.adc)<1e-8);
    }
    // Independently integrate each clipped interval between genuine ADC samples.
    if(config.method==='trapezoid'){
      let integral=0;
      const begin=Math.floor(c.a*config.fa-config.phase);
      const end=Math.ceil(c.b*config.fa-config.phase);
      for(let k=begin;k<end;k++){
        const ta=(k+config.phase)/config.fa,tb=(k+1+config.phase)/config.fa;
        const a=Math.max(c.a,ta),b=Math.min(c.b,tb);
        if(b<=a)continue;
        const ya=m.filtered(ta),yb=m.filtered(tb);
        const left=ya+(yb-ya)*(a-ta)/(tb-ta),right=ya+(yb-ya)*(b-ta)/(tb-ta);
        integral+=(left+right)*(b-a)/2;
      }
      assert.ok(Math.abs(integral-c.adcVs)<1e-9);
    }
    const correction=m.tau*(adc.interpolated(c.b)-adc.interpolated(c.a));
    assert.ok(Math.abs(correction-c.boundaryVs)<1e-12);
    // Exact RC conservation is an independent identity, not the ADC correction.
    const exact=m.integrals(c.a,c.b);
    assert.ok(Math.abs(exact.input-exact.output-exact.boundary)<1e-10);
  }
  if(config.fa===100 && config.method==='mean'){
    assert.equal(adc.minCount,0);assert.ok(adc.cycles.some(c=>Number.isNaN(c.adc)));
  }
  const errors=adc.cycles.map(c=>error(c,'adc','span')).filter(Number.isFinite);
  reports.push({...config,minCount:adc.minCount,maxCount:adc.maxCount,
    peakErrorPercent:Math.max(...errors.map(Math.abs)),finiteCycles:errors.length});
}
assert.ok(Number.isNaN(error({truth:0,adc:1},'adc','relative')));
assert.equal(error({truth:20,adc:21,span:100},'adc','span'),1);
assert.equal(error({truth:20,adc:21},'adc','relative'),5);
assert.throws(()=>sample(waveform({fc:10000,fe:50,fs:20000}),{fa:200000}));
fs.writeFileSync(path.join(__dirname,'artifacts/adc-results.json'),JSON.stringify({status:'passed',reports},null,2));
console.log(JSON.stringify({status:'passed',reports}));
