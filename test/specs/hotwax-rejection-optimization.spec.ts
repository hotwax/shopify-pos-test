import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {browser} from '@wdio/globals';
import {pos} from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';

describe('HotWax rejection-only sandbox UAT',()=>{
 for (const mode of (process.env.POS_UAT_CASE || '').split(',')) it(`submits ${mode} and verifies return to POS`,async()=>{
  const manifest=process.env.POS_UAT_MANIFEST||'/tmp/pos-opt-orders.json';
  const allowed=manifest==='/tmp/pos-opt-orders.json'?['HCDEV#5878','HCDEV#5879','HCDEV#5880','HCDEV#5881','HCDEV#5882']:manifest==='/tmp/pos-opt-refactor-orders.json'?['HCDEV#5883','HCDEV#5884','HCDEV#5885','HCDEV#5886']:manifest==='/tmp/pos-opt-final-orders.json'?['HCDEV#5887','HCDEV#5888']:manifest==='/tmp/pos-opt-inventory-orders.json'?['HCDEV#5889']:manifest==='/tmp/pos-native-committed-orders.json'?['HCDEV#5891']:[];
  if(!allowed.length)throw new Error('Unknown optimization fixture manifest');
  const fixtures=JSON.parse(await readFile(manifest,'utf8'));
  const fixture=fixtures.find((f:any)=>f.mode===(mode==='shipping-readback'||mode==='shipping-readonly'||mode==='shipping-demo'?'shipping-enabled':mode));
  if(!fixture?.shopifyPreparedAt||!allowed.includes(fixture.name))throw new Error('Only new optimization fixtures may be used');
  if(!fixture||!['shipping-demo','shipping-readonly','shipping-readback','shipping-enabled','disabled-one','disabled-multiple','fallback-variance','fallback-offline'].includes(mode||''))throw new Error('Unknown sandbox UAT case');
  const dir=resolve(process.env.RUN_ARTIFACT_DIR!, ...(process.env.POS_UAT_CASE?.includes(',') ? [mode] : []));await mkdir(dir,{recursive:true});
  const button=(label:string)=>browser.$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}" AND visible == 1`);
  const allButtons=async(label:string)=>(await browser.$$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}" AND visible == 1`).getElements());
  const snapshot=async(name:string)=>{const xml=await browser.getPageSource();await writeFile(join(dir,name+'.xml'),xml);await browser.saveScreenshot(join(dir,name+'.png'));return xml;};
  await browser.updateSettings({animationCoolOffTimeout:0,waitForIdleTimeout:0});
  await browser.execute('mobile: activateApp',{bundleId:'com.jadedpixel.pos'});
  await browser.waitUntil(async()=>await browser.$('~Enter PIN').isDisplayed()||await browser.$('~Screen.OrderDetailsScreen').isDisplayed()||await browser.$('~Screen.UIExtensionModal').isDisplayed()||await browser.$(s.ordersTab).getAttribute('hittable')==='true',{timeout:30000}).catch(()=>false);
  const unlockIfNeeded = async () => {
  if (await browser.$('~Enter PIN').isDisplayed()) {
   const history = await readFile('/Users/adityapatel/.codex/sessions/2026/09/25/rollout-2026-09-25T11-50-55-01a0d9e8-001d-7261-afa9-82e06674d498.jsonl','utf8');
   let authorizedPin = '';
   for (const line of history.split('\n')) {
    let record:any; try {record=JSON.parse(line)} catch {continue}
    if(record.type!=='response_item'||record.payload?.role!=='user')continue;
    const text=(record.payload.content||[]).map((x:any)=>x.text||'').join(' ');
    const match=text.match(/(\d{4}), remember it and fill it in yourself/);
    if(match)authorizedPin=match[1];
   }
   if(!authorizedPin)throw new Error('Previously authorized PIN unavailable');
   const keypad=new Map<string,WebdriverIO.Element>();
   for(const key of await browser.$$('XCUIElementTypeButton').getElements()){
    const label=await key.getAttribute('label');if(label&&/^\d$/.test(label))keypad.set(label,key);
   }
   for(const digit of authorizedPin){const key=keypad.get(digit);if(!key)throw new Error('PIN keypad unavailable');await key.click()}
   authorizedPin='';
   if(await button('Submit').isDisplayed())await button('Submit').click();
   await browser.$('~Enter PIN').waitForDisplayed({reverse:true,timeout:20000});
  }
  };
  await unlockIfNeeded();

  if(await browser.$('~Screen.ShipFromStore.PrepareToShip.Actions.FulfillItems').isDisplayed())await button('Close').click();
  for(const apply of ['Apply reason','Apply variance reason'])if(await button(apply).isDisplayed())await button('Cancel').click();
  if(await browser.$('~Screen.UIExtensionModal').isDisplayed())await button('Close').click();
  const onTargetOrder = !process.env.SHOPIFY_POS_PREVIEW_URL && mode !== 'shipping-readback' && await browser.$('~Screen.OrderDetailsScreen').isDisplayed() && (await browser.$('~OrderDetailsHeader.Title').getAttribute('label'))?.trim() === fixture.name;
  if(!onTargetOrder && await browser.$('~Screen.OrderDetailsScreen').isDisplayed())await button('Close').click();
  if(process.env.SHOPIFY_POS_PREVIEW_URL){
   await browser.execute('mobile: deepLink',{url:process.env.SHOPIFY_POS_PREVIEW_URL});
   await browser.waitUntil(async()=>await browser.$('~POS Dev Console').isDisplayed()||await browser.$('~Enter PIN').isDisplayed(),{timeout:20000}).catch(()=>false);
   await unlockIfNeeded();
   const opened=await browser.waitUntil(async()=>await browser.$('~POS Dev Console').isDisplayed(),{timeout:12000}).catch(()=>false);
   await snapshot('preview-link-opened');
   if (!opened) await browser.$('~POSDevConsoleScreen').click();
   await browser.$('~POS Dev Console').waitForDisplayed({timeout:20000});
   const persistence=browser.$('-ios predicate string:type == "XCUIElementTypeSwitch" AND label BEGINSWITH "App persistence"');
   if(await persistence.isDisplayed()&&await persistence.getAttribute('value')==='0'){
    await persistence.click();
    await browser.waitUntil(async()=>await persistence.getAttribute('value')==='1',{timeout:10000});
   }
   await snapshot('preview-console');
   await browser.$('~Component.ActionBar.PrimaryActionButton').click();
  }
  if (!onTargetOrder) {
  await browser.waitUntil(async()=>await browser.$(s.ordersTab).isDisplayed()&&await browser.$(s.ordersTab).isEnabled()&&await browser.$(s.ordersTab).getAttribute('hittable')==='true',{timeout:30000,timeoutMsg:'Waiting for POS to finish opening'});
  await pos.openOrdersScreen();
  await browser.$('~Screen.OrdersScreen.NavListContent.Item.OrdersWorkflow').click();
  const posOnly=await browser.$('~Component.Filters.FilterButton.SaleType.Point of Sale');
  if(await posOnly.isDisplayed()){
   await posOnly.click();await browser.$('~Screen.SingleSelectfiltersScreen.FilterButton.ONLINE').click();
  }
  await pos.openOrderByReference(fixture.name);
  }
  if(await button('Hide keyboard').isDisplayed())await button('Hide keyboard').click();
  const title=await browser.$('~OrderDetailsHeader.Title').getAttribute('label');
  if(title?.trim()!==fixture.name)throw new Error('Wrong order opened; refusing write');
  if(mode==='shipping-readback'){
   await snapshot('readback-before-open');
   const prepare=browser.$('~Screen.OrderDetailsScreen.Actions.PrepareForShipping');
   await prepare.waitForDisplayed({timeout:15000});await prepare.click();
   await browser.$('~Screen.ShipFromStore.PrepareToShip.Actions.FulfillItems').waitForDisplayed({timeout:15000});
   await snapshot('remaining-to-pack');
   const short=browser.$('-ios predicate string:visible == 1 AND label CONTAINS "Ana Running Short"');
   const jacket=browser.$('-ios predicate string:visible == 1 AND label CONTAINS "'+(manifest==='/tmp/pos-native-committed-orders.json'?'Inez Full Zip Jacket':'Winter Jacket')+'"');
   if(!await short.isDisplayed()||await jacket.isDisplayed())throw new Error('Packing page does not show only the remaining short');
   await button('Close').click();
   return;
  }
  if(mode==='shipping-enabled')await snapshot('native-before-rejection');
  if(mode==='fallback-offline' && process.env.POS_OUTAGE_SYNC){
   await writeFile(join(dir,'outage-ready'),'ready');
   await browser.waitUntil(async()=>await readFile(join(dir,'outage-active'),'utf8').then(()=>true).catch(()=>false),{timeout:10000});
  }
  const retry=button('App failed to load, by hc-rails-reassign-fulfillment, Retry'); if(await retry.isDisplayed()){await retry.click();await snapshot('extension-retry');}
  await snapshot('order-loaded');
  const action=browser.$('-ios predicate string:label == "HotWax Reject, by hc-rails-reassign-fulfillment" OR label == "Reject fulfillment items with OMS reasons and reassign them from this store, by hc-rails-reassign-fulfillment"');
  await action.waitForExist({timeout:15000});
  if(!await action.isDisplayed())await browser.execute('mobile: scroll',{elementId:action.elementId,toVisible:true});
  await action.waitForDisplayed({timeout:15000});
  await browser.waitUntil(async()=>await action.getAttribute('hittable')==='true',{timeout:15000,timeoutMsg:'Rejection menu is not ready for a tap'});
  await action.click();
  await snapshot('modal-opening');
  await browser.waitUntil(async()=>await browser.$('-ios predicate string:visible == 1 AND name IN {"Ready for fulfillment","Fulfillment does not match OMS","OMS unavailable","Unable to load items"}').isDisplayed(),{timeout:65000});
  await snapshot('loaded');
  if(mode==='fallback-offline' && process.env.POS_OUTAGE_SYNC)await writeFile(join(dir,'outage-loaded'),'loaded');
  const choose=async(label:string,reason:string)=>{
   await browser.waitUntil(async()=> (await allButtons(label)).length>0,{timeout:15000,timeoutMsg:'No visible item reason control'});
   const buttons=await allButtons(label);await buttons[0].waitForEnabled({timeout:65000});await buttons[0].click();
   const apply=label.includes('variance')?'Apply variance reason':'Apply reason';await snapshot('reason-modal');await button(apply).waitForDisplayed({timeout:35000});
   await browser.waitUntil(async()=>await button(apply).isEnabled(),{timeout:65000});
   const option=browser.$(`-ios predicate string:type == "XCUIElementTypeOther" AND name BEGINSWITH "${reason}, " AND visible == 1`);
   await option.waitForDisplayed({timeout:10000});await option.click();await button(apply).click();
  };
  if(mode?.startsWith('fallback')){
   const heading=mode==='fallback-variance'?'Fulfillment does not match OMS':'OMS unavailable';
   if(!await browser.$(`~${heading}`).isDisplayed())throw new Error('Unexpected fallback mode; refusing write');
   if(mode==='fallback-variance')await choose('Choose variance reason','Damaged');
   const confirm=button(mode==='fallback-variance'?'Move fulfillment and record variance':'Move fulfillment to Warehouse Agg');
   await confirm.waitForEnabled({timeout:65000});await snapshot('before-confirm');await confirm.click();
   await browser.$('~Fulfillment moved').waitForDisplayed({timeout:80000});
  }else{
   if(!await browser.$('~Ready for fulfillment').isDisplayed())throw new Error('OMS context unavailable; refusing rejection');
   await choose('Choose rejection reason','Damaged');
   if(mode==='shipping-readonly'||mode==='shipping-demo'){
    await button('Confirm rejection').waitForEnabled({timeout:65000});
    await snapshot('current-code-readonly');
    if(mode==='shipping-demo')return;
    await button('Change reason').click();
    await button('Cancel').waitForDisplayed({timeout:35000});
    await button('Cancel').click();
    await button('Close').click();
    return;
   }
   if(mode==='disabled-multiple')await choose('Choose rejection reason','Mismatch');
   const confirm=button('Confirm rejection');
   if (!await confirm.isDisplayed()) {const scroll=await browser.$('-ios predicate string:type == "XCUIElementTypeScrollView" AND visible == 1');await browser.execute('mobile: scroll',{direction:'down',elementId:scroll.elementId,distance:0.7});}
   await confirm.waitForEnabled({timeout:65000});
   const source=await snapshot('before-confirm');
   if(mode.startsWith('disabled')&&!source.includes('Partial rejection is disabled'))throw new Error('Expected whole-fulfillment policy');
   if(source.includes('Confirm rejection and pack'))throw new Error('Packing action remains');
   await confirm.click();
   await browser.$('~Rejection saved').waitForDisplayed({timeout:80000});
  }
  const saved=await snapshot('saved');if(!saved.includes('No items were packed.'))throw new Error('Success did not confirm rejection-only outcome');
  await button('Return to order').click();await browser.$('~Screen.OrderDetailsScreen').waitForDisplayed({timeout:15000});
  await snapshot('returned-order');
  await writeFile(join(dir,'uat.json'),JSON.stringify({mode,order:fixture.name,id:fixture.id,submitted:true,returnedToPos:true}));
 });
});
