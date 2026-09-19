/* Product shell shares the model controller's state; it never duplicates physics. */
(function(){
 'use strict';
 const root=document.getElementById('pwm-lab'),$=id=>document.getElementById(id);
 const api=window.PwmRcDemoV20;
 if(!api){$('compute-state').textContent='资源加载失败';return;}
 const number=value=>Number.isFinite(value)?new Intl.NumberFormat('zh-CN',{maximumSignificantDigits:innerWidth<600?4:6}).format(value):'—';
 function result(id,value,unit){$(id).textContent=number(value)+(Number.isFinite(value)?' '+unit:'');}
 function refresh(){
  const s=api.getState(),m=api.model(),a=api.adc(),h=api.analysis();
  const cycle=a.cycles[Math.max(0,Math.min(a.cycles.length-1,Math.floor(s.cursor*m.duration/m.period)))];
  const fundamental=s.target==='fundamental';
  $('compute-state').textContent=s.valid?'计算完成':'参数待修正';
  root.querySelector('.result-strip').classList.toggle('is-stale',!s.valid);
  root.querySelectorAll('[data-target]').forEach(button=>{
   button.setAttribute('aria-pressed',String(button.dataset.target===s.target));
   button.disabled=m.type==='fixed'&&button.dataset.target==='fundamental';
  });
  $('analysis-mode').textContent=fundamental?'基波幅相':'周期积分';
  $('signal-description').textContent={svpwm:'三相调制的组合输出信号',sine:'随正弦变化的占空比',fixed:'固定占空比的两电平信号'}[m.type];
  result('level-high',m.type==='svpwm'?2*m.scale/3:m.high,'V');
  result('level-low',m.type==='svpwm'?-2*m.scale/3:m.low,'V');
  result('level-amplitude',m.amplitude,'V');result('level-span',m.span,'V');
  $('metric-one-label').textContent=fundamental?'原始 PWM 基波峰值':'真实周期均值';
  $('metric-two-label').textContent=fundamental?'ADC 基波峰值':'ADC 周期均值';
  $('metric-three-label').textContent=fundamental?'ADC 相位偏差':'ADC 绝对偏差';
  result('metric-one',fundamental?h.input.amplitude:cycle.truth,'V');
  result('metric-two',fundamental?h.adc.amplitude:cycle.adc,'V');
  result('metric-three',fundamental?h.adcPhaseError*180/Math.PI:cycle.adc-cycle.truth,fundamental?'°':'V');
  $('metric-one-note').textContent=fundamental?'实际 PWM 波形提取':'原始 PWM 连续积分';
  $('metric-two-note').textContent=fundamental?`${h.adc.samples} 个样本拟合`:`本周期 ${cycle.count} 个采样点`;
  $('metric-three-note').textContent=fundamental?`幅值偏差 ${number(h.adcAmplitudeError)}%`:'ADC − 原始 PWM';
  const basis=$('pwm-basis').value;
  const reference=basis==='span'?m.span:basis==='amplitude'?m.amplitude:Math.abs(cycle.truth);
  $('basis-explanation').textContent=`百分比 =（估计均值 − 真实均值）÷ ${number(reference)} V × 100%。`+
   (basis==='span'?`电平跨度 = ${number(m.type==='svpwm'?2*m.scale/3:m.high)} −（${number(m.type==='svpwm'?-2*m.scale/3:m.low)}）V。`:basis==='amplitude'?'分母为目标基波峰值。':'分母随载波周期变化；接近零时隐藏百分比，保留绝对偏差。');
 }
 root.addEventListener('pwm:updated',refresh);
 root.querySelectorAll('[data-target]').forEach(button=>button.addEventListener('click',()=>{
  $('pwm-target').value=button.dataset.target;$('pwm-target').dispatchEvent(new Event('change',{bubbles:true}));refresh();
 }));
 $('pwm-basis').addEventListener('change',refresh);
 $('parameters-toggle').addEventListener('click',()=>{
  const open=root.querySelector('.app-body').classList.toggle('parameters-open');
  $('parameters-toggle').setAttribute('aria-expanded',String(open));
  if(open)root.querySelector('.sidebar').scrollIntoView({block:'start',behavior:'instant'});
 });
 $('theme-toggle').addEventListener('click',()=>{
  const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;try{localStorage.setItem('pwm-lab-theme',next);}catch{}
  $('theme-toggle').setAttribute('aria-label',next==='dark'?'切换至浅色主题':'切换至深色主题');
 });
 // Expose native help with accessible, permanent text rather than hover-only help.
 for(const input of root.querySelectorAll('[data-tooltip]')){
  const help=document.createElement('span');help.className='parameter-help';help.textContent=input.dataset.tooltip;
  help.id=input.id+'-help';input.setAttribute('aria-describedby',help.id);input.parentElement.append(help);
 }
 const guide=$('pwm-adc-guide');
 const closeGuide=()=>guide.open&&guide.close();
 $('pwm-adc-guide-open').addEventListener('click',()=>guide.showModal());
 $('pwm-adc-guide-close').addEventListener('click',closeGuide);
 $('pwm-adc-guide-done').addEventListener('click',closeGuide);
 guide.addEventListener('click',event=>{if(event.target===guide)closeGuide();});
 root.querySelectorAll('[data-adc-preset]').forEach(button=>button.addEventListener('click',()=>{
  const hardware=$('pwm-hardware');
  if(button.dataset.adcPreset==='ideal'){
   hardware.checked=false;hardware.dispatchEvent(new Event('change',{bubbles:true}));return;
  }
  hardware.checked=true;
  Object.assign($('pwm-bits'),{value:12});Object.assign($('pwm-adc-min'),{value:-100});Object.assign($('pwm-adc-max'),{value:100});
  Object.assign($('pwm-adc-gain'),{value:1});Object.assign($('pwm-adc-offset'),{value:0});Object.assign($('pwm-adc-noise'),{value:0});
  $('pwm-bits').dispatchEvent(new Event('input',{bubbles:true}));
 }));
 refresh();
})();
