/** Real HTTP/SQLite acceptance of the rebuilt table. Synthetic positions are isolated by the harness. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createFeedbackHarness } from './district-feedback-fixtures.mjs';

const harness = await createFeedbackHarness({ scenarioIds: ['production-flight','atmosphere-expiry','seven-discard','coupon-free','coupon-surcharge','coupon-expiry','long-news'] });
const artifacts = join(harness.directory, 'browser');
await mkdir(artifacts);
const browser = await chromium.launch({ headless: true,
  args: ['--mute-audio', ...(process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : [])
    .filter(value => !value.includes('disable-web-security') && !value.includes('allow-running-insecure-content') && !value.includes('single-process'))],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const errors = [], results = { syntheticPositions: true, mockedApi: false, externalMessages: 0, scenarios: [], layouts: [], newsInputs: [] };
const contexts = [], pages = [];
for (const [index, account] of harness.manifest.accounts.entries()) {
  const context = await browser.newContext({ storageState: account.storageState, viewport: { width: 1366, height: 768 }, hasTouch: index === 1 });
  await context.addInitScript(() => {
    if (['http:', 'https:'].includes(location.protocol) && !localStorage.getItem('iva.portal.language')) localStorage.setItem('iva.portal.language', 'en');
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  contexts.push(context); pages.push(page);
}
const view = async (entry, index = entry.hostIndex) => (await harness.clients[index].request(`/rooms/${entry.roomId}/match`)).view;
async function open(entry) {
  for (const page of pages) { await page.goto(entry.url); await expect(page.locator('.territorial-board')).toBeVisible(); }
}
async function closeNews(page) {
  const close = page.getByRole('button', { name: /^(Dismiss news|Свернуть новости)$/ });
  if (await close.isVisible()) await close.click();
}
async function action(page, button) {
  await closeNews(page);
  // The other participant may just have acted. Let the real polling client consume its next snapshot.
  await page.waitForResponse(response => response.url().endsWith('/match') && response.request().method() === 'GET' && response.ok());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const response = page.waitForResponse(response => response.url().endsWith('/actions') && response.request().method() === 'POST');
  await button.click();
  const received = await response;
  assert.equal(received.status(), 200, await received.text());
  return (await received.json()).view;
}
async function select(page, kind, id) {
  const target = page.locator(`[data-board-target="${kind}:${id}"]`);
  await target.focus(); await target.press('Enter');
}
async function fits(page, label) {
  const geometry = await page.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right }; };
    return { viewport:{width:innerWidth,height:innerHeight}, width:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight,
      board:box('.tb-surface'), panel:box('.territory-inspector'), dice:box('.territory-dice'), hand:box('.territory-hand') };
  });
  assert.ok(geometry.width <= geometry.viewport.width + 1, label + ': horizontal page overflow');
  assert.ok(geometry.height <= geometry.viewport.height + 1, label + ': vertical page overflow');
  assert.ok(geometry.board.height >= 100 && geometry.board.width >= 280, label + ': map too small');
  for (const key of ['board','panel','dice','hand']) assert.ok(geometry[key].bottom <= geometry.viewport.height + 1, label + ': hidden ' + key);
  results.layouts.push({ label, ...geometry });
}
async function readNewsByInput(page, input) {
  const scroll = page.locator('.tn-issue-cards');
  const last = page.getByText('END OF TEST ISSUE', { exact: true });
  await scroll.focus(); await scroll.press('Home');
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
  const touch = input === 'touch' ? await page.context().newCDPSession(page) : null;
  if (touch) assert.ok(await page.evaluate(() => navigator.maxTouchPoints > 0), 'Touch context is required');
  let gestures = 0;
  try {
    for (; gestures < 30; gestures++) {
      const position = await last.evaluate(element => {
        const article = element.closest('.tn-issue-cards'), outer = article.getBoundingClientRect(), inner = element.getBoundingClientRect();
        return { visible: inner.top >= outer.top && inner.bottom <= outer.bottom, delta: (inner.top + inner.bottom - outer.top - outer.bottom) / 2,
          x: outer.left + outer.width / 2, top: outer.top, bottom: outer.bottom, height: outer.height, scrollTop: article.scrollTop };
      });
      if (position.visible) break;
      const distance = Math.sign(position.delta) * Math.min(Math.abs(position.delta), position.height * .55);
      if (touch) {
        // Native Chromium touch input drives the browser's scroll handling; no DOM scroll assignment.
        const startY = distance > 0 ? position.bottom - 24 : position.top + 24;
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: position.x, y: startY, id: 1 }] });
        for (let step = 1; step <= 8; step++) {
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: position.x, y: startY - distance * step / 8, id: 1 }] });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(position.x, (position.top + position.bottom) / 2);
        await page.mouse.wheel(0, distance);
      }
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).not.toBe(position.scrollTop);
    }
    await expect(last).toBeInViewport();
    assert.ok(gestures > 0 && gestures < 30, input + ': long issue did not reach its last paragraph');
    results.newsInputs.push({ viewport: page.viewportSize(), input, gestures, lastParagraphVisible: true,
      ...(touch ? { method: 'Chromium native touch input, not a physical device' } : {}) });
  } finally { await touch?.detach(); }
}
try {
  // Real production receipt and original resource flight, followed by a non-replaying reload.
  {
    const entry=await harness.reset('production-flight'); await open(entry);
    const page=pages[entry.hostIndex]; await page.emulateMedia({reducedMotion:'no-preference'});
    const before=await view(entry);
    const after=await action(page,page.getByRole('button',{name:'Roll dice',exact:true}));
    const own=after.latestRoll.sources.filter(source=>source.ownerId===after.you.participantId);
    assert.ok(own.some(source=>source.tileId===entry.expected.tileId&&source.resource===entry.expected.resource));
    assert.ok(after.you.hand[entry.expected.resource]>before.you.hand[entry.expected.resource]);
    const flight=page.locator('.territory-income-flight[data-source-tile="'+entry.expected.tileId+'"][data-resource="'+entry.expected.resource+'"]').first();
    await expect(flight).toBeVisible();
    await page.reload(); await expect(page.locator('.territory-match')).toBeVisible();
    await expect(page.locator('.territory-income-flight')).toHaveCount(0);
    results.scenarios.push({name:'production-flight',actualSource:true,handCredited:true,noReplay:true});
  }
  {
    const entry=await harness.reset('atmosphere-expiry'); await open(entry);
    const page=pages[entry.guestIndex];
    await expect(page.locator('.tb-atmosphere-illness.is-live').first()).toBeVisible();
    await action(page,page.getByRole('button',{name:'End turn',exact:true}));
    await expect(page.locator('.tb-atmosphere-illness.is-live')).toHaveCount(0);
    results.scenarios.push({name:'atmosphere-expiry',activeVisible:true,expiredRemoved:true});
  }
  // A seven, both independent discards, actual blockade and persistence after a new turn.
  let entry = await harness.reset('seven-discard'); await open(entry);
  let page = pages[entry.hostIndex], other = pages[entry.guestIndex];
  let rolled = await action(page, page.getByRole('button', { name:'Roll dice', exact:true }));
  assert.equal(rolled.latestRoll.sum,7);
  const label = `${rolled.latestRoll.dice[0]} + ${rolled.latestRoll.dice[1]} = 7`;
  await expect(page.locator('.territory-dice').first()).toHaveAttribute('aria-label',label);
  await page.getByRole('spinbutton',{name:'Return resources to the bank · Wood',exact:true}).fill('4');
  await action(page,page.getByRole('button',{name:'Discard 4 / 4',exact:true}));
  await other.getByRole('spinbutton',{name:'Return resources to the bank · Grain',exact:true}).fill('4');
  await action(other,other.getByRole('button',{name:'Discard 4 / 4',exact:true}));
  rolled = await view(entry);
  const block = rolled.legal.block.find(item => item.targets.length) ?? rolled.legal.block[0];
  await select(page,'tile',block.tileId);
  const blocked = await action(page,page.getByRole('button',{name:'Move blockade',exact:true}));
  assert.equal(blocked.blockade.reason,'seven');
  await expect(page.locator('.territory-dice').first()).toHaveAttribute('aria-label',label);
  await page.reload(); await expect(page.locator('.territory-dice').first()).toHaveAttribute('aria-label',label);
  await select(page,'tile',block.tileId);
  await expect(page.locator('.territory-blockade')).toContainText('Seven');
  await action(page,page.getByRole('button',{name:'End turn',exact:true}));
  await expect(other.getByRole('button',{name:'Roll dice',exact:true})).toBeVisible();
  await action(other,other.getByRole('button',{name:'Roll dice',exact:true}));
  await page.reload(); await select(page,'tile',block.tileId);
  await expect(page.locator('.territory-blockade')).toContainText('Seven');
  await page.getByRole('button',{name:'Turn history',exact:true}).click();
  await expect(page.locator('.territory-history')).toContainText(label);
  results.scenarios.push({name:'seven',dice:rolled.latestRoll.dice,discardBoth:true,blockade:'seven',reload:true,laterTurn:true});

  // Coupon navigation uses exactly the server's list, with neighbouring/sea exclusions and final payment.
  for (const id of ['coupon-free','coupon-surcharge']) {
    entry = await harness.reset(id); await open(entry); page=pages[entry.hostIndex];
    const before = await view(entry), coupon = before.you.coupons.find(item => item.kind==='free-road');
    await page.locator('.tn-coupon').getByRole('button',{name:'Show eligible roads',exact:true}).click();
    const highlighted = await page.locator('.tb-target.is-coupon-road').evaluateAll(items=>items.map(item=>item.dataset.boardTarget.slice(5)).sort());
    assert.deepEqual(highlighted,[...before.legal.couponRoutes[coupon.id]].sort());
    await select(page,'edge',entry.expected.adjacent);
    await expect(page.locator('.ta-selected')).toContainText('different sector');
    await select(page,'edge',entry.expected.sea);
    await expect(page.locator('.ta-selected')).toContainText('land roads only');
    await select(page,'edge',entry.expected.land);
    const price = before.legal.options.find(option=>option.id===entry.expected.land).cost;
    const after = await action(page,page.getByRole('button',{name:'Build road',exact:true}));
    for(const resource of Object.keys(before.you.hand)) assert.equal(before.you.hand[resource]-after.you.hand[resource],price[resource]);
    assert.ok(!after.you.coupons.some(item=>item.id===coupon.id));
    results.scenarios.push({name:id,eligibleRoads:highlighted.length,price,neighbourExcluded:true,seaExcluded:true,paidMatches:true});
  }
  entry = await harness.reset('coupon-expiry'); await open(entry);
  await closeNews(pages[entry.guestIndex]);
  const beforeExpiry = await view(entry);
  assert.equal(beforeExpiry.activeParticipantId, entry.expected.otherId);
  await action(pages[entry.guestIndex],pages[entry.guestIndex].getByRole('button',{name:'End turn',exact:true}));
  await action(pages[entry.hostIndex],pages[entry.hostIndex].getByRole('button',{name:'Roll dice',exact:true}));
  const expired = await view(entry);
  assert.equal(expired.you.coupons.length,0);
  assert.equal(expired.legal.options.find(option=>option.id===entry.expected.land).cost.wood,1);
  results.scenarios.push({name:'coupon-expiry',expired:true,normalPriceRestored:true});

  // Reading and reopening a long issue at desktop, short and touch-sized viewports.
  entry = await harness.reset('long-news'); await open(entry); page=pages[entry.hostIndex];
  for(const size of [{width:1366,height:768},{width:1024,height:600},{width:390,height:844},{width:390,height:600}]) {
    await page.setViewportSize(size);
    await page.locator('.tn-open').click();
    await readNewsByInput(page, 'wheel');
    if (size.width <= 620) await readNewsByInput(page, 'touch');
    const scroll = page.locator('.tn-issue-cards');
    await scroll.focus(); await scroll.press('End');
    await expect(page.locator('.tn-card .tn-area[aria-pressed]').last()).toBeInViewport();
    await scroll.press('PageUp');
    await expect(page.getByText('END OF TEST ISSUE',{exact:true})).toBeInViewport();
    assert.ok(await scroll.evaluate(element=>element.scrollHeight>element.clientHeight && element.scrollTop>0));
    await select(page,'node',entry.expected.house);
    await expect(page.locator('.tn-issue')).toBeVisible();
    await fits(page,`${size.width}x${size.height}`);
    await page.screenshot({path:join(artifacts,`news-${size.width}x${size.height}.png`)});
    await closeNews(page);
    await page.locator('.tn-journal-open').click();
    await page.locator('.tn-journal-group button').filter({hasText:'TEST · Long district news issue'}).click();
    await expect(page.locator('.tn-card')).toContainText('END OF TEST ISSUE');
    await closeNews(page);
  }
  // News area can be reviewed on the small map after the issue is closed.
  await page.locator('.tn-open').click();
  const mapButton=page.locator('.tn-card .tn-area[aria-pressed]');
  if(await mapButton.getAttribute('aria-pressed')==='true') await mapButton.click();
  await mapButton.click();
  await expect(page.locator('.tn-issue')).toHaveCount(0);
  await expect(page.locator('.tb-news-frame')).toBeVisible();
  results.scenarios.push({name:'long-news',keyboardEnd:true,mouseWheel:true,nativeTouchScroll:true,reopenJournal:true,selectionKeepsArticle:true,showMapClosesArticleKeepsOutline:true});

  // Shared settings reflect current rules; personal settings persist without replacing the game.
  await page.setViewportSize({width:1366,height:768});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Text size',{exact:true}).selectOption('130');
  await dialog.getByLabel('Reduce motion',{exact:false}).check();
  await dialog.getByLabel('Higher contrast',{exact:false}).check();
  await dialog.getByRole('button',{name:'Match · everyone',exact:true}).click();
  await expect(dialog).toContainText('150 sec');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await fits(page,'text130');
  await page.reload();
  await expect(page.locator('.territory-match')).toHaveClass(/territory-reduce-motion/);
  await expect(page.locator('.territory-match')).toHaveClass(/territory-contrast/);
  assert.equal(await page.locator('.territory-match').evaluate(el=>el.style.getPropertyValue('--table-text-scale')),'1.3');
  await closeNews(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Language',{exact:true}).selectOption('ru');
  await expect(page.getByRole('dialog')).toContainText('Размер текста');
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(page.locator('.territory-roll')).toContainText('Последний бросок');
  results.scenarios.push({name:'settings',persisted:true,text:130,motionReduced:true,contrast:true,languageChangedInPlace:true,roomRules:true});

  // Russian resource labels and the phase stay visible with enlarged text on short mobile layouts.
  for (const size of [{ width:390, height:844 }, { width:390, height:600 }]) {
    await page.setViewportSize(size); await closeNews(page);
    await fits(page, `ru-text130-${size.width}x${size.height}`);
    await expect(page.locator('.territory-phase p')).toBeInViewport();
    const labels = page.locator('.territory-hand .ta-resource-name');
    assert.deepEqual(await labels.allTextContents(), ['Древесина','Кирпич','Зерно','Шерсть','Руда']);
    for (const label of await labels.all()) await expect(label).toBeInViewport();
    await expect(page.getByRole('button', { name:'Настройки', exact:true })).toBeVisible();
    await expect(page.getByRole('button', { name:'Действия', exact:true })).toBeInViewport();
    await page.screenshot({path:join(artifacts,`table-ru-text130-${size.width}x${size.height}.png`)});
  }
  entry = await harness.reset('seven-discard'); await open(entry);
  await action(pages[entry.hostIndex],pages[entry.hostIndex].getByRole('button',{name:'Roll dice',exact:true}));
  page = pages[entry.guestIndex];
  await expect(page.locator('.territory-phase p')).toContainText('Семёрка: верните 4 карты');
  await expect(page.locator('.territory-phase p')).toBeInViewport();
  await fits(page,'ru-text130-390x600-required-discard');
  await page.screenshot({path:join(artifacts,'required-step-ru-text130-390x600.png')});
  await page.getByRole('spinbutton',{name:'Верните ресурсы в банк · Зерно',exact:true}).fill('4');
  const discard = page.getByRole('button',{name:'Вернуть 4 / 4',exact:true});
  await discard.focus(); await expect(discard).toBeInViewport();
  await page.screenshot({path:join(artifacts,'required-action-ru-text130-390x600.png')});
  const afterSmallDiscard = await action(page,discard);
  assert.equal(afterSmallDiscard.you.discard,0);
  results.scenarios.push({name:'mobile-readability',language:'ru',text:130,resources:5,requiredStepVisible:true,requiredActionCompleted:true,physicalDevice:false});

  // Delivered build bytes and audio media type, not a live production claim.
  assert.equal(await (await fetch(harness.origin)).text(),await readFile(join(harness.directory,'portal/index.html'),'utf8'));
  const sound=await fetch(harness.origin+'/assets/district/audio/house.wav');
  assert.equal(sound.status,200); assert.equal(sound.headers.get('content-type'),'audio/wav');
  assert.deepEqual(errors,[]);
  results.browserErrors=errors;results.browserVersion=browser.version();results.build=harness.manifest.buildHashes;
  await writeFile(join(artifacts,'results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({...results,artifacts},null,2));
} catch(error) {
  for (const [index,page] of pages.entries()) await page.screenshot({path:join(artifacts,`failure-${index}.png`)}).catch(()=>{});
  await writeFile(join(artifacts,'partial-results.json'),JSON.stringify({...results,errors},null,2)+'\n');
  console.error('Isolated diagnostics:',artifacts);
  throw error;
} finally {await browser.close();await harness.dispose();}
