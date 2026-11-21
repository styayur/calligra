import { candidateCompatible, type CandidatePolicy } from './candidatePolicy'
import type { Glyph } from '../types'

export const PRIVATE_DATASET = '个人字库'

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('calligra-private-library', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('glyphs', { keyPath: 'id' }).createIndex('character', 'character')
      request.result.createObjectStore('scans')
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
