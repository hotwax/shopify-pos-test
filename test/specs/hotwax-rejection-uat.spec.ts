import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {browser} from '@wdio/globals';
import {pos} from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';

describe('HotWax rejection-only sandbox UAT',()=>{
 for (const mode of (process.env.POS_UAT_CASE || '').split(',')) it(`submits ${mode} and verifies return to POS`,async()=>{
  const fixtures=JSON.parse(await readFile('/tmp/pos-uat-orders.json','utf8'));
  const fixture=mode==='enabled'?{name:'HCDEV#5728',id:'gid://shopify/Order/7648119619748'}:fixtures.find((f:any)=>f.mode===mode);
  if(!fixture||!['enabled','enabled-quantity','shipping-enabled','disabled-one','disabled-multiple','fallback-variance','fallback-offline'].includes(mode||''))throw new Error('Unknown sandbox UAT case');
  const dir=resolve(process.env.RUN_ARTIFACT_DIR!, ...(process.env.POS_UAT_CASE?.includes(',') ? [mode] : []));await mkdir(dir,{recursive:true});
  const button=(label:string)=>browser.$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}" AND visible == 1`);
  const allButtons=async(label:string)=>(await browser.$$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}" AND visible == 1`).getElements());
  const snapshot=async(name:string)=>{const xml=await browser.getPageSource();await writeFile(join(dir,name+'.xml'),xml);await browser.saveScreenshot(join(dir,name+'.png'));return xml;};
  await browser.updateSettings({animationCoolOffTimeout:0,waitForIdleTimeout:0});
  await browser.execute('mobile: activateApp',{bundleId:'com.jadedpixel.pos'});
  for(const apply of ['Apply reason','Apply variance reason'])if(await button(apply).isDisplayed())await button('Cancel').click();
  if(await browser.$('~Screen.UIExtensionModal').isDisplayed())await button('Close').click();
  const onTargetOrder = await browser.$('~Screen.OrderDetailsScreen').isDisplayed() && (await browser.$('~OrderDetailsHeader.Title').getAttribute('label'))?.trim() === fixture.name;
  if(!onTargetOrder && await browser.$('~Screen.OrderDetailsScreen').isDisplayed())await button('Close').click();
  if(process.env.SHOPIFY_POS_PREVIEW_URL){
   await browser.execute('mobile: deepLink',{url:process.env.SHOPIFY_POS_PREVIEW_URL});
   if (!await browser.$('~POS Dev Console').isDisplayed()) await browser.$('~POSDevConsoleScreen').click();
   await browser.$('~POS Dev Console').waitForDisplayed({timeout:20000});
   await browser.$('~Component.ActionBar.PrimaryActionButton').click();
  }
  if (!onTargetOrder) {
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
  if(mode==='shipping-enabled')await snapshot('native-before-rejection');
  const action=browser.$('~HotWax Reject, by hc-rails-reassign-fulfillment');await action.waitForDisplayed({timeout:30000});await action.click();
  await browser.waitUntil(async()=>await browser.$('-ios predicate string:visible == 1 AND name IN {"Ready for fulfillment","Fulfillment does not match OMS","OMS unavailable","Unable to load items"}').isDisplayed(),{timeout:65000});
  await snapshot('loaded');
  const choose=async(label:string,reason:string)=>{
   await browser.waitUntil(async()=> (await allButtons(label)).length>0,{timeout:15000,timeoutMsg:'No visible item reason control'});
   const buttons=await allButtons(label);await buttons[0].waitForEnabled({timeout:65000});await buttons[0].click();
   const apply=label.includes('variance')?'Apply variance reason':'Apply reason';await button(apply).waitForDisplayed({timeout:15000});
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
