/* Responsive D3 plots, exact-time hover inspection and finite slow-motion playback. */
(function () {
  'use strict';
  const root = document.getElementById('pwm-lab');
  const $ = id => root.querySelector('#' + id);
  const error = $('pwm-error');
  if (!window.d3 || !window.PwmRcMathV20 || !window.PwmRcAdcV20 || !window.PwmRcAnalysisV20) {
    error.hidden = false;
    error.textContent = '绘图资源未加载，请检查网络后重新打开。';
    return;
  }
  const d3 = window.d3;
  const fields = { fc: $('pwm-fc'), fe: $('pwm-fe'), fs: $('pwm-fs'), fa: $('pwm-fa'), n: $('pwm-n'), scale:$('pwm-scale'), modulation:$('pwm-modulation'),
    high:$('pwm-high'),low:$('pwm-low'),duty:$('pwm-duty'),depth:$('pwm-depth'),window:$('pwm-window'),
    initial:$('pwm-initial'),bits:$('pwm-bits'),min:$('pwm-adc-min'),max:$('pwm-adc-max'),
    gain:$('pwm-adc-gain'),offset:$('pwm-adc-offset'),noise:$('pwm-adc-noise') };
  const visibility = { raw: true, rc: true, ref: true, analog: true, adc: true, comp: false };
  const colors = { raw: 'var(--viz-series-1)', rc: 'var(--viz-series-2)', ref: 'var(--viz-series-3)',
    adc: 'var(--viz-series-4)', comp: 'var(--viz-series-5)', analog: 'var(--viz-series-6)' };
  let model, adc, analysis, valid = false, cursor = 0, playing = false, previousFrame = 0, previousDraw = 0;
  let timer, overviewChart, errorChart, localCharts = [], domain;
  const plots = {
    overview: d3.select($('pwm-overview')),
    before: d3.select($('pwm-before')),
    after: d3.select($('pwm-after')),
    error: d3.select($('pwm-integral-error'))
  };
  const tooltip = $('pwm-tooltip');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  function format(value) {
    if(!Number.isFinite(value))return '—';
    const text=d3.format('.5~g')(value);
    return text.length>8?value.toExponential(2):text;
  }
  function syncLayout() {
    const type=$('pwm-type').value,fixed=type==='fixed';
    $('pwm-sv-settings').hidden=type!=='svpwm';$('pwm-single-settings').hidden=type==='svpwm';
    $('pwm-depth-label').hidden=type!=='sine';$('pwm-fe-label').hidden=fixed;$('pwm-window-label').hidden=!fixed;
    fields.depth.max=Math.min(Number(fields.duty.value),1-Number(fields.duty.value));
    $('pwm-initial-label').hidden=$('pwm-startup').value!=='startup';
    $('pwm-hardware-settings').hidden=!$('pwm-hardware').checked;
    $('pwm-target').querySelector('[value="fundamental"]').disabled=fixed;
    $('pwm-basis').querySelector('[value="amplitude"]').disabled=fixed;
    if(fixed){$('pwm-target').value='cycle';if($('pwm-basis').value==='amplitude')$('pwm-basis').value='span';}
    $('pwm-cycle-panel').hidden=$('pwm-target').value!=='cycle';
    $('pwm-fundamental-panel').hidden=$('pwm-target').value!=='fundamental';
    $('pwm-theory-base').hidden=fixed;
  }
  function drawAnalysis() {
    if(!analysis)return;
    const rows=[{label:'目标信号',amplitude:model.amplitude,phase:model.amplitude?0:NaN,dc:model.dc,residual:0},
      {label:'原始 PWM',...analysis.input},{label:'RC 输出',...analysis.rc},{label:'ADC 样本',...analysis.adc}];
    const body=$('pwm-fundamental-table');body.replaceChildren();
    for(const row of rows){
      const tr=document.createElement('tr');
      for(const value of [row.label,row.amplitude,row.phase*180/Math.PI,row.dc,row.residual]){
        const cell=document.createElement('td');cell.textContent=typeof value==='string'?value:format(value);
        if(typeof value!=='string')cell.className='numeric';tr.append(cell);
      }body.append(tr);
    }
    $('pwm-fundamental-summary').textContent=`ADC 相对原始 PWM：幅值偏差 ${format(analysis.adcAmplitudeError)}% · 相位差 ${format(analysis.adcPhaseError*180/Math.PI)}°。`+
      `模拟波形按整窗口积分，ADC 使用 ${analysis.adc.samples} 个样本拟合。残差 RMS 包含基波和直流之外的成分，不等同于 20 kHz 纹波幅值。`;
  }
  function configuration() {
    return {version:'2.1.0',signalType:$('pwm-type').value,target:$('pwm-target').value,
      parameters:Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,Number(field.value)])),
      alignment:$('pwm-alignment').value,startup:$('pwm-startup').value==='startup',hardwareEnabled:$('pwm-hardware').checked,
      holdMode:$('pwm-hold').value,samplePhase:Number($('pwm-sample-phase').value)/100,
      boundaryCompensation:visibility.comp,
      integrationMethod:$('pwm-method').value,errorBasis:$('pwm-basis').value};
  }
  function setExports(enabled) {
    const available=window.PwmRcLocalExports===true;
    ['pwm-save','pwm-export-data','pwm-export-chart'].forEach(id=>$(id).disabled=!enabled||!available);
    if(!available)$('pwm-export-status').textContent='文件导出请使用本地独立页面。';
  }
  function download(name,content,type) {
    const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    $('pwm-export-status').textContent=`已导出 ${name}`;root.querySelector('.export-menu').open=false;
  }
  function installExports() {
    $('pwm-save').addEventListener('click',()=>{
      if(valid)download('pwm-analysis-config.json',JSON.stringify(configuration(),null,2),'application/json');
    });
    $('pwm-load').addEventListener('click',()=>$('pwm-config-file').click());
    $('pwm-config-file').addEventListener('change',async event=>{
      const file=event.target.files[0];if(!file)return;
      try {
        if(file.size>16384)throw new Error('配置文件不能超过 16 KB。');
        const config=JSON.parse(await file.text());
        if(!['1.2.0','2.0.0','2.1.0'].includes(config.version) || !config.parameters || typeof config.parameters!=='object')throw new Error('请选择 v1.2.0、v2.0.0 或 v2.1.0 配置文件。');
        for(const key of Object.keys(fields))if(!Number.isFinite(config.parameters[key]))throw new Error(`配置缺少有效的 ${key} 参数。`);
        if(!['svpwm','sine','fixed'].includes(config.signalType)||!['cycle','fundamental'].includes(config.target)||
          !['center','edge'].includes(config.alignment)||!['points','rate'].includes(config.holdMode)||
          !['mean','trapezoid'].includes(config.integrationMethod)||!['span','amplitude','relative'].includes(config.errorBasis)||
          !Number.isFinite(config.samplePhase)||config.samplePhase<0||config.samplePhase>=1)
          throw new Error('配置文件包含无效的选项或时钟偏移。');
        pause();clearTimeout(timer);restore({modelContent:config});syncLayout();
        if(rebuild()){remember();$('pwm-export-status').textContent='配置已导入。';}
      }catch(exception){$('pwm-export-status').textContent=`导入失败：${exception.message}`;}
      event.target.value='';
    });
    $('pwm-export-data').addEventListener('click',()=>{
      if(!valid)return;
      const range=adc.sampleRange(0,model.duration);
      if(range.count+adc.cycles.length>250000){
        $('pwm-export-status').textContent='CSV 超过 250000 条记录，请缩短观察时间或降低采样率后导出；当前数据未被截断。';
        return;
      }
      const rows=['# Configuration: '+JSON.stringify(configuration()),'# Analysis: '+JSON.stringify(analysis),
        '# Error reference: '+$('pwm-basis').value,'record,time_s,index,raw_or_true_mean_V,RC_V,ADC_V,compensated_V,true_Vs,RC_Vs,ADC_Vs,compensated_Vs,error_percent'];
      for(const cycle of adc.cycles)rows.push(['cycle',cycle.x,cycle.index,cycle.truth,cycle.analog,cycle.adc,cycle.corrected,
        cycle.truthVs,cycle.analogVs,cycle.adcVs,cycle.correctedVs,window.PwmRcAdcV20.error(cycle,'adc',$('pwm-basis').value)].map(v=>Number.isFinite(v)||typeof v==='string'?v:'').join(','));
      for(let i=range.first;i<range.end;i++){const t=adc.time(i);rows.push(['sample',t,i,model.raw(t),model.filtered(t),adc.values[i],'','','','','',''].join(','));}
      download('pwm-analysis-data.csv','\ufeff'+rows.join('\n'),'text/csv;charset=utf-8');
    });
    $('pwm-export-chart').addEventListener('click',()=>{
      if(!valid)return;
      // Freeze computed theme styles so the SVG remains legible outside the host.
      const clone=plots.overview.node().cloneNode(true),original=plots.overview.node();
      const originals=[original,...original.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
      copies.forEach((element,i)=>{const style=getComputedStyle(originals[i]);
        for(const property of ['fill','stroke','stroke-width','font-family','font-size','font-weight','opacity'])element.style.setProperty(property,style.getPropertyValue(property));});
      copies.forEach((element,i)=>{
        for(const property of ['fill','stroke'])if(element.hasAttribute(property))
          element.setAttribute(property,getComputedStyle(originals[i]).getPropertyValue(property));
      });
      clone.querySelectorAll('[data-chart-hit]').forEach(e=>e.remove());
      clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
      const metadata=document.createElementNS('http://www.w3.org/2000/svg','metadata');
      metadata.textContent=JSON.stringify({configuration:configuration(),analysis});clone.prepend(metadata);
      const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');
      bg.setAttribute('width','100%');bg.setAttribute('height','100%');
      const colorProbe=document.createElement('span');colorProbe.style.color='var(--background)';colorProbe.hidden=true;root.append(colorProbe);
      bg.setAttribute('fill',getComputedStyle(colorProbe).color);colorProbe.remove();clone.insertBefore(bg,clone.children[1]);
      download('pwm-analysis-chart.svg',new XMLSerializer().serializeToString(clone),'image/svg+xml');
    });
  }

  function remember() {
    window.PwmLabStorage.set({
      modelContent: { rcCutoffHz: model.fc, fundamentalHz: model.fe, carrierHz: model.fs,
        adcRate: adc.fa, pointsPerCarrier: adc.fa / model.fs, holdMode: $('pwm-hold').value,
        samplePhase: adc.phase, integrationMethod: adc.method, errorBasis: $('pwm-basis').value,
        boundaryCompensation: visibility.comp, signalType:model.type,
        target:$('pwm-target').value, parameters:configuration().parameters,
        alignment:model.alignment,startup:model.startup,hardwareEnabled:$('pwm-hardware').checked,
        modulation:model.modulation, targetPeakV:model.amplitude,levelSpanV:model.span },
      privateContent: { cursor, visibility: { ...visibility } }
    });

  }
  function restore(saved) {
    const p = saved?.modelContent;
    if (p) {
      if (p.parameters) for(const [key,input] of Object.entries(fields))
        if(Number.isFinite(p.parameters[key])) input.value=p.parameters[key];
      if(['svpwm','sine','fixed'].includes(p.signalType))$('pwm-type').value=p.signalType;
      if(['cycle','fundamental'].includes(p.target))$('pwm-target').value=p.target;
      if(['center','edge'].includes(p.alignment))$('pwm-alignment').value=p.alignment;
      if(typeof p.startup==='boolean')$('pwm-startup').value=p.startup?'startup':'steady';
      if(typeof p.hardwareEnabled==='boolean')$('pwm-hardware').checked=p.hardwareEnabled;
      if(typeof p.boundaryCompensation==='boolean')visibility.comp=p.boundaryCompensation;
      if (Number.isFinite(p.rcCutoffHz)) fields.fc.value = p.rcCutoffHz;
      // Keep the sine frequency independent from a fixed-PWM observation window.
      if (!p.parameters && Number.isFinite(p.fundamentalHz)) fields.fe.value = p.fundamentalHz;
      if (Number.isFinite(p.carrierHz)) fields.fs.value = p.carrierHz;
      if (Number.isFinite(p.adcRate)) fields.fa.value = p.adcRate;
      if (Number.isFinite(p.pointsPerCarrier)) fields.n.value = p.pointsPerCarrier;
      if (['points','rate'].includes(p.holdMode)) $('pwm-hold').value = p.holdMode;
      if (Number.isFinite(p.samplePhase)) $('pwm-sample-phase').value = p.samplePhase * 100;
      if (['mean','trapezoid'].includes(p.integrationMethod)) $('pwm-method').value = p.integrationMethod;
      if (['span','amplitude','relative'].includes(p.errorBasis)) $('pwm-basis').value = p.errorBasis;
    }
    cursor = Math.max(0, Math.min(1, Number(saved?.privateContent?.cursor) || 0));
    const v = saved?.privateContent?.visibility;
    if (v) for (const key of Object.keys(visibility)) if (typeof v[key] === 'boolean') visibility[key] = v[key];
    root.querySelectorAll('[data-series]').forEach(button =>
      button.setAttribute('aria-pressed', String(visibility[button.dataset.series])));
  }

  function chart(svg, a, b, height, kind, yDomain = domain) {
    const width = Math.max(200, svg.node().getBoundingClientRect().width);
    const left = 64, right = width - 16, top = 12, bottom = height - 45;
    const inset = 4;
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);
    svg.selectAll('*').remove();
    const x = d3.scaleLinear().domain([a, b]).range([left + inset, right - inset]);
    const y = d3.scaleLinear().domain(yDomain).range([bottom - inset, top + inset]);
    const useUs = b - a < 0.002;
    const multiplier = useUs ? 1e6 : 1e3;
    svg.append('rect').attr('data-chart-frame', '').attr('x', left).attr('y', top)
      .attr('width', right - left).attr('height', bottom - top)
      .attr('fill', 'none').attr('stroke', 'var(--border)').attr('stroke-width', 1);
    svg.append('g').attr('transform', `translate(0,${bottom})`)
      .call(d3.axisBottom(x).ticks(width < 480 ? 3 : 6).tickFormat(v => d3.format('.4~g')(v * multiplier)));
    svg.append('g').attr('transform', `translate(${left},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('.3~g')));
    const grid = svg.append('g');
    y.ticks(4).forEach(value => grid.append('line')
      .attr('x1', left).attr('x2', right).attr('y1', y(value)).attr('y2', y(value))
      .attr('stroke', 'var(--border)').attr('stroke-width', 1).attr('opacity', 0.45));
    svg.append('text').attr('class', 'axis-title').attr('data-axis', 'x')
      .attr('x', (left + right) / 2).attr('y', height - 7).attr('text-anchor', 'middle')
      .text(`时间（${useUs ? 'μs' : 'ms'}）`);
    svg.append('text').attr('class', 'axis-title').attr('data-axis', 'y')
      .attr('transform', `translate(15,${(top + bottom) / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle').text(kind === 'error' ? '误差（%）' : '信号电压（V）');
    const marks = svg.append('g');
    return { svg, width, height, x, y, marks, left, right, top, bottom, a, b, kind };
  }
  function line(c, values, key, extra = {}) {
    if (!visibility[key]) return;
    const generator = d3.line().defined(p => Number.isFinite(p.y)).x(p => c.x(p.x)).y(p => c.y(p.y));
    if (extra.steps) generator.curve(d3.curveStepAfter);
    c.marks.append('path').datum(values).attr('data-waveform', key)
      .attr('d', generator).attr('fill', 'none').attr('stroke', colors[key])
      .attr('stroke-width', 1.5).attr('stroke-dasharray', extra.dash || null);
  }
  function theoretical(c, filtered = false) {
    const values = d3.range(401).map(k => {
      const x = c.a + (c.b - c.a) * k / 400;
      return { x, y: filtered ? model.filteredReference(x) : model.reference(x) };
    });
    line(c, values, filtered ? 'rc' : 'ref', { dash: filtered ? '5 3' : '7 4' });
  }

  function installHover(c) {
    const hover = c.svg.append('g').attr('pointer-events', 'none').style('display', 'none');
    hover.append('line').attr('data-chart-hover-guide', '')
      .attr('y1', c.top).attr('y2', c.bottom).attr('stroke', 'var(--foreground)').attr('opacity', 0.5);
    const overlay = c.svg.append('rect').attr('data-chart-hit', '')
      .attr('data-chart-hover-overlay', 'cross-series')
      .attr('x', c.left).attr('y', c.top).attr('width', c.right - c.left).attr('height', c.bottom - c.top)
      .attr('fill', 'transparent');
    function show(event) {
      const [px] = d3.pointer(event, c.svg.node());
      const x = Math.max(c.a, Math.min(c.b, c.x.invert(px)));
      const samples = [];
      if (c.kind === 'error') {
        for (const series of c.errorSeries) {
          if (!visibility[series.key]) continue;
          const upper = d3.bisector(p => p.x).left(series.values, x);
          const left = series.values[Math.max(0, upper - 1)];
          const right = series.values[Math.min(series.values.length - 1, upper)];
          const fraction = right.x === left.x ? 0 : Math.max(0, Math.min(1, (x - left.x) / (right.x - left.x)));
          const value = left.y + fraction * (right.y - left.y);
          if (Number.isFinite(value)) samples.push({ key: series.key, name: series.name, value });
        }
      } else {
        if (visibility.raw && c.kind !== 'after') samples.push({ key: 'raw', name: '滤波前', value: model.raw(x) });
        if (visibility.rc && c.kind !== 'before') samples.push({ key: 'rc', name: '滤波后', value: model.filtered(x) });
        if (visibility.ref) samples.push({ key: 'ref', name: '目标基波', value: model.reference(x) });
        if (visibility.adc && c.kind === 'after') samples.push({ key: 'adc', name: 'ADC 插值', value: adc.interpolated(x) });
      }
      hover.style('display', null);
      hover.select('line').attr('x1', c.x(x)).attr('x2', c.x(x));
      hover.selectAll('circle').data(samples, p => p.key).join('circle')
        .attr('data-chart-hover-marker', '').attr('cx', c.x(x)).attr('cy', p => c.y(p.value))
        .attr('r', 3).attr('fill', p => colors[p.key]);
      tooltip.replaceChildren();
      const title = document.createElement('div');
      title.textContent = `t = ${(x * 1e3).toFixed(6)} ms`;
      tooltip.append(title);
      samples.forEach(sample => {
        const row = document.createElement('div');
        row.textContent = `${sample.name}  ${sample.value.toFixed(4)} ${c.kind === 'error' ? '%' : 'V'}`;
        tooltip.append(row);
      });
      tooltip.style.display = 'block';
      const bounds = root.getBoundingClientRect();
      const desired = event.clientX - bounds.left + 12;
      tooltip.style.left = Math.max(0, Math.min(desired, bounds.width - tooltip.offsetWidth)).toFixed(1) + 'px';
      tooltip.style.top = Math.max(0, event.clientY - bounds.top - tooltip.offsetHeight - 10).toFixed(1) + 'px';
    }
    overlay.on('pointermove', show).on('pointerleave', () => {
      hover.style('display', 'none'); tooltip.style.display = 'none';
    }).on('click', event => {
      show(event);
      if (c.kind === 'overview') {
        const [px] = d3.pointer(event, c.svg.node());
        seek(Math.max(0, Math.min(1, c.x.invert(px) / model.duration)));
        remember();
      }
    });
  }

  function measureLabels(c) {
    // Optional x tick labels are dropped if neighboring bounds collide.
    const ticks = [...c.svg.node().querySelectorAll('g .tick text')]
      .filter(n => n.parentElement.parentElement.getAttribute('transform') === `translate(0,${c.bottom})`);
    let last = -Infinity;
    ticks.forEach(node => {
      const box = node.getBoundingClientRect();
      if (box.left < last + 4) node.style.display = 'none';
      else last = box.right;
    });
  }

  function drawOverview() {
    overviewChart = chart(plots.overview, 0, model.duration, 235, 'overview');
    const c = overviewChart;
    const env = model.envelope(0, model.duration, Math.round(c.right - c.left));
    const area = (min, max) => d3.area().x(p => c.x(p.x)).y0(p => c.y(p[min])).y1(p => c.y(p[max]));
    if (visibility.raw) c.marks.append('path').datum(env).attr('data-waveform', 'raw')
      .attr('d', area('rmin', 'rmax')).attr('fill', colors.raw).attr('opacity', 0.16);
    if (visibility.rc) c.marks.append('path').datum(env).attr('data-waveform', 'rc')
      .attr('d', area('fmin', 'fmax')).attr('fill', colors.rc).attr('opacity', 0.30);
    theoretical(c); theoretical(c, true);
    if(visibility.adc && analysis.adc.valid && model.type!=='fixed') {
      line(c,d3.range(401).map(k=>{const x=k*model.duration/400;return {x,y:analysis.adc.dc+
        analysis.adc.amplitude*Math.sin(2*Math.PI*model.fe*x+analysis.adc.phase)};}),'adc',{dash:'3 3'});
    }
    c.marks.append('rect').attr('id', 'pwm-observed-window').attr('y', c.top).attr('height', c.bottom - c.top)
      .attr('fill', 'var(--foreground)').attr('opacity', 0.07);
    c.marks.append('line').attr('id', 'pwm-cursor').attr('y1', c.top).attr('y2', c.bottom)
      .attr('stroke', 'var(--foreground)').attr('stroke-width', 1);
    installHover(c); measureLabels(c);
  }

  function drawCycle() {
    const index = Math.max(0, Math.min(adc.cycles.length - 1, Math.floor(cursor * model.duration / model.period)));
    const cycle = adc.cycles[index];
    $('pwm-cycle-title').textContent = `第 ${index + 1} 个载波周期 · 实际 ${cycle.count} 个采样点`;
    const rows = [
      { label:'原始 PWM', volts:cycle.truth, vs:cycle.truthVs, error:0 },
      { label:'RC 连续积分', volts:cycle.analog, vs:cycle.analogVs, error:window.PwmRcAdcV20.error(cycle,'analog',$('pwm-basis').value) },
      { label:'ADC 积分', volts:cycle.adc, vs:cycle.adcVs, error:window.PwmRcAdcV20.error(cycle,'adc',$('pwm-basis').value) }
    ];
    if (visibility.comp) rows.push({ label:'ADC＋边界补偿', volts:cycle.corrected, vs:cycle.correctedVs,
      error:window.PwmRcAdcV20.error(cycle,'comp',$('pwm-basis').value) });
    const body = $('pwm-cycle-table');
    body.replaceChildren();
    $('pwm-absolute-error').textContent=`ADC 均值绝对偏差 ${format(cycle.adc-cycle.truth)} V`+
      (visibility.comp ? ` · 补偿后 ${format(cycle.corrected-cycle.truth)} V` : '');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      for (const value of [row.label, row.volts, row.vs * 1e6, row.error]) {
        const cell = document.createElement('td');
        if (typeof value === 'string') cell.textContent=value;
        else {
          cell.className='numeric';
          let text=Number.isFinite(value) ? d3.format('.6~g')(value) : '—';
          if (text.length>8) text=value.toExponential(2);
          cell.textContent=text;
        }
        tr.append(cell);
      }
      body.append(tr);
    });
  }
  function compactErrors(values, budget) {
    if (values.length <= budget) return values;
    const block = Math.ceil(values.length / (budget / 3));
    const compact = [];
    for (let i = 0; i < values.length; i += block) {
      const chunk = values.slice(i, i + block);
      const valid = chunk.filter(p => Number.isFinite(p.y));
      if (!valid.length) { compact.push(chunk[0]); continue; }
      const low = valid.reduce((a,b) => a.y < b.y ? a : b);
      const high = valid.reduce((a,b) => a.y > b.y ? a : b);
      const missing = chunk.find(p => !Number.isFinite(p.y));
      const chosen = missing ? [low,high,missing] : [low,high];
      chosen.sort((a,b) => a.x - b.x);
      compact.push(...chosen);
    }
    return compact;
  }
  function drawErrors() {
    const basis = $('pwm-basis').value;
    const series = [
      { key:'analog', name:'RC 连续积分', dash:'2 3' },
      { key:'adc', name:'ADC 积分' },
      { key:'comp', name:'ADC＋边界补偿', dash:'7 3' }
    ].map(s => ({ ...s, values:adc.cycles.map(c => ({ x:c.x, y:window.PwmRcAdcV20.error(c,s.key,basis) })) }));
    const visibleSeries = series.filter(s => visibility[s.key]);
    const extent = d3.extent([0,...visibleSeries.flatMap(s => s.values.filter(p => Number.isFinite(p.y)).map(p => p.y))]);
    const padding = Math.max(0.0001, (extent[1] - extent[0]) * 0.08);
    errorChart = chart(plots.error, 0, model.duration, 180, 'error', [extent[0] - padding, extent[1] + padding]);
    errorChart.errorSeries = series;
    visibleSeries.forEach(s => line(errorChart,compactErrors(s.values,Math.round(errorChart.width * 3)),s.key,{dash:s.dash}));
    errorChart.marks.append('line').attr('id','pwm-error-cursor')
      .attr('x1',errorChart.x(cursor*model.duration)).attr('x2',errorChart.x(cursor*model.duration))
      .attr('y1',errorChart.top).attr('y2',errorChart.bottom).attr('stroke','var(--foreground)').attr('opacity',0.5);
    installHover(errorChart); measureLabels(errorChart);
    const ratio = adc.fa / model.fs;
    $('pwm-adc-detail').textContent = `平均 ${ratio.toFixed(4)} 点/载波，实际 ${adc.minCount}–${adc.maxCount} 点。${basis === 'relative' ? `|真实均值| < ${format(model.span*1e-4)} V 时不显示相对误差。` : basis === 'amplitude' ? `参考为目标基波峰值 ${format(model.amplitude)} V。` : `参考为信号电平跨度 ${format(model.span)} V。`}${adc.method === 'mean' && adc.minCount === 0 ? '无采样点的周期，均值积分不可计算。' : ''}`;
  }
  function drawLocal() {
    tooltip.style.display = 'none';
    const span = Math.min(5 * model.period, model.duration);
    const center = cursor * model.duration;
    const a = Math.max(0, Math.min(model.duration - span, center - span / 2));
    const b = a + span;
    const data = model.local(a, b);
    const before = chart(plots.before, a, b, 200, 'before');
    const after = chart(plots.after, a, b, 200, 'after');
    line(before, data.steps, 'raw', { steps: true }); theoretical(before);
    line(after, data.curve, 'rc'); theoretical(after);
    const sampled = adc.points(a,b);
    if(visibility.adc) {
      const points=[{x:a,y:adc.interpolated(a)},...sampled.points,{x:b,y:adc.interpolated(b)}];
      // Use the actual interpolation breakpoints, even when displayed marks are decimated.
      if(sampled.stride===1)line(after,points,'adc');
    }
    if (visibility.adc) after.marks.selectAll('circle').data(sampled.points).join('circle')
      .attr('data-adc-sample','').attr('cx',p=>after.x(p.x)).attr('cy',p=>after.y(p.y))
      .attr('r',2.3).attr('fill',colors.adc);
    localCharts = [before, after];
    localCharts.forEach(c => { installHover(c); measureLabels(c); });
    const c = overviewChart;
    c.marks.select('#pwm-observed-window').attr('x', c.x(a)).attr('width', c.x(b) - c.x(a));
    c.marks.select('#pwm-cursor').attr('x1', c.x(center)).attr('x2', c.x(center));
    $('pwm-time').value = Math.round(cursor * 1000);
    $('pwm-time-label').textContent = `${(center * 1e3).toFixed(3)} ms`;
    $('pwm-detail').textContent = `${model.type==='fixed'?'观察窗口':'每基波周期'} ${(model.fs / model.fe).toFixed(2)} 个载波 · RC τ ${(model.tau * 1e6).toFixed(2)} μs${sampled.stride > 1 ? ` · 采样标记每 ${sampled.stride} 点显示 1 点，积分使用全部采样` : ''}`;
    if (errorChart) errorChart.marks.select('#pwm-error-cursor')
      .attr('x1',errorChart.x(center)).attr('x2',errorChart.x(center));
    drawCycle();root.dispatchEvent(new CustomEvent('pwm:updated'));
  }
  function seek(value) { cursor = value; drawLocal(); }
  function drawAll() { if (model && adc) {
    syncLayout();drawOverview();
    if($('pwm-target').value==='cycle')drawErrors();else errorChart=null;
    drawLocal();drawAnalysis();
  } }
  function pause() { playing = false; $('pwm-play').textContent = cursor >= 1 ? '重播' : '播放'; }

  function rebuild() {
    pause();
    try {
      const p = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value === '' ? NaN : Number(input.value)]));
      const hold = $('pwm-hold').value;
      if (hold === 'points') {
        if (!Number.isInteger(p.n) || p.n < 1 || p.n > 2000) throw new Error('固定每周期点数时，N 须为 1–2000 的整数。');
        p.fa = p.fs * p.n;
        fields.fa.value = Number.isFinite(p.fa) ? p.fa : '';
      } else {
        const ratio=p.fa/p.fs;
        fields.n.value = Number.isFinite(ratio) ? Number(ratio.toPrecision(10)) : '';
      }
      $('pwm-n-title').textContent = hold === 'points' ? '每周期点数 N（整数）' : '每周期平均点数 N';
      fields.n.min = hold === 'points' ? '1' : '0.001';
      const type=$('pwm-type').value;
      if(type==='fixed') {
        if(!Number.isInteger(p.window)||p.window<3||p.window>2000)throw new Error('观察窗口须为 3–2000 个完整载波周期。');
        p.fe=p.fs/p.window;
      }
      const phase = Number($('pwm-sample-phase').value) / 100;
      window.PwmRcAdcV20.validate(p.fa,phase);
      const nextModel = window.PwmRcMathV20.build({ fc:p.fc, fe:p.fe, fs:p.fs, roll:1/p.fa,
        type,scale:p.scale,modulation:p.modulation,high:p.high,low:p.low,duty:p.duty,depth:p.depth,
        alignment:$('pwm-alignment').value,startup:$('pwm-startup').value==='startup',initialValue:p.initial });
      const nextAdc = window.PwmRcAdcV20.build(nextModel,{fa:p.fa,phase,method:$('pwm-method').value,
        hardware:$('pwm-hardware').checked ? {bits:p.bits,min:p.min,max:p.max,gain:p.gain,offset:p.offset,noise:p.noise} : null});
      model = nextModel; adc = nextAdc;
      analysis=window.PwmRcAnalysisV20.evaluate(model,adc);valid=true;setExports(true);
      fields.fe.removeAttribute('aria-invalid');
      for(const field of Object.values(fields))field.removeAttribute('aria-invalid');
      $('pwm-signal-summary').textContent=`目标基波峰值 ${format(model.amplitude)} V · 直流 ${format(model.dc)} V · 电平跨度 ${format(model.span)} V`;
      $('pwm-overview-title').textContent=`${type==='fixed'?'观察窗口':'一个基波周期'} · 阴影为实际范围，RC 虚线为理论响应`;
      const warnings=[];
      if(model.startup)warnings.push('包含初始瞬态；基波分析是当前窗口的投影，不代表稳态响应。');
      if(adc.fa<=2*model.fe && type!=='fixed')warnings.push('ADC 采样率不足，基波幅相不予估计。');
      if(adc.clipped)warnings.push(`ADC 超量程限幅 ${adc.clipped} 点（含边界样本）。`);
      if(adc.minCount===0)warnings.push('部分载波周期内没有采样点。');
      if(model.startup && adc.phase>0)warnings.push('首个周期边界插值跨越启动时刻，可能产生额外误差。');
      $('pwm-warning').hidden=!warnings.length;$('pwm-warning').textContent=warnings.join(' ');
      $('pwm-sample-phase-label').textContent = `${(phase*100).toFixed(1)}% · ${(phase/p.fa*1e6).toFixed(3)} μs`;
      if ($('pwm-hardware').checked) {
        const range=p.max-p.min, lsb=range/(2**p.bits-1), rcRange=d3.extent(model.ys);
        const measuredMin=rcRange[0]*p.gain+p.offset, measuredMax=rcRange[1]*p.gain+p.offset;
        const margin=Math.min(measuredMin-p.min,p.max-measuredMax)-3*p.noise;
        $('pwm-adc-span').textContent=`${format(range)} V`;
        $('pwm-adc-lsb').textContent=`${format(lsb)} V`;
        $('pwm-adc-signal-range').textContent=`${format(rcRange[0])} ～ ${format(rcRange[1])} V`;
        const health=$('pwm-adc-health'),status=$('pwm-adc-range-status');
        health.classList.toggle('is-warning',adc.clipped>0||margin<0);
        status.textContent=adc.clipped>0
          ? `已发生限幅：${adc.clipped} 个采样点（含边界样本）。请扩大等效量程或检查增益与零偏。`
          : margin<0
            ? '当前样本未限幅，但量程不足以容纳 3σ 噪声裕量。'
            : `量程检查通过；扣除 3σ 噪声后最小裕量 ${format(margin)} V。`;
      }
      error.hidden = true;
      $('pwm-play').disabled = false; $('pwm-time').disabled = false;
      const observations = [...d3.extent(model.us),...d3.extent(adc.values),...d3.extent(model.ys), ...d3.extent(d3.range(401).map(k => model.reference(k / 400 * model.duration)))];
      const extent = d3.extent(observations);
      const padding = Math.max(model.span*0.01, (extent[1] - extent[0]) * 0.08);
      domain = [extent[0] - padding, extent[1] + padding];
      $('pwm-gain').textContent = `${(100 * model.gain).toFixed(5)}%`;
      $('pwm-phase').textContent = `${(model.phase * 180 / Math.PI).toFixed(3)}°`;
      $('pwm-carrier').textContent = `${(100 / Math.sqrt(1 + (model.fs / model.fc) ** 2)).toFixed(2)}%`;
      drawAll();
      return true;
    } catch (exception) {
      valid=false;setExports(false);
      for(const field of Object.values(fields))if(!field.checkValidity() || field.value==='')field.setAttribute('aria-invalid','true');
      error.hidden = false;
      error.textContent = exception.message + (model ? ` 当前图示保留上次有效参数，ADC 为 ${adc.fa} S/s。` : '');
      $('pwm-play').disabled = true; $('pwm-time').disabled = true;
      root.dispatchEvent(new CustomEvent('pwm:updated'));
      return false;
    }
  }

  Object.entries(fields).forEach(([key,input]) => input.addEventListener('input', () => {
    if (key === 'fa') $('pwm-hold').value = 'rate';
    if (key === 'n') $('pwm-hold').value = 'points';
    pause(); valid=false;setExports(false);clearTimeout(timer);
    error.hidden=false;error.textContent='参数已修改，正在更新结果…';
    root.dispatchEvent(new CustomEvent('pwm:updated'));
    timer = setTimeout(() => { if (rebuild()) remember(); }, 200);
  }));
  $('pwm-hold').addEventListener('change',()=>{
    if ($('pwm-hold').value === 'points') fields.n.value = Math.max(1,Math.min(2000,Math.round(Number(fields.n.value)||1)));
    clearTimeout(timer); if (rebuild()) remember();
  });
  $('pwm-sample-phase').addEventListener('input',()=>{
    pause(); clearTimeout(timer); timer=setTimeout(()=>{if(rebuild())remember();},80);
  });
  $('pwm-method').addEventListener('change',()=>{clearTimeout(timer);if(rebuild())remember();});
  $('pwm-basis').addEventListener('change',()=>{drawErrors();drawCycle();if(valid)remember();});
  $('pwm-time').addEventListener('input', event => { pause(); seek(Number(event.target.value) / 1000); });
  $('pwm-time').addEventListener('change', remember);
  $('pwm-play').addEventListener('click', () => {
    if (playing) { pause(); remember(); return; }
    if (cursor >= 1) cursor = 0;
    playing = true; previousFrame = performance.now(); previousDraw = 0;
    $('pwm-play').textContent = '暂停';
  });
  root.querySelectorAll('[data-series]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.series;
    visibility[key] = !visibility[key];
    root.querySelectorAll(`[data-series="${key}"]`).forEach(peer=>peer.setAttribute('aria-pressed',String(visibility[key])));
    drawAll(); remember();
  }));
  ['pwm-type','pwm-alignment','pwm-startup','pwm-hardware'].forEach(id=>$(id).addEventListener('change',()=>{
    syncLayout();clearTimeout(timer);if(rebuild())remember();
  }));
  $('pwm-target').addEventListener('change',()=>{syncLayout();drawAll();if(valid)remember();});
  installExports();
  new ResizeObserver(drawAll).observe(root);
  restore(window.PwmLabStorage.get());
  syncLayout();
  if (!rebuild()) {
    Object.assign(fields.fc, { value: 10000 }); Object.assign(fields.fe, { value: 50 }); Object.assign(fields.fs, { value: 20000 });
    fields.fa.value=200000;fields.n.value=10;$('pwm-hold').value='points';$('pwm-sample-phase').value=0;
    fields.scale.value=100;fields.modulation.value=0.8;fields.high.value=100;fields.low.value=0;
    fields.duty.value=0.5;fields.depth.value=0.4;fields.window.value=20;fields.initial.value=0;
    $('pwm-type').value='svpwm';$('pwm-hardware').checked=false;$('pwm-startup').value='steady';
    syncLayout();rebuild();
  }
  function animate(now) {
    if (!root.isConnected) return;
    if (playing) {
      // Playback traverses one fundamental cycle in 12 seconds, then stops.
      // Explicit play is allowed under reduced motion; only the redraw rate changes.
      const dt = document.hidden ? 0 : Math.min(200, now - previousFrame);
      cursor = Math.min(1, cursor + dt / 12000);
      if (now - previousDraw >= (reducedMotion ? 150 : 75) || cursor >= 1) {
        drawLocal(); previousDraw = now;
      }
      if (cursor >= 1) { pause(); remember(); }
    }
    previousFrame = now;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  // Small read-only inspection API for browser validation of the actual model.
  window.PwmRcDemoV20 = { getState: () => ({ fc: model.fc, fe: model.fe, fs: model.fs, cursor, playing,
    gain: model.gain, phase: model.phase, segmentCount: model.us.length, fa:adc.fa,
    pointsPerCarrier:adc.fa/model.fs, minCount:adc.minCount,maxCount:adc.maxCount,
    holdMode:$('pwm-hold').value,samplePhase:adc.phase,method:adc.method,compensation:visibility.comp,type:model.type,amplitude:model.amplitude,span:model.span,
    alignment:model.alignment,startup:model.startup,valid,target:$('pwm-target').value,clipped:adc.clipped }),
    model: () => model, adc:()=>adc,analysis:()=>analysis,configuration };
})();

