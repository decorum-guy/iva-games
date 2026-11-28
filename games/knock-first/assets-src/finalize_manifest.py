#!/usr/bin/env python3
"""Record actual bytes, provenance and delivery locations for every game asset."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'public'/'knock-first'
REPO='https://github.com/decorum-guy/iva-games/blob/codex/knock-first-astra-3d-20261128/games/knock-first/'


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    cover_source=ROOT.parent.parent/'.qa'/'knock-first'/'assets'/'cover-source.png'
    if cover_source.is_file():
        from PIL import Image
        with Image.open(cover_source)as image:
            image.save(OUT/'cover.webp',format='WEBP',quality=90,method=6)
    fonts={entry['file']:entry for entry in json.loads((OUT/'fonts'/'font-sources.json').read_text())}
    models=json.loads((OUT/'models'/'model-contract.json').read_text())
    audio=json.loads((OUT/'audio'/'manifest.json').read_text())
    audio_files={item['file']:item for item in audio['files']}
    files=[]
    for path in sorted(OUT.rglob('*')):
        if not path.is_file()or path.name=='assets-manifest.json':continue
        relative=path.relative_to(OUT).as_posix()
        source='assets-src/generate_media.py'
        if path.suffix=='.glb'or path.name=='model-contract.json':source='assets-src/generate_models.py'
        if relative.startswith('textures/') and any(path.name.startswith(k+'-') for k in ('concrete','metal','floor','archive','glove-leather','glove-fabric')) and '-atlas' not in path.name:source='assets-src/generate_surfaces.py'
        if relative=='cover.webp':source='assets-src/generate_models.py'
        entry={'id':relative.rsplit('.',1)[0].replace('/','.'),'file':'public/knock-first/'+relative,'url':'/knock-first/'+relative,
               'bytes':path.stat().st_size,'sha256':digest(path),'author':'Iva Games, original procedural production with AI assistance',
               'license':'Original-project-asset','licenseVersion':'1','sourceFile':source,'sourceUrl':REPO+source,
               'sourceSha256':digest(ROOT/source),'changes':'Created for this game; no imported mesh, image, recording or motion capture.'}
        if path.name in fonts:
            item=fonts[path.name]
            entry.update({'author':'IBM Corp.'if item['family']=='IBM Plex Mono'else 'ParaType Ltd.',
                          'license':'SIL Open Font License','licenseVersion':'1.1','sourceUrl':item['sourceUrl'],
                          'sourceFile':item['sourceFile'],'sourceSha256':digest(ROOT/item['sourceFile']),
                          'fontVersion':item['version'],'licenseFile':'public/knock-first/fonts/'+item['licenseFile'],
                          'changes':item['modification']})
        elif path.name in ('ibmplexmono-OFL.txt','ptsans-OFL.txt'):
            family=path.name.removesuffix('-OFL.txt')
            entry.update({'author':'IBM Corp.'if family=='ibmplexmono'else 'ParaType Ltd.',
                          'license':'SIL Open Font License','licenseVersion':'1.1',
                          'sourceUrl':f'https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/OFL.txt',
                          'sourceFile':None,'sourceSha256':digest(path),'changes':'Unmodified upstream license notice.'})
        if path.suffix=='.glb':
            item=models[path.stem]
            entry.update({key:item[key]for key in ('triangles','meshPrimitives','dimensionsXYZ','bodyDimensionsXYZ','collision','animations','skinCount','anchors')})
        if path.name=='arms.glb':
            entry.update({'author':'MakeHuman community (CC0 anatomical data); Iva Games (derived gloves, sleeves, rig and animation)',
                          'license':'CC0-1.0 anatomical foundation; Original-project-asset additions','licenseVersion':'1.0',
                          'sourceFile':'assets-src/anatomical_glove.py','sourceSha256':digest(ROOT/'assets-src/anatomical_glove.py'),
                          'sourceUrl':'https://github.com/makehumancommunity/makehuman/tree/a8bc2d54ff0ac92e78ff71431b1023eda42bf482',
                          'licenseFile':'assets-src/vendor/makehuman/LICENSE.ASSETS.md',
                          'changes':'Derived from pinned base.obj and default_weights.mhw CC0 data: extracted continuous hand, mirrored, glove surface and seams, remapped skin weights, original sleeves and animation. See vendor/makehuman/SOURCE.md.'})
        if path.name in audio_files:
            item=audio_files[path.name]
            entry.update({key:item[key]for key in ('sampleRate','channels','durationSeconds','samplePeakDbfs','rmsDbfs')})
        files.append(entry)
    manifest={'version':'knock-first-assets@1','units':'metres','upAxis':'+Y','forwardAxis':'-Z',
              'assetCount':len(files),'totalBytes':sum(item['bytes']for item in files),'files':files,
              'originalAssetLicense':{'identifier':'Original-project-asset','meaning':'Created within the commissioned Iva Games implementation; no third-party source work is incorporated. This entry records provenance and does not impose a new public license on the owner’s project.'},
              'candidateReview':[
                  {'url':'https://quaternius.com/packs/modularscifimegakit.html','author':'Quaternius','license':'CC0 1.0','imported':False,'decision':'Grid-based sci-fi kit reviewed as a candidate. The archive requires exact metric handles, a10m lift with multiple exits, bespoke material families and original character silhouettes; matching assets were authored for this implementation.'},
                  {'url':'https://docs.ambientcg.com/license/','author':'ambientCG','license':'CC0 1.0','imported':False,'decision':'License verified. A compact shared procedural atlas was made to avoid bringing large unrelated scan sets into the first interactive scene.'},
                  {'url':'https://polyhaven.com/license','author':'Poly Haven','license':'CC0 1.0','imported':False,'decision':'License verified. The required close-range archive surfaces and game-controlled darkness were authored procedurally.'}],
              'validation':{'structuralCheck':'assets-src/validate_assets.py','listening':'Synthesis and PCM measurements do not constitute listening. Device listening must be recorded in the game acceptance log.',
                            'visualReview':'Blender import renders are local asset inspection. Browser integration and target-device frame time are separate acceptance results.'}}
    data=json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'
    (ROOT/'assets-manifest.json').write_text(data,encoding='utf-8')
    (OUT/'assets-manifest.json').write_text(data,encoding='utf-8')
    print(json.dumps({'assets':manifest['assetCount'],'totalBytes':manifest['totalBytes'],'sha256':digest(ROOT/'assets-manifest.json')},indent=2))


if __name__=='__main__':main()
