/* Optional structured access to the same observation workflow as the UI.
   Unsupported browsers keep the complete normal product functionality. */
(function(){
 'use strict';
 const context=document.modelContext,api=window.PwmRcDemoV20;
 if(!context?.registerTool||!api)return;
 const lifecycle=new AbortController();
 const snapshot=()=>{
  const s=api.getState(),m=api.model(),a=api.adc();
  const cycle=a.cycles[Math.min(a.cycles.length-1,Math.floor(s.cursor*m.duration/m.period))];
  return {state:s,selectedCycle:{index:cycle.index,count:cycle.count,trueMeanV:cycle.truth,adcMeanV:cycle.adc,
   compensatedMeanV:cycle.corrected},analysis:api.analysis()};
 };
 const tools=[{
  name:'read_pwm_analysis',title:'读取 PWM 分析结果',description:'读取当前参数、选中周期和实际基波分析。',
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,untrustedContentHint:false},
  execute:input=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('此操作不接受参数。');return snapshot();}
 },{
  name:'set_pwm_observation',title:'设置 PWM 观察位置',description:'选择周期积分或基波分析，并定位观察窗口。不会改变信号或采样参数。',
  inputSchema:{type:'object',properties:{target:{type:'string',enum:['cycle','fundamental']},position:{type:'number',minimum:0,maximum:1}},additionalProperties:false},
  annotations:{readOnlyHint:false,untrustedContentHint:false},
  execute:input=>{
   if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['target','position'].includes(key)))throw new Error('无效观察参数。');
   if(input.target!==undefined&&!['cycle','fundamental'].includes(input.target))throw new Error('无效测量目标。');
   if(input.position!==undefined&&(!Number.isFinite(input.position)||input.position<0||input.position>1))throw new Error('观察位置须在 0–1。');
   if(!api.getState().valid)throw new Error('请先修正当前参数。');
   if(input.target==='fundamental'&&api.model().type==='fixed')throw new Error('固定占空比没有目标基波。');
   if(input.target){const target=document.getElementById('pwm-target');target.value=input.target;target.dispatchEvent(new Event('change',{bubbles:true}));}
   if(input.position!==undefined){const timeline=document.getElementById('pwm-time');timeline.value=Math.round(input.position*1000);timeline.dispatchEvent(new Event('input',{bubbles:true}));timeline.dispatchEvent(new Event('change',{bubbles:true}));}
   document.getElementById('pwm-lab').dispatchEvent(new CustomEvent('pwm:updated'));return snapshot();
  }
 }];
 for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
 addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
})();
