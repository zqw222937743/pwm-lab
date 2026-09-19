/* Validate optional tool actions using an instrumented registry, without claiming
   an actual WebMCP-capable browser runtime. Invalid actions must be atomic. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>{window.registeredTools={};Object.defineProperty(document,'modelContext',{value:{registerTool:tool=>{window.registeredTools[tool.name]=tool;}}});});
  await page.goto('http://127.0.0.1:8765/');await page.locator('#metric-one').filter({hasText:'V'}).waitFor();
  const registrations=await page.evaluate(()=>Object.values(window.registeredTools).map(t=>({name:t.name,annotations:t.annotations,schema:t.inputSchema})));
  assert.equal(registrations.length,2);assert.equal(registrations[0].annotations.readOnlyHint,true);
  const before=await page.evaluate(()=>window.registeredTools.read_pwm_analysis.execute({}));assert.equal(before.state.target,'cycle');
  const changed=await page.evaluate(()=>window.registeredTools.set_pwm_observation.execute({target:'fundamental',position:.25}));
  assert.equal(changed.state.target,'fundamental');assert.equal(changed.state.cursor,.25);
  assert.equal(await page.locator('#pwm-fundamental-panel').isVisible(),true);
  const invalid=await page.evaluate(()=>{try{window.registeredTools.set_pwm_observation.execute({target:'cycle',position:2});return false;}catch{return true;}});
  assert.equal(invalid,true);
  const after=await page.evaluate(()=>window.registeredTools.read_pwm_analysis.execute({}));assert.equal(after.state.target,'fundamental');assert.equal(after.state.cursor,.25);
  const report={status:'passed',environment:'Instrumented registration harness; supported WebMCP context unavailable',registrations,
   checks:['registration shape','read action','visible observation action','invalid action preserves state']};
  const artifact=path.join(__dirname,'artifacts');fs.writeFileSync(path.join(artifact,'tools-results.json'),JSON.stringify(report,null,2));
  const result=JSON.parse(fs.readFileSync(path.join(artifact,'results.json'),'utf8'));result.tools=report;
  fs.writeFileSync(path.join(artifact,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:'passed',checks:report.checks}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
