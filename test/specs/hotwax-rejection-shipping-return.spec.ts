import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {browser} from '@wdio/globals';
import {pos} from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';

describe('HotWax rejection native shipping preparation',()=>{
 it('shows only the remaining store item without packing it',async()=>{
  const fixture=JSON.parse(await readFile('/tmp/pos-uat-orders.json','utf8')).find((o:any)=>o.mode==='shipping-enabled');
  if(!fixture)throw new Error('Missing explicitly prepared sandbox shipping fixture');
  const dir=resolve(process.env.RUN_ARTIFACT_DIR!);await mkdir(dir,{recursive:true});
  const snapshot=async(name:string)=>{await writeFile(join(dir,name+'.xml'),await browser.getPageSource());await browser.saveScreenshot(join(dir,name+'.png'));};
  await browser.updateSettings({animationCoolOffTimeout:0,waitForIdleTimeout:0});
  await browser.execute('mobile: activateApp',{bundleId:'com.jadedpixel.pos'});
  if(await browser.$(s.uiExtensionModal).isDisplayed())throw new Error('Rejection is still open; inspect its result before continuing');
  const onTarget=await browser.$(s.detailScreen).isDisplayed() && (await browser.$('~OrderDetailsHeader.Title').getAttribute('label'))===fixture.name;
  if(!onTarget){
   if(await browser.$(s.detailScreen).isDisplayed())await browser.$(s.orderDetailCloseButton).click();
   await pos.openOrdersScreen();await browser.$('~Screen.OrdersScreen.NavListContent.Item.OrdersWorkflow').click();
   const posOnly=browser.$('~Component.Filters.FilterButton.SaleType.Point of Sale');
   if(await posOnly.isDisplayed()){await posOnly.click();await browser.$('~Screen.SingleSelectfiltersScreen.FilterButton.ONLINE').click();}
   await pos.openOrderByReference(fixture.name);
  }
  const prepare=browser.$('~Screen.OrderDetailsScreen.Actions.PrepareForShipping');
  await prepare.waitForDisplayed({timeout:20000});
  const label=await prepare.getAttribute('label');
  await snapshot('returned-shipping-order');
  if(label!=='Prepare for shipping, 1 item')throw new Error('Native preparation count is not the one remaining unit: '+label);
  await prepare.click();
  await snapshot('remaining-items-preparation');
  const remaining=browser.$('-ios predicate string:name CONTAINS "Ana Running Short" AND visible == 1');
  await remaining.waitForDisplayed({timeout:15000});
  if(await browser.$('-ios predicate string:name CONTAINS "Winter Jacket" AND visible == 1').isDisplayed())throw new Error('Rejected jacket still appears in the native preparation screen');
  await writeFile(join(dir,'uat.json'),JSON.stringify({order:fixture.name,onlyRemainingItemVisible:true,packed:false,reopenedOrder:!onTarget}));
 });
});
