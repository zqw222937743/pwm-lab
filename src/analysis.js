/* Actual signal analysis, independent of the RC transfer-function labels.
 * Analog quantities use closed-form event integrals. ADC data uses a 3-parameter
 * least-squares fit: DC + S sin(wt) + C cos(wt), without resampling the record.
 */
(function(host){
  'use strict';
  const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
  function analog(model,filtered){
    const w=2*Math.PI*model.fe,lambda=1/model.tau,T=model.duration;
    let sine=0,cosine=0,dc=0,square=0;
    for(let j=0;j<model.us.length;j++){
      const a=Math.max(0,model.ts[j]),b=Math.min(T,model.ts[j+1]);
      if(b<=a)continue;
      const dt=b-a,u=model.us[j],center=w*(a+b)/2;
      const factor=2*Math.sin(w*dt/2)/w;
      cosine+=u*factor*Math.cos(center);sine+=u*factor*Math.sin(center);
      dc+=u*dt;square+=u*u*dt;
      if(!filtered)continue;
      const delta=(model.ys[j]-u)*Math.exp(-(a-model.ts[j])*lambda);
      const er=Math.exp(-lambda*dt),angle=w*dt;
      // Stable numerator exp((-lambda+i*w)*dt)-1.
      const nr=Math.expm1(-lambda*dt)+er*(-2*Math.sin(angle/2)**2),ni=er*Math.sin(angle);
      const den=lambda*lambda+w*w,qr=(-lambda*nr+w*ni)/den,qi=(-lambda*ni-w*nr)/den;
      cosine+=delta*(qr*Math.cos(w*a)-qi*Math.sin(w*a));
      sine+=delta*(qr*Math.sin(w*a)+qi*Math.cos(w*a));
      const e1=-Math.expm1(-lambda*dt),e2=-Math.expm1(-2*lambda*dt);
      dc+=delta*e1/lambda;
      square+=2*u*delta*e1/lambda+delta*delta*e2/(2*lambda);
    }
    const S=2*sine/T,C=2*cosine/T,A=Math.hypot(S,C),mean=dc/T;
    return {amplitude:A,phase:A>model.span*1e-10?Math.atan2(C,S):NaN,dc:mean,
      residual:Math.sqrt(Math.max(0,square/T-mean*mean-A*A/2)),samples:null};
  }
  function solve(matrix,vector){
    const rows=matrix.map((row,i)=>[...row,vector[i]]);
    const scale=Math.max(...matrix.flat().map(Math.abs));
    for(let k=0;k<3;k++){
      let pivot=k;for(let i=k+1;i<3;i++)if(Math.abs(rows[i][k])>Math.abs(rows[pivot][k]))pivot=i;
      if(Math.abs(rows[pivot][k])<scale*1e-10)return null;
      [rows[k],rows[pivot]]=[rows[pivot],rows[k]];
      const denominator=rows[k][k];for(let j=k;j<4;j++)rows[k][j]/=denominator;
      for(let i=0;i<3;i++)if(i!==k){const factor=rows[i][k];for(let j=k;j<4;j++)rows[i][j]-=factor*rows[k][j];}
    }
    return rows.map(row=>row[3]);
  }
  function sampled(model,adc){
    const range=adc.sampleRange(0,model.duration),w=2*Math.PI*model.fe;
    const matrix=Array.from({length:3},()=>[0,0,0]),vector=[0,0,0];let square=0;
    if(range.count<4 || adc.fa<=2*model.fe)return {amplitude:NaN,phase:NaN,dc:NaN,residual:NaN,samples:range.count,valid:false};
    for(let i=range.first;i<range.end;i++){
      const basis=[1,Math.sin(w*adc.time(i)),Math.cos(w*adc.time(i))],v=adc.values[i];
      square+=v*v;
      for(let r=0;r<3;r++){vector[r]+=basis[r]*v;for(let c=0;c<3;c++)matrix[r][c]+=basis[r]*basis[c];}
    }
    const fit=solve(matrix,vector);
    if(!fit)return {amplitude:NaN,phase:NaN,dc:NaN,residual:NaN,samples:range.count,valid:false};
    const A=Math.hypot(fit[1],fit[2]),sse=Math.max(0,square-fit.reduce((sum,v,i)=>sum+v*vector[i],0));
    return {amplitude:A,phase:A>model.span*1e-10?Math.atan2(fit[2],fit[1]):NaN,
      dc:fit[0],residual:Math.sqrt(sse/range.count),samples:range.count,valid:true};
  }
  function evaluate(model,adc){
    const input=analog(model,false),rc=analog(model,true),sample=sampled(model,adc);
    return {input,rc,adc:sample,
      rcGain:input.amplitude>model.span*1e-8?rc.amplitude/input.amplitude:NaN,
      rcPhase:wrap(rc.phase-input.phase),
      adcAmplitudeError:input.amplitude>model.span*1e-8?100*(sample.amplitude-input.amplitude)/input.amplitude:NaN,
      adcPhaseError:wrap(sample.phase-input.phase),
      targetAmplitude:model.amplitude,targetDc:model.dc};
  }
  const api={analog,sampled,evaluate,wrap};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else host.PwmRcAnalysisV20=api;
})(typeof window==='undefined'?globalThis:window);
