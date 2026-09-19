import json, pathlib, urllib.request, urllib.parse
out=pathlib.Path('/tmp/oblige-audit');out.mkdir(exist_ok=True)
checks=[('tennis','Coco Gauff'),('golf','Scottie Scheffler'),('mma','Jon Jones'),('soccer','Erling Haaland'),('esports','Alexis Bernier')]
for family,name in checks:
    urls={'espn':'https://site.web.api.espn.com/apis/search/v2?'+urllib.parse.urlencode({'query':name,'sport':family}),'wikidata':'https://www.wikidata.org/w/api.php?'+urllib.parse.urlencode({'action':'wbsearchentities','search':name,'language':'en','type':'item','limit':10,'format':'json'})}
    for source,url in urls.items():
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'ObligePropsPhotoAudit/1.0 (https://www.obligeprops.com)','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=12) as r:data=json.loads(r.read(1500000))
            (out/(family+'-'+source+'.json')).write_text(json.dumps(data))
            print(json.dumps({'sport':family,'name':name,'source':source,'ok':True,'results':len(data.get('search',data.get('results',[])))}))
            if source=='wikidata':
                ids=[x['id'] for x in data.get('search',[])[:10]]
                if ids:
                    url='https://www.wikidata.org/w/api.php?'+urllib.parse.urlencode({'action':'wbgetentities','ids':'|'.join(ids),'props':'labels|aliases|claims','languages':'en','format':'json'})
                    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'ObligePropsPhotoAudit/1.0 (https://www.obligeprops.com)'}),timeout=12) as r: entities=json.loads(r.read(2000000))
                    (out/(family+'-entities.json')).write_text(json.dumps(entities))
        except Exception as e: print(json.dumps({'sport':family,'source':source,'error':str(e)}))
for sport,name in [('MLB','Aaron Judge'),('TENNIS','Coco Gauff'),('GOLF','Scottie Scheffler')]:
    url='https://www.obligeprops.com/api/apex/player-artwork?'+urllib.parse.urlencode({'sport':sport,'name':name})
    try:
        with urllib.request.urlopen(url,timeout=15) as r: print(json.dumps({'public_artwork':sport,'status':r.status,'verified':r.headers.get('x-artwork-status'),'bytes':len(r.read(3000000))}))
    except Exception as e:print(json.dumps({'public_artwork':sport,'error':str(e)}))
