import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareHarness, isExtensionInstallationBlocked, freshState } from './harness.mjs';

await mkdir('test-results', { recursive: true });
const harnessMode = await isExtensionInstallationBlocked();
const harnessState = freshState();
if (harnessMode) console.log('LOCAL ADAPTER: managed Chromium blocks extension installation. Testing built scripts without changing browser policy.');
await build({ entryPoints: ['tests/fixture.jsx'], bundle: true, outfile: 'test-results/fixture.js', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' } });
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    let file;
    if (pathname === '/fixture.js') file = 'test-results/fixture.js';
    else if (pathname === '/' || pathname === '/iframe') file = 'tests/fixture.html';
    else {
      const allowed = ['options.html','options.js','popup.html','popup.js','ui.css','content.js'];
      if (!allowed.includes(pathname.slice(1))) { response.writeHead(404); response.end(); return; }
      file = `dist/${pathname.slice(1)}`;
    }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    let contents = await readFile(file);
    if (file === 'tests/fixture.html' && harnessMode) contents = Buffer.from(contents.toString().replace('</body>', '<script src="/content.js"></script></body>'));
    response.end(contents);
  } catch { response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(`${tmpdir()}/ordklar-browser-`);
const extension = resolve('dist');
const failures = [];
const externalRequests = [];
let passed = 0, context, extensionID;

async function launch() {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || '/usr/lib/chromium/chromium', headless: true, viewport: { width: 1280, height: 960 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'], ignoreDefaultArgs: ['--disable-extensions'] });
  if (harnessMode) await prepareHarness(context, harnessState);
  else {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:15000});
    extensionID = new URL(worker.url()).host;
  }
  context.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('chrome-extension:')) externalRequests.push(request.url()); });
}
async function check(name, callback) {
  try { await callback(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}\n${error.stack}`); if(page) { console.error(await page.evaluate(() => {const node = document.querySelector('#react-editor'); return node ? {html:node.innerHTML,text:node.textContent,state:document.querySelector('#react-editor-state').textContent} : 'No React editor mounted';}).catch(()=>'')); await page.screenshot({path:`test-results/failure-${failures.length}.png`}).catch(()=>{}); } }
}
async function setSettings(update) { await options.evaluate(update => chrome.storage.local.set(update), update); }
async function waitMark(page, word) { await page.locator(`.mark[data-word=${JSON.stringify(word)}]`).first().waitFor({ timeout: 15000 }); }
async function hoverWord(page, word) {
  await waitMark(page, word);
  const box = await page.locator(`.mark[data-word=${JSON.stringify(word)}]`).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y - 5);
  await page.locator('.tip').waitFor({ state: 'visible', timeout: 15000 });
}
async function choose(page, word, replacement) {
  await hoverWord(page, word);
  await page.locator('.tip').getByRole('button', { name: replacement, exact: true }).click();
}
async function waitText(locator, value) { await locator.page().waitForFunction(([selector, value]) => document.querySelector(selector).textContent === value, [await locator.getAttribute('id').then(id => `#${id}`), value], {timeout:5000}); }
let options, page;
const extensionPage = path => harnessMode ? `${base}/${path}` : `chrome-extension://${extensionID}/${path}`;

try {
  await launch();
  options = await context.newPage();
  await options.goto(extensionPage('options.html'));
  await setSettings({ enabled: true, grammar: true, language: 'da', terms: [] });
  page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.error(`PAGE ERROR: ${error.message}`); });
  await page.goto(base);

  await check('stave- og grammatikrettelser i textarea opdaterer tekst og input-events', async () => {
    await page.locator('#textarea').fill('Jeg er i tvivl om mit grammatik. Det er en stavefjel.');
    await waitMark(page, 'mit grammatik');
    await waitMark(page, 'stavefjel');
    await hoverWord(page, 'stavefjel');
    await page.screenshot({ path: 'test-results/correction.png' });
    await page.locator('.tip').getByRole('button', { name: 'stavefejl', exact: true }).click();
    assert.equal(await page.locator('#textarea').inputValue(), 'Jeg er i tvivl om mit grammatik. Det er en stavefejl.');
    await choose(page, 'mit grammatik', 'min grammatik');
    assert.equal(await page.locator('#textarea').inputValue(), 'Jeg er i tvivl om min grammatik. Det er en stavefejl.');
    assert.equal(await page.locator('#textarea-state').textContent(), await page.locator('#textarea').inputValue());
  });

  await check('contenteditable retter på tværs af spans og bevarer øvrig formatering', async () => {
    await page.locator('#editable').evaluate(editor => { editor.innerHTML = '<div>🚀 Mit <strong>grammatik</strong> er god.</div><div>Det er en <span>stavefjel</span>. <em>Hej</em></div>'; editor.focus(); editor.dispatchEvent(new InputEvent('input', {bubbles: true})); });
    await choose(page, 'Mit grammatik', 'Min grammatik');
    assert.ok((await page.locator('#editable').textContent()).includes('Min grammatik'));
    assert.equal(await page.locator('#editable em').textContent(), 'Hej');
    await choose(page, 'stavefjel', 'stavefejl');
    assert.ok((await page.locator('#editable').textContent()).includes('stavefejl'));
    assert.equal(await page.locator('#editable-state').textContent(), await page.locator('#editable').textContent());
    await page.locator('#editable').press('Control+z');
    assert.ok((await page.locator('#editable').textContent()).includes('stavefjel'));
  });

  await check('kontrolleret React-textarea beholder rettelsen i applikationens state', async () => {
    await page.locator('#react-textarea').fill('Det er en stavefjel.');
    await choose(page, 'stavefjel', 'stavefejl');
    await waitText(page.locator('#react-textarea-state'), 'Det er en stavefejl.');
    await page.locator('#react-textarea').press('End');
    await page.locator('#react-textarea').pressSequentially(' Hej');
    assert.equal(await page.locator('#react-textarea-state').textContent(), 'Det er en stavefejl. Hej');
  });

  await check('X-lignende React-editor registrerer korrekturen i sin state', async () => {
    const draft = page.locator('#react-editor [contenteditable="true"]');
    await draft.click();
    await draft.pressSequentially('Det er en stavefjel.');
    await waitText(page.locator('#react-editor-state'), 'Det er en stavefjel.');
    await choose(page, 'stavefjel', 'stavefejl');
    await waitText(page.locator('#react-editor-state'), 'Det er en stavefejl.');
    await draft.press('End');
    await draft.pressSequentially(' Hej');
    await waitText(page.locator('#react-editor-state'), 'Det er en stavefejl. Hej');
  });

  await check('almindeligt input kan rettes med samme hover-popup', async () => {
    await page.locator('#input').fill('stavefjel');
    await choose(page, 'stavefjel', 'stavefejl');
    assert.equal(await page.locator('#input').inputValue(), 'stavefejl');
  });

  await check('content-box og sidens CSS flytter ikke tekstmarkeringerne', async () => {
    const expected = await page.evaluate(() => {
      const field = document.querySelector('#textarea');
      field.style.cssText = 'box-sizing:content-box;width:140px;height:140px;font:18px/1.7 monospace;padding:16px;border:1px solid #ddd;';
      field.value = 'Jeg skriver en stavefjel.'; field.focus(); field.dispatchEvent(new InputEvent('input',{bubbles:true}));
      const style = document.createElement('style'); style.id='mirror-test-style'; style.textContent='html > div:not([data-ordklar]) { margin:80px !important; }'; document.head.append(style);
      const rect = field.getBoundingClientRect();
      const reference = document.createElement('pre'); reference.id='mirror-reference';
      reference.style.cssText=`position:fixed;left:${rect.left}px;top:${rect.top}px;box-sizing:content-box;width:140px;height:140px;font:18px/1.7 monospace;padding:16px;border:1px solid transparent;margin:0;white-space:pre-wrap;overflow-wrap:break-word;visibility:hidden;`;
      const text = document.createTextNode(field.value); reference.append(text); document.body.append(reference);
      const range = document.createRange(); range.setStart(text,15); range.setEnd(text,24);
      const word = range.getBoundingClientRect(); reference.remove();
      return {x:word.x,y:word.bottom-2};
    });
    try {
      await waitMark(page,'stavefjel');
      const actual=await page.locator('.mark[data-word="stavefjel"]').first().boundingBox();
      assert.ok(Math.abs(actual.x-expected.x)<1,`x ${actual.x} vs ${expected.x}`);
      assert.ok(Math.abs(actual.y-expected.y)<1,`y ${actual.y} vs ${expected.y}`);
      await choose(page,'stavefjel','stavefejl');
      assert.equal(await page.locator('#textarea').inputValue(),'Jeg skriver en stavefejl.');
    } finally { await page.evaluate(() => {document.querySelector('#textarea').style.cssText='';document.querySelector('#mirror-test-style')?.remove();}); }
  });

  await check('et højt input får markeringen ved den lodret centrerede tekst',async () => {
    await page.locator('#input').evaluate(field => {field.style.cssText='height:90px;padding:10px;font:18px monospace;line-height:normal;';});
    try {
      await page.locator('#input').fill('stavefjel'); await waitMark(page,'stavefjel');
      const field=await page.locator('#input').boundingBox();
      const mark=await page.locator('.mark[data-word="stavefjel"]').boundingBox();
      assert.ok(mark.y>field.y+field.height/2 && mark.y<field.y+field.height/2+18);
      await choose(page,'stavefjel','stavefejl');
      assert.equal(await page.locator('#input').inputValue(),'stavefejl');
    } finally {await page.locator('#input').evaluate(field => {field.style.cssText='';});}
  });

  await check('aktive felter kontrolleres ikke efter skift til password eller readonly',async () => {
    const field=page.locator('#input');
    try {
      await field.fill('stavefjel'); await waitMark(page,'stavefjel');
      await field.evaluate(node => {node.type='password';});
      await page.waitForFunction(() => !document.querySelector('[data-ordklar]').shadowRoot.querySelector('.mark'),null,{timeout:5000});
      await field.evaluate(node => {node.type='text';});
      await field.blur(); await field.focus(); await waitMark(page,'stavefjel');
      await field.evaluate(node => {node.readOnly=true;});
      await page.waitForFunction(() => !document.querySelector('[data-ordklar]').shadowRoot.querySelector('.mark'),null,{timeout:5000});
    } finally {await field.evaluate(node => {node.type='text';node.readOnly=false;});}
  });

  await check('en rettelse overskrider ikke tekstfeltets maxlength',async () => {
    await page.locator('#input').evaluate(node => {node.maxLength=8;});
    try {
      await page.locator('#input').fill('gramatik');
      await choose(page,'gramatik','grammatik');
      assert.equal(await page.locator('#input').inputValue(),'gramatik');
      assert.match(await page.locator('.tip .message').textContent(),/maksimale længde på 8 tegn/u);
    } finally {await page.locator('#input').evaluate(node => node.removeAttribute('maxlength'));}
  });

  await check('IME-indtastning genviser ikke gamle forslag ved resize',async () => {
    await page.locator('#textarea').fill('stavefjel'); await waitMark(page,'stavefjel');
    await page.locator('#textarea').evaluate(async node => {
      node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      window.dispatchEvent(new Event('resize'));
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    });
    assert.equal(await page.locator('.mark').count(),0);
    await page.locator('#textarea').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await waitMark(page,'stavefjel');
  });

  await check('ignorerede forslag opdaterer status, og tegnsætning kan rettes separat',async () => {
    await page.locator('#textarea').fill('stavefjel'); await hoverWord(page,'stavefjel');
    await page.locator('.tip').getByRole('button',{name:'Ignorer her',exact:true}).click();
    assert.equal(await page.locator('.status').textContent(),'✓ Ingen forslag');
    // Changing focus resets this field's ignored suggestions.
    await page.locator('#input').focus(); await page.locator('#textarea').fill('stavefjel !');
    await choose(page,' ','Fjern mellemrum');
    assert.equal(await page.locator('#textarea').inputValue(),'stavefjel!');
    await choose(page,'stavefjel','stavefejl');
    assert.equal(await page.locator('#textarea').inputValue(),'stavefejl!');
  });

  await check('password- og skrivebeskyttede felter aktiverer ikke korrektur', async () => {
    await page.locator('#password').fill('stavefjel');
    assert.equal(await page.locator('.mark').count(), 0);
    await page.locator('#readonly').focus();
    assert.equal(await page.locator('.mark').count(), 0);
  });

  await check('tastaturgenvej åbner en rettelse, som kan vælges med Enter', async () => {
    await page.locator('#textarea').fill('stavefjel');
    await waitMark(page,'stavefjel');
    await page.keyboard.press('Alt+Shift+o');
    await page.locator('.tip').getByRole('button',{name:'stavefejl',exact:true}).waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#textarea').inputValue(),'stavefejl');
  });

  await check('ny indtastning lukker en gammel popup uden at overskrive teksten', async () => {
    await page.locator('#textarea').fill('stavefjel');
    await hoverWord(page,'stavefjel');
    await page.locator('#textarea').fill('En helt ny tekst.');
    assert.equal(await page.locator('.tip').isVisible(),false);
    assert.equal(await page.locator('#textarea').inputValue(),'En helt ny tekst.');
  });

  await check('sprogvalg anvendes i en allerede åben fane', async () => {
    await setSettings({ language: 'en' });
    await page.locator('#textarea').fill('She have a speling mistake.');
    await choose(page, 'She have', 'She has');
    await choose(page, 'speling', 'spelling');
    assert.equal(await page.locator('#textarea').inputValue(), 'She has a spelling mistake.');
    await setSettings({ language: 'da' });
  });

  await check('gem ord fra hover-popup, og genbrug det i samme tekstfelt', async () => {
    await page.locator('#textarea').fill('Zorbquux');
    await hoverWord(page, 'Zorbquux');
    await page.locator('.tip').getByRole('button', {name: '+ Gem i ordliste', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-ordklar]').shadowRoot.querySelector('.status').textContent === '✓ Ingen forslag');
    assert.equal(await page.locator('.mark').count(), 0);
    await options.getByRole('button', { name: 'Fjern Zorbquux', exact: true }).waitFor();
  });

  await check('TXT/CSV/JSON-import, dubletter og eksport virker i indstillingerne', async () => {
    await options.locator('#file').setInputFiles({ name: 'terms.txt', mimeType: 'text/plain', buffer: Buffer.from('DeFi\nHODL\nDeFi\n') });
    await options.getByRole('button', {name: 'Fjern DeFi', exact:true}).waitFor();
    await options.locator('#file').setInputFiles({ name: 'terms.csv', mimeType: 'text/csv', buffer: Buffer.from('"Layer 2";tokenomics') });
    await options.getByRole('button', {name: 'Fjern Layer 2', exact:true}).waitFor();
    await options.locator('#file').setInputFiles({ name: 'terms.json', mimeType: 'application/json', buffer: Buffer.from('["Web3", "DeFi"]') });
    await options.getByRole('button', {name: 'Fjern Web3', exact:true}).waitFor();
    const terms = await options.evaluate(async () => (await chrome.storage.local.get('terms')).terms);
    assert.equal(terms.filter(term => term === 'DeFi').length, 1);
    const downloadEvent = options.waitForEvent('download');
    await options.locator('#export').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'ordklar-ordliste.json');
    assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), terms);
  });

  await check('ugyldig import viser fejl uden at slette den eksisterende ordliste', async () => {
    const before = await options.evaluate(async () => (await chrome.storage.local.get('terms')).terms);
    await options.locator('#file').setInputFiles({name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('["valid", 123]')});
    await options.locator('#feedback.error').waitFor();
    assert.deepEqual(await options.evaluate(async () => (await chrome.storage.local.get('terms')).terms), before);
  });

  await check('samtidige tilføjelser til ordlisten mister ingen termer', async () => {
    const result = await options.evaluate(async () => {
      await Promise.all(['ParallelAlpha','ParallelBeta'].map(term => chrome.runtime.sendMessage({type:'ADD_TERMS',terms:[term]})));
      return (await chrome.storage.local.get('terms')).terms;
    });
    assert.ok(result.includes('ParallelAlpha') && result.includes('ParallelBeta'));
    await options.evaluate(async () => { for (const term of ['ParallelAlpha','ParallelBeta']) await chrome.runtime.sendMessage({type:'REMOVE_TERM',term}); });
  });

  await check('en sendt term gemmes, selv om brugeren allerede skriver den næste',async () => {
    await options.evaluate(() => {
      const field=document.querySelector('#new-term');
      field.value='SubmittedTerm'; document.querySelector('#add-form').requestSubmit();
      field.value='NextTerm';
    });
    await options.getByRole('button',{name:'Fjern SubmittedTerm',exact:true}).waitFor();
    assert.equal(await options.locator('#new-term').inputValue(),'NextTerm');
    assert.equal(await options.getByRole('button',{name:'Fjern NextTerm',exact:true}).count(),0);
    await options.evaluate(() => chrome.runtime.sendMessage({type:'REMOVE_TERM',term:'SubmittedTerm'}));
    await options.locator('#new-term').fill('');
  });

  await check('kryptopakke, sletning og søgning virker', async () => {
    await options.locator('#crypto').click();
    await options.getByRole('button', {name: 'Fjern Bitcoin', exact:true}).waitFor();
    await options.locator('#search').fill('tokenomics');
    assert.equal(await options.locator('.term').count(), 1);
    await options.getByRole('button', {name:'Fjern tokenomics',exact:true}).click();
    await options.locator('.empty').waitFor();
    await options.locator('#search').fill('');
    await options.screenshot({path:'test-results/options.png',fullPage:true});
  });

  await check('deaktivering fjerner aktive markeringer og genaktivering scanner igen', async () => {
    await page.locator('#textarea').fill('stavefjel');
    await waitMark(page, 'stavefjel');
    await setSettings({enabled:false});
    await page.waitForFunction(() => !document.querySelector('[data-ordklar]').shadowRoot.querySelector('.mark'));
    await setSettings({enabled:true});
    await waitMark(page,'stavefjel');
  });

  await check('wrapped og rullende textarea placerer markering i feltet', async () => {
    await page.locator('#wrapped').fill('Jeg skriver mange ord i dette felt.\n'.repeat(10) + 'stavefjel');
    await page.locator('#wrapped').evaluate(editor => { editor.scrollTop = editor.scrollHeight; editor.dispatchEvent(new Event('scroll')); });
    await waitMark(page, 'stavefjel');
    const field = await page.locator('#wrapped').boundingBox();
    const mark = await page.locator('.mark[data-word="stavefjel"]').first().boundingBox();
    assert.ok(mark.y > field.y && mark.y < field.y + field.height);
    await choose(page,'stavefjel','stavefejl');
    assert.ok((await page.locator('#wrapped').inputValue()).endsWith('stavefejl'));
  });

  await check('åben Shadow DOM understøtter korrektur', async () => {
    await page.locator('#shadow-textarea').fill('stavefjel');
    await choose(page,'stavefjel','stavefejl');
    assert.equal(await page.locator('#shadow-textarea').inputValue(),'stavefejl');
  });

  await check('dynamisk indsat iframe får sin egen korrektur', async () => {
    await page.evaluate(base => { const frame = document.createElement('iframe'); frame.id = 'test-frame'; frame.src = `${base}/iframe`; document.querySelector('#frame-root').append(frame); },base);
    const frame = await page.waitForEvent('framenavigated', {predicate: frame => frame.url().endsWith('/iframe')}).catch(() => null);
    const iframe = frame || page.frames().find(frame => frame.url().endsWith('/iframe'));
    await page.locator('#test-frame').scrollIntoViewIfNeeded();
    await iframe.locator('#textarea').fill('stavefjel');
    await waitMark(iframe,'stavefjel');
    const mark = await iframe.locator('.mark[data-word="stavefjel"]').boundingBox();
    await page.mouse.move(mark.x + mark.width / 2, mark.y - 5);
    await iframe.locator('.tip').getByRole('button',{name:'stavefejl',exact:true}).click();
    assert.equal(await iframe.locator('#textarea').inputValue(),'stavefejl');
  });

  await check('popup styrer indstillinger og viser antallet af termer', async () => {
    const popup = await context.newPage(); await popup.goto(extensionPage('popup.html'));
    await popup.locator('[data-language="en"]').click();
    await popup.waitForFunction(() => document.querySelector('[data-language="en"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await options.locator('#language').inputValue(),'en');
    await popup.screenshot({path:'test-results/popup.png'});
    await popup.locator('[data-language="da"]').click();
    await popup.close();
  });

  await check('indbygget demo bruger samme korrekturmotor', async () => {
    await options.locator('summary').click();
    await options.locator('#demo').fill('mit grammatik stavefjel');
    await options.locator('#check-demo').click();
    await options.locator('#demo-output').getByRole('button',{name:'min grammatik',exact:true}).waitFor();
    await options.locator('#demo-output').getByRole('button',{name:'min grammatik',exact:true}).click();
    assert.equal(await options.locator('#demo').inputValue(),'min grammatik stavefjel');
    await options.locator('#demo-output').getByRole('button',{name:'stavefejl',exact:true}).waitFor();
    await setSettings({language:'en'});
    await options.waitForFunction(() => document.querySelector('#demo-output').textContent === '');
    await setSettings({language:'da'});
  });

  await check('ingen JavaScript-fejl eller eksterne tekstanmodninger', async () => {
    assert.deepEqual(pageErrors,[]); assert.deepEqual(externalRequests,[]);
  });

  await check(harnessMode ? 'ny browser og kold korrekturmotor bruger de gemte adapterindstillinger' : 'ordliste og indstillinger overlever en fuld browsergenstart',async () => {
    const before = await options.evaluate(async () => await chrome.storage.local.get(['terms','language','enabled']));
    await context.close(); await launch();
    options = await context.newPage(); await options.goto(extensionPage('options.html'));
    const after = await options.evaluate(async () => await chrome.storage.local.get(['terms','language','enabled']));
    assert.deepEqual(after,before);
    const fresh = await context.newPage(); await fresh.goto(base); await fresh.locator('#textarea').fill('stavefjel');
    await choose(fresh,'stavefjel','stavefejl');
    assert.equal(await fresh.locator('#textarea').inputValue(),'stavefejl');
  });
} finally {
  await context?.close();
  server.close();
  await rm(profile,{recursive:true,force:true});
}
console.log(`\n${passed} passed, ${failures.length} failed`);
await writeFile('test-results/browser-report.json', JSON.stringify({ mode: harnessMode ? 'local-chrome-api-adapter' : 'native-extension', passed, failed: failures.length, failures: failures.map(item => item.name), directXTested: false }, null, 2));
if(failures.length) process.exitCode=1;
