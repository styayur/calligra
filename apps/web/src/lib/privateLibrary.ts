import { candidateCompatible, type CandidatePolicy } from './candidatePolicy'
import type { Glyph } from '../types'
import type { GlyphPack, PackedGlyph } from './glyphPacks'

export const PRIVATE_DATASET = '个人字库'

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('calligra-private-library', 2)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (event.oldVersion < 1) {
        db.createObjectStore('glyphs', { keyPath: 'id' }).createIndex('character', 'character')
        db.createObjectStore('scans')
      }
      if (event.oldVersion < 2) {
        db.createObjectStore('packs', { keyPath: 'id' })
        const packed = db.createObjectStore('packedGlyphs', { keyPath: 'id' })
        packed.createIndex('character', 'character')
        packed.createIndex('packId', 'packId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function read<T>(store: string, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openLibrary()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = operation(db.transaction(store).objectStore(store))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export function privateGlyphs(character?: string, policy: CandidatePolicy = {}) {
  const items = read<Glyph[]>('glyphs', (store) =>
    character ? store.index('character').getAll(character) : store.getAll(),
  )
  return items.then((glyphs) => glyphs.filter((glyph) => candidateCompatible(glyph, policy)))
}

export function originalScan(checksum: string) {
  return read<Blob | undefined>('scans', (store) => store.get(checksum))
}

export async function savePrivateGlyphs(scan: File, checksum: string, glyphs: Glyph[]) {
  const db = await openLibrary()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['glyphs', 'scans'], 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('个人字库写入失败'))
      transaction.objectStore('scans').put(scan, checksum)
      const library = transaction.objectStore('glyphs')
      for (const glyph of glyphs) library.put(glyph)
    })
  } finally {
    db.close()
  }
}

export async function deletePrivateGlyph(id: string) {
  const db = await openLibrary()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['glyphs', 'scans'], 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      const glyphs = transaction.objectStore('glyphs')
      const request = glyphs.get(id)
      request.onsuccess = () => {
        const checksum = (request.result as Glyph | undefined)?.source.source_checksum
        glyphs.delete(id)
        if (!checksum) return
        const cursor = glyphs.openCursor()
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) transaction.objectStore('scans').delete(checksum)
          else if ((current.value as Glyph).source.source_checksum !== checksum) current.continue()
        }
      }
    })
  } finally {
    db.close()
  }
}

export function installedPacks() {
  return read<GlyphPack[]>('packs', (store) => store.getAll())
}

async function packTransaction<T>(mode: IDBTransactionMode, run: (
  packs: IDBObjectStore, glyphs: IDBObjectStore, finish: (result: T) => void, fail: (error: Error) => void,
) => void): Promise<T> {
  const db = await openLibrary()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['packs', 'packedGlyphs'], mode)
      let result: T
      let failure: Error | undefined
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('字库事务失败'))
      run(tx.objectStore('packs'), tx.objectStore('packedGlyphs'), (value) => { result = value }, (error) => {
        failure = error
        tx.abort()
      })
    })
  } finally {
    db.close()
  }
}

export function packedGlyphs(character?: string, policy: CandidatePolicy = {}) {
  return packTransaction<Glyph[]>('readonly', (packs, glyphs, finish) => {
    const request = packs.getAll()
    request.onsuccess = () => {
      const enabled = new Set((request.result as GlyphPack[]).filter((pack) => pack.enabled).map((pack) => pack.id))
      if (!enabled.size) { finish([]); return }
      const items = character ? glyphs.index('character').getAll(character) : glyphs.getAll()
      items.onsuccess = () => finish((items.result as PackedGlyph[]).filter((glyph) =>
        enabled.has(glyph.packId) && candidateCompatible(glyph, policy)))
    }
  })
}

export function installGlyphPack(pack: GlyphPack, records: PackedGlyph[]) {
  return packTransaction<number>('readwrite', (packs, glyphs, finish, fail) => {
    const request = packs.get(pack.id)
    request.onsuccess = () => {
      const previous = request.result as GlyphPack | undefined
      if (previous && (previous.version !== pack.version || previous.name !== pack.name || previous.source !== pack.source)) {
        fail(new Error('此字库已安装不同版本或来源，请先卸载'))
        return
      }
      const names = packs.getAll()
      names.onsuccess = () => {
        if (pack.name === PRIVATE_DATASET || (names.result as GlyphPack[]).some((item) => item.id !== pack.id && item.name === pack.name)) {
          fail(new Error('字库名称已使用'))
          return
        }
        for (const glyph of records) glyphs.put(glyph)
        const count = glyphs.index('packId').count(pack.id)
        count.onsuccess = () => {
          packs.put({ ...pack, enabled: previous?.enabled ?? true, count: count.result })
          finish(count.result)
        }
      }
    }
  })
}

export function enableGlyphPack(id: string, enabled: boolean) {
  return packTransaction<void>('readwrite', (packs, _, finish, fail) => {
    const request = packs.get(id)
    request.onsuccess = () => {
      if (!request.result) { fail(new Error('字库已卸载')); return }
      packs.put({ ...request.result, enabled })
      finish(undefined)
    }
  })
}

export function removeGlyphPack(id: string) {
  return packTransaction<void>('readwrite', (packs, glyphs, finish) => {
    packs.delete(id)
    const request = glyphs.index('packId').openCursor(id)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { finish(undefined); return }
      cursor.delete()
      cursor.continue()
    }
  })
}
