import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

export function releaseMetadata(): Plugin {
  return {
    name:'release-metadata',
    generateBundle() {
      const root=resolve(process.cwd(),'../..')
      const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
      const hash=(file:string)=>createHash('sha256').update(readFileSync(resolve(root,file),'utf8').replace(/\r\n/g,'\n')).digest('hex')
      const pkg=JSON.parse(readFileSync('package.json','utf8'))
      const epoch=process.env.SOURCE_DATE_EPOCH || git('show','-s','--format=%ct','HEAD')
      const metadata={schema_version:1,version:pkg.version,commit:git('rev-parse','HEAD'),
        working_tree_dirty:!!git('status','--porcelain'),build_timestamp:new Date(Number(epoch)*1000).toISOString(),timestamp_source:process.env.SOURCE_DATE_EPOCH?'SOURCE_DATE_EPOCH':'commit timestamp',
        node_version:process.version,locks:{web:hash('apps/web/package-lock.json'),desktop:hash('apps/desktop/package-lock.json'),python:hash('apps/api/requirements.txt'),android:hash('apps/web/android/app/gradle.lockfile')},
        asset_manifest_sha256:hash('samples/asset-manifest.json'),third_party_manifest_sha256:hash('third_party/manifest.json')}
      this.emitFile({type:'asset',fileName:'build-meta.json',source:JSON.stringify(metadata,null,2)+'\n'})
      const identities=new Map<string,{name:string,version:string}>()
      for(const id of this.getModuleIds()) {
        const clean=id.replace(/\\/g,'/').replace(/^\0/,'')
        const start=clean.lastIndexOf('node_modules/')
        if(start<0) continue
        const relative=clean.slice(start+'node_modules/'.length)
        const name=relative.match(/^((?:@[^/]+\/)?[^/]+)/)?.[1]
        if(!name) throw new Error('Cannot identify bundled dependency')
        const directory=clean.slice(0,start+'node_modules/'.length)+name
        const dependency=JSON.parse(readFileSync(resolve(directory,'package.json'),'utf8'))
        if(dependency.name!==name || !dependency.version) throw new Error('Bundled dependency identity differs from installed package')
        identities.set(`npm:${name}@${dependency.version}`,{name,version:dependency.version})
      }
      const packages=[...new Set([...identities.values()].map(c=>c.name))].sort()
      const tooling=['braces','chokidar','fast-glob','micromatch','tailwindcss']
      if(packages.some(name=>tooling.includes(name))) throw new Error('Vulnerable development tooling must not enter the renderer bundle')
      const notices=JSON.parse(readFileSync(resolve(root,'third_party/manifest.json'),'utf8'))
      if([...identities.keys()].some(id=>!notices.components.some((c:{id:string})=>c.id===id))) throw new Error('Bundled dependency version lacks canonical licence notice')
      this.emitFile({type:'asset',fileName:'build-modules.json',source:JSON.stringify({schema_version:1,packages,package_versions:[...identities.values()],excluded_development_tools:tooling},null,2)+'\n'})
    },
  }
}
