/* End-to-end acceptance of the standalone product, with no Codex host or iframe. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/');await page.locator('#metric-one').filter({hasText:'V'}).waitFor();
  const state=()=>page.evaluate(()=>window.PwmRcDemoV20.getState()),wait=()=>page.waitForTimeout(400);
  assert.equal((await state()).amplitude,40);assert.equal((await state()).fa,200000);
  assert.equal(await page.locator('#pwm-save').isDisabled(),false);
  assert.ok((await page.locator('#level-high').innerText()).includes('66.6667'));
  assert.ok((await page.locator('#basis-explanation').innerText()).includes('133.333'));
  assert.equal(await page.locator('.error-chart-header [data-series]').count(),3);
  assert.equal(await page.locator('#pwm-integral-error [data-waveform="analog"]').count(),1);
  assert.equal(await page.locator('#pwm-integral-error [data-waveform="adc"]').count(),1);
  assert.equal(await page.locator('#pwm-integral-error [data-waveform="comp"]').count(),0);
  await page.locator('.error-chart-header [data-series="adc"]').click();
  assert.equal(await page.locator('#pwm-integral-error [data-waveform="adc"]').count(),0);
  assert.equal(await page.locator('.legend [data-series="adc"][aria-pressed="false"]').count(),2);
  await page.locator('.error-chart-header [data-series="adc"]').click();
  await page.locator('#pwm-adc-guide-open').click();assert.equal(await page.locator('#pwm-adc-guide').isVisible(),true);
  assert.ok((await page.locator('#pwm-adc-guide').innerText()).includes('RC 边界补偿原理'));
  assert.ok((await page.locator('#pwm-adc-guide').innerText()).includes('∫u dt'));
  await page.locator('#pwm-adc-guide-done').click();assert.equal(await page.locator('#pwm-adc-guide').isVisible(),false);
  await page.screenshot({path:path.join(__dirname,'artifacts/desktop.png'),fullPage:true});
  await page.locator('#pwm-scale').fill('250');await wait();assert.equal((await state()).amplitude,100);
  await page.locator('[data-target="fundamental"]').click();assert.equal((await state()).target,'fundamental');
  assert.equal(await page.locator('#pwm-fundamental-panel').isVisible(),true);
  await page.locator('#theme-toggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  const darkSurfaces=await page.evaluate(()=>['.app-header','.wave-panel','.analysis-panel'].map(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor));
  assert.equal(new Set(darkSurfaces).size,1,'Theme surfaces must change together without low-contrast transition frames.');
  await page.screenshot({path:path.join(__dirname,'artifacts/dark.png'),fullPage:true});
  await page.locator('#theme-toggle').click();
  await page.locator('#pwm-type').selectOption('sine');await wait();await page.locator('#pwm-high').fill('5');await wait();
  assert.equal((await state()).amplitude,2);assert.equal(await page.locator('#pwm-scale').isVisible(),false);
  await page.locator('#pwm-type').selectOption('fixed');await wait();await page.locator('#pwm-duty').fill('0.05');await wait();
  assert.equal((await state()).target,'cycle');assert.equal(await page.locator('[data-target="fundamental"]').isDisabled(),true);
  assert.ok(Math.abs(await page.evaluate(()=>window.PwmRcDemoV20.adc().cycles[0].truth)-.25)<1e-9);
  await page.locator('#pwm-n').fill('20');await wait();assert.equal((await state()).fa,400000);
  await page.locator('#pwm-fs').fill('40000');await wait();assert.equal((await state()).fa,800000);
  await page.locator('#pwm-fa').fill('230000');await wait();assert.equal((await state()).minCount,5);assert.equal((await state()).maxCount,6);
  await page.locator('#pwm-fs').fill('20000');await wait();assert.equal((await state()).pointsPerCarrier,11.5);
  await page.locator('#pwm-sample-phase').fill('31.7');await wait();await page.locator('#pwm-method').selectOption('trapezoid');await wait();
  await page.locator('[data-series="comp"]').click();assert.equal((await state()).compensation,true);
  await page.locator('#pwm-basis').selectOption('relative');assert.ok((await page.locator('#basis-explanation').innerText()).includes('接近零'));
  await page.locator('#pwm-advanced summary').click();await page.locator('#pwm-hardware').check();await wait();
  assert.ok((await page.locator('#pwm-adc-lsb').innerText()).includes('V'));
  assert.ok((await page.locator('#pwm-adc-range-status').innerText()).includes('量程检查通过'));
  await page.locator('#pwm-adc-max').fill('0.3');await wait();assert.ok((await state()).clipped>0);
  assert.ok((await page.locator('#pwm-adc-range-status').innerText()).includes('已发生限幅'));
  const saved=page.waitForEvent('download');await page.locator('#pwm-save').click();
  const config=await saved,configPath=path.join(__dirname,'artifacts/config.json');await config.saveAs(configPath);
  assert.equal(JSON.parse(fs.readFileSync(configPath,'utf8')).version,'2.1.0');
  await page.locator('#pwm-duty').fill('0.2');await wait();await page.locator('#pwm-config-file').setInputFiles(configPath);await wait();
  assert.equal(await page.locator('#pwm-duty').inputValue(),'0.05');
  await page.locator('.export-menu summary').click();const csvEvent=page.waitForEvent('download');await page.locator('#pwm-export-data').click();
  const csv=await csvEvent;await csv.saveAs(path.join(__dirname,'artifacts/data.csv'));
  await page.locator('.export-menu summary').click();const svgEvent=page.waitForEvent('download');await page.locator('#pwm-export-chart').click();
  const svg=await svgEvent;await svg.saveAs(path.join(__dirname,'artifacts/chart.svg'));
  await page.locator('#pwm-low').fill('6');await wait();assert.equal((await state()).valid,false);assert.equal(await page.locator('#pwm-save').isDisabled(),true);
  await page.locator('#pwm-low').fill('0');await wait();assert.equal((await state()).valid,true);
  await page.locator('#pwm-hardware').uncheck();await wait();await page.locator('#pwm-advanced summary').click();
  await page.locator('#pwm-type').selectOption('svpwm');await wait();assert.equal((await state()).fe,50);
  await page.locator('#pwm-scale').fill('100');await wait();await page.locator('#pwm-n').fill('10');await wait();
  await page.locator('#pwm-basis').selectOption('span');
  await page.reload();await page.locator('#metric-one').filter({hasText:'V'}).waitFor();assert.equal((await state()).fa,200000);
  const layouts=[];
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:1100});await page.waitForTimeout(180);
   for(const target of ['cycle','fundamental']){
    await page.locator(`[data-target="${target}"]`).click();await page.waitForTimeout(120);
    const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
     plots:[...document.querySelectorAll('.plot')].filter(e=>e.getBoundingClientRect().width).map(e=>({width:e.getBoundingClientRect().width,viewBox:e.viewBox.baseVal.width})),
     fields:[...document.querySelectorAll('input,select')].filter(e=>e.getBoundingClientRect().width).every(e=>e.getBoundingClientRect().right<=innerWidth+1)}));
    assert.ok(geometry.scrollWidth<=width+1,JSON.stringify({target,...geometry}));assert.equal(geometry.fields,true);
    geometry.plots.forEach(plot=>assert.ok(Math.abs(plot.width-plot.viewBox)<1,JSON.stringify(plot)));layouts.push({target,...geometry});
   }
  }
  await page.screenshot({path:path.join(__dirname,'artifacts/mobile.png'),fullPage:true});
  await page.locator('#parameters-toggle').click();assert.equal(await page.locator('.sidebar').isVisible(),true);
  await page.locator('#pwm-modulation').fill('0.6');await wait();assert.equal((await state()).amplitude,30);
  await page.locator('#parameters-toggle').click();assert.equal(await page.locator('.sidebar').isVisible(),false);
  await page.locator('#pwm-play').click();await page.waitForTimeout(400);assert.equal((await state()).playing,true);
  await page.locator('#pwm-play').click();await page.locator('#pwm-time').fill('250');assert.equal((await state()).cursor,.25);
  await page.locator('#pwm-after [data-chart-hit]').hover();assert.equal(await page.locator('#pwm-tooltip').isVisible(),true);
  // Enlarged type must not cause document overflow; tables have intentional local scrolling.
  await page.setViewportSize({width:1024,height:1100});await page.evaluate(()=>document.documentElement.style.fontSize='32px');await wait();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  const load=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts',name),'utf8'));
  const report={status:'passed',model:load('model-results.json'),adc:load('adc-results.json'),physics:load('product-results.json'),
   browser:{status:'passed',errors,layouts,checks:['3 waveforms','measurement mode','amplitude','signal level definitions',
    'N/rate linkage','phase/integration','three error legends/toggles','ADC guide','compensation/error reference','hardware range/LSB/clipping','config round trip',
    'CSV/SVG downloads','invalid input','device-local restore','theme toggle','mobile parameter panel','playback/hover','200% text']}};
  fs.writeFileSync(path.join(__dirname,'artifacts/results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'passed',layouts,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
