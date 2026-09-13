from pathlib import Path
p=Path('apex-v2/scout-ui-v5.js');s=p.read_text()
old=" var batch=document.getElementById('asResearchBatch');if(!batch)return;"
assert s.count(old)==1
s=s.replace(old,old+"\n if(loading){batch.disabled=true;batch.textContent='Loading board…';return;}")
old=" document.getElementById('asStatus').textContent=keepBoard?'Refreshing lines…':'Loading lines…';"
assert s.count(old)==1
s=s.replace(old,old+'\n renderBatchControl();')
old="+'<em>'+first+'–'+last+' of '+total+' props</em></span>'"
assert s.count(old)==1
s=s.replace(old,"+'<em>'+first+'–'+last+' of '+total+' players</em></span>'")
p.write_text(s)
p=Path('scripts/qa-multisport-browser.mjs');s=p.read_text()
old="await page.locator('[data-sport=\"NBA\"]').click();await page.waitForFunction(()=>document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');"
new="await page.locator('[data-sport=\"NBA\"]').click();await page.waitForFunction(()=>document.querySelector('#asSubtitle')?.textContent.startsWith('NBA ·')&&document.querySelector('#asResearchBatch')?.textContent==='Visible research loaded');"
assert s.count(old)==1
s=s.replace(old,new)
p.write_text(s)
print('Sport-switch loading status and grouped pagination labels corrected.')
