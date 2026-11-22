async () => {
  const databases = new Map((await indexedDB.databases()).map(({ name, version }) => [name, version]))
  const open = (name) => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, databases.get(name))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => request.transaction.abort()
  })
  const get = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  let draft
  if (databases.has('calligraphy-studio')) {
    const db = await open('calligraphy-studio')
    try { draft = await get(db.transaction('drafts').objectStore('drafts').get('current')) }
    finally { db.close() }
  }
  if (!databases.has('calligra-private-library')) return { draft, library: null }
  const db = await open('calligra-private-library')
  const stores = ['glyphs', 'scans', 'packs', 'packedGlyphs'].filter((store) => db.objectStoreNames.contains(store))
  try {
    const tx = db.transaction(stores)
    const scanStore = tx.objectStore('scans')
    const [files, keys, glyphs, packs, packedGlyphs] = await Promise.all([
      get(scanStore.getAll()), get(scanStore.getAllKeys()), get(tx.objectStore('glyphs').getAll()),
      stores.includes('packs') ? get(tx.objectStore('packs').getAll()) : [],
      stores.includes('packedGlyphs') ? get(tx.objectStore('packedGlyphs').getAll()) : [],
    ])
    if (files.reduce((sum, file) => sum + file.size, 0) > 142 * 1024 * 1024)
      throw new Error('The original scans alone exceed the 192 MiB migration bundle limit.')
    const scans = []
    for (const [index, file] of files.entries()) {
      const bytes = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1])
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      scans.push({ checksum: keys[index], name: file.name ?? keys[index], type: file.type,
        lastModified: file.lastModified ?? 0, bytes })
    }
    return { draft, library: { kind: 'calligra-private-library', schema_version: 1,
      glyphs, packs, packedGlyphs, scans } }
  } finally {
    db.close()
  }
}
