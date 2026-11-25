// Against the isolated laboratory only. Native controls apply the real commands.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const out=fileURLToPath(new URL('../../../../../.qa/overdrive-finale/',import.meta.url))
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chromium',args:['--mute-audio']})
try {
  for(const [name,button,from,to,impulse,promotion] of [
    ['corner','Мат в углу','a6','a8',false,false],
    ['crowded','Опора на соседа','h6','f7',false,false],
    ['battery','Батарея с матом','d4','g7',true,false],
    ['promotion','Ферзь с матом','f7','g8',false,true],
  ]) {
    const context=await browser.newContext({viewport:{width:1200,height:800},recordVideo:{dir:out,size:{width:1200,height:800}}})
    const page=await context.newPage()
    const errors=[]
    page.on('pageerror',err=>errors.push(err.message))
    await page.goto('http://127.0.0.1:4198/tests/fixtures/finale.html')
    await page.getByRole('button',{name:new RegExp(button)}).click()
    await page.locator('.od-close').click()
    await page.locator('canvas').waitFor()
    await page.waitForFunction(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/models/')&&e.name.includes('.glb')).length>=6)
    await page.waitForTimeout(850)
    const video=page.video()
    const rect=await page.locator('canvas').boundingBox()
    const zoom=Math.min(rect.width,rect.height)/10.8
    const cameraLength=Math.hypot(11,8.8)
    // Click directly through the orthographic camera, without focusing the
    // keyboard grid (keyboard focus intentionally shows the accessible board).
    const click=square=>page.mouse.click(rect.x+rect.width/2+(square.charCodeAt(0)-100.5)*zoom,
      rect.y+rect.height/2+((4.5-Number(square[1]))*11-.07*8.8)/cameraLength*zoom)
    await click(from)
    if(impulse)await page.getByRole('button',{name:/Импульс/}).click()
    await click(to)
    if(promotion)await page.locator('.od-action-choices').getByRole('button',{name:/Ферзь/i}).click()
    await page.locator('.od-result').waitFor()
    await page.waitForTimeout(2700)
    await page.screenshot({path:out+name+'.png'})
    if(errors.length)throw Error(errors.join('\n'))
    await context.close()
    await video.saveAs(out+name+'.webm')
    await video.delete()
    console.log(name+' · '+out+name+'.webm')
  }
} finally {await browser.close()}
