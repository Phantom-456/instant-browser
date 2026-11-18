import { describe, expect, it } from 'vitest'
import { generateGradient } from '../../src/shared/pins/gradient'
import { createPin, type PinRecord } from '../../src/shared/pins/model'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { bookmarkId, type Bookmark } from '../../src/shared/bookmarks'
import { planApply } from '../../src/shared/sync/apply'
import { MemoryStorage, syncOnce } from '../../src/shared/sync/engine'
import { TOMBSTONE_DAYS, applyLocal, emptyDoc, mergeDocs, parseDoc } from '../../src/shared/sync/merge'
import { PORTABLE_PREF_KEYS, fromSyncPin, portablePrefs, toSyncPin, type SyncPin } from '../../src/shared/sync/portable'

const DAY = 86_400_000
const pinRecord = (id: string, over: Partial<PinRecord> = {}): PinRecord => ({
  ...createPin({ url: `https://example.com/${id}`, title: id, window: { x: 5, y: 6, width: 480, height: 640 }, pin: { x: 99, y: 98 }, following: true, gradient: generateGradient([], 3) }, id, 1000),
  scroll: { x: 0, y: 321 }, snapshotAt: 5, state: 'resident', ...over
})
const sync = (pin: PinRecord): SyncPin => toSyncPin(pin)

describe('what leaves the computer', () => {
  it('a synced pin has no screen position, picture, scroll, state or desktop information', () => {
    const json = JSON.stringify(sync(pinRecord('pin-00000001')))
    for (const word of ['window', '"pin"', 'scroll', 'snapshot', 'state', 'following', 'x":99', 'lastUsedAt', 'restoredAt', 'displayId']) expect(json).not.toContain(word)
    expect(JSON.parse(json)).toMatchObject({ id: 'pin-00000001', url: 'https://example.com/pin-00000001', archived: false })
  })

  it('syncs the colours with the pin, so it looks the same on every computer', () => {
    const p = pinRecord('pin-00000001')
    expect(sync(p).gradient).toEqual(p.gradient)
  })

  it('shares only portable preferences: not the hotkey, folders, browser choice or history switches', () => {
    const keys = Object.keys(portablePrefs(DEFAULT_SETTINGS))
    expect(keys.sort()).toEqual([...PORTABLE_PREF_KEYS].sort())
    for (const never of ['hotkey', 'downloadFolder', 'mainBrowserId', 'diaProfile', 'diaProfiles', 'showHistory', 'historyOff', 'launchAtLogin']) expect(keys).not.toContain(never)
  })

  it('a pin from another computer arrives released, not following, placed by this computer', () => {
    const local = fromSyncPin(sync(pinRecord('pin-00000001')), { x: 400, y: 300 }, 7)
    expect(local).toMatchObject({ state: 'offloaded', following: false, snapshotAt: null, scroll: null, pin: { x: 400, y: 300 } })
  })
})

describe('merging', () => {
  const doc = (device: string, t: number, pin: SyncPin) => applyLocal(emptyDoc(), { pins: [pin], prefs: {}, deleted: [] }, device, t)

  it('the newest change to a pin wins, whichever order the documents are merged in', () => {
    const a = doc('mac', 100, { ...sync(pinRecord('pin-00000001')), label: 'Mac name' })
    const b = doc('pc', 200, { ...sync(pinRecord('pin-00000001')), label: 'PC name' })
    expect(mergeDocs(a, b, 300).pins['pin-00000001']!.pin.label).toBe('PC name')
    expect(mergeDocs(b, a, 300)).toEqual(mergeDocs(a, b, 300))
  })

  it('on the same millisecond a fixed rule decides, the same on both computers', () => {
    const a = doc('a-device', 100, { ...sync(pinRecord('pin-00000001')), label: 'A' })
    const b = doc('b-device', 100, { ...sync(pinRecord('pin-00000001')), label: 'B' })
    expect(mergeDocs(a, b, 200).pins['pin-00000001']!.pin.label).toBe('B')
    expect(mergeDocs(b, a, 200).pins['pin-00000001']!.pin.label).toBe('B')
  })

  it('merging twice changes nothing', () => {
    const a = doc('mac', 100, sync(pinRecord('pin-00000001')))
    const b = doc('pc', 150, sync(pinRecord('pin-00000002')))
    const once = mergeDocs(a, b, 300)
    expect(mergeDocs(once, b, 300)).toEqual(once)
    expect(mergeDocs(once, once, 300)).toEqual(once)
  })

  it('two pins of the same site stay two pins (identity is the id)', () => {
    const a = doc('mac', 100, { ...sync(pinRecord('pin-00000001')), url: 'https://same.site/' })
    const b = doc('pc', 100, { ...sync(pinRecord('pin-00000002')), url: 'https://same.site/' })
    expect(Object.keys(mergeDocs(a, b, 200).pins)).toHaveLength(2)
  })

  it('a deletion stays deleted: the old pin does not come back from a computer that was off', () => {
    const a = doc('mac', 100, sync(pinRecord('pin-00000001')))
    const deleted = applyLocal(a, { pins: [], prefs: {}, deleted: ['pin-00000001'] }, 'mac', 500)
    const merged = mergeDocs(deleted, a, 600) // the other computer still has the old pin
    expect(merged.pins['pin-00000001']).toBeUndefined()
    expect(merged.tombstones['pin-00000001']).toBeDefined()
  })

  it('a change made after the deletion brings the pin back', () => {
    const a = doc('mac', 100, sync(pinRecord('pin-00000001')))
    const deleted = applyLocal(a, { pins: [], prefs: {}, deleted: ['pin-00000001'] }, 'mac', 500)
    const edited = applyLocal(a, { pins: [{ ...sync(pinRecord('pin-00000001')), label: 'New' }], prefs: {}, deleted: [] }, 'pc', 900)
    const merged = mergeDocs(deleted, edited, 1000)
    expect(merged.pins['pin-00000001']!.pin.label).toBe('New')
    expect(merged.tombstones['pin-00000001']).toBeUndefined()
  })

  it('tombstones are forgotten after 90 days', () => {
    const a = applyLocal(emptyDoc(), { pins: [], prefs: {}, deleted: ['pin-00000001'] }, 'mac', 0)
    expect(mergeDocs(a, emptyDoc(), (TOMBSTONE_DAYS - 1) * DAY).tombstones['pin-00000001']).toBeDefined()
    expect(mergeDocs(a, emptyDoc(), (TOMBSTONE_DAYS + 1) * DAY).tombstones['pin-00000001']).toBeUndefined()
  })

  it('preferences merge one by one', () => {
    const a = applyLocal(emptyDoc(), { pins: [], prefs: { pinSize: 22, maxPins: 10 }, deleted: [] }, 'mac', 100)
    const b = applyLocal(emptyDoc(), { pins: [], prefs: { pinSize: 34 }, deleted: [] }, 'pc', 200)
    const m = mergeDocs(a, b, 300)
    expect([m.prefs.pinSize!.value, m.prefs.maxPins!.value]).toEqual([34, 10])
  })

  it('a change that is not a change gets no new time (no sync storms)', () => {
    const a = doc('mac', 100, sync(pinRecord('pin-00000001')))
    const again = applyLocal(a, { pins: [sync(pinRecord('pin-00000001'))], prefs: {}, deleted: [] }, 'pc', 999)
    expect(again.pins['pin-00000001']!.updatedAt).toBe(100)
  })

  it('a document from outside is checked: wrong version, bad entries and unknown keys are dropped', () => {
    expect(parseDoc({ version: 99, pins: {} })).toEqual(emptyDoc())
    const good = doc('mac', 100, sync(pinRecord('pin-00000001')))
    const dirty = { ...good, pins: { ...good.pins, 'pin-00000002': { updatedAt: 'x' }, evil: { updatedAt: 1, device: 'x', pin: { id: 'other', url: 'u' } } }, prefs: { hotkey: { updatedAt: 1, device: 'x', value: 'Cmd+Q' } } }
    const parsed = parseDoc(dirty)
    expect(Object.keys(parsed.pins)).toEqual(['pin-00000001'])
    expect(Object.keys(parsed.prefs)).toEqual([])
  })
})

describe('syncing through a store', () => {
  const changes = (pins: SyncPin[], deleted: string[] = []) => ({ pins, prefs: {}, deleted })

  it('two computers end up with the same pins', async () => {
    const store = new MemoryStorage()
    const a = await syncOnce(store, changes([sync(pinRecord('pin-00000001'))]), 'mac', 100)
    const b = await syncOnce(store, changes([sync(pinRecord('pin-00000002'))]), 'pc', 200)
    const a2 = await syncOnce(store, changes([]), 'mac', 300)
    expect(a.ok && b.ok && a2.ok).toBe(true)
    if (b.ok && a2.ok) expect(Object.keys(a2.doc.pins).sort()).toEqual(Object.keys(b.doc.pins).sort())
    if (a2.ok) expect(Object.keys(a2.doc.pins)).toHaveLength(2)
  })

  it('offline is not an error: nothing is lost, and the same changes go through later', async () => {
    const store = new MemoryStorage()
    store.online = false
    const mine = changes([sync(pinRecord('pin-00000001'))])
    const first = await syncOnce(store, mine, 'mac', 100)
    expect(first).toMatchObject({ ok: false, reason: 'offline' })
    store.online = true
    const later = await syncOnce(store, mine, 'mac', 5000)
    expect(later.ok).toBe(true)
  })

  it('if another computer writes at the same moment, it reads again and merges, and loses nothing', async () => {
    const store = new MemoryStorage()
    await syncOnce(store, changes([sync(pinRecord('pin-00000001'))]), 'mac', 100)
    // The PC writes after the Mac has read and merged, but before the Mac writes.
    store.beforeWrite = () => store.injectWrite(applyLocal(parseDoc(store.peek()), changes([sync(pinRecord('pin-00000003'))]), 'pc', 150))
    const result = await syncOnce(store, changes([sync(pinRecord('pin-00000002'))]), 'mac', 200)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.attempts).toBe(2) // the first write found the file changed
      expect(Object.keys(result.doc.pins).sort()).toEqual(['pin-00000001', 'pin-00000002', 'pin-00000003'])
    }
    const final = await syncOnce(store, changes([]), 'pc', 300)
    if (final.ok) expect(Object.keys(final.doc.pins).sort()).toEqual(['pin-00000001', 'pin-00000002', 'pin-00000003'])
  })

  it('gives up after a number of conflicts instead of looping for ever', async () => {
    const store = new MemoryStorage()
    await syncOnce(store, changes([sync(pinRecord('pin-00000001'))]), 'mac', 100)
    let n = 0
    store.write = async () => { n++; return false }
    const result = await syncOnce(store, changes([sync(pinRecord('pin-00000002'))]), 'pc', 200, 3)
    expect(result).toEqual({ ok: false, reason: 'conflict-limit' })
    expect(n).toBe(3)
  })

  it('does not write when there is nothing new (so computers do not write all the time)', async () => {
    const store = new MemoryStorage()
    await syncOnce(store, changes([sync(pinRecord('pin-00000001'))]), 'mac', 100)
    let writes = 0
    const write = store.write.bind(store)
    store.write = async (doc, etag) => { writes++; return write(doc, etag) }
    const again = await syncOnce(store, changes([sync(pinRecord('pin-00000001'))]), 'mac', 900)
    expect(again.ok).toBe(true)
    expect(writes).toBe(0)
  })

  it('a pin deleted for good on one computer is gone from the other, and does not return', async () => {
    const store = new MemoryStorage()
    await syncOnce(store, changes([sync(pinRecord('pin-00000001'))]), 'mac', 100)
    await syncOnce(store, changes([], ['pin-00000001']), 'pc', 500)
    const old = await syncOnce(store, changes([sync(pinRecord('pin-00000001'))]), 'mac', 400) // the Mac still has it, with an older time
    expect(old.ok && old.doc.pins['pin-00000001']).toBeFalsy()
  })
})

describe('bookmarks, history and open pages in the shared file', () => {
  const bm = (url: string, title = 'T') => ({ id: bookmarkId(url), url, title, createdAt: 1 })
  const changes = (extra: object = {}) => ({ pins: [], prefs: {}, deleted: [], ...extra })

  it('bookmarking the same page on two computers gives ONE bookmark', () => {
    const a = applyLocal(emptyDoc(), changes({ bookmarks: [bm('https://example.com/a', 'From the Mac')] }), 'mac', 100)
    const b = applyLocal(emptyDoc(), changes({ bookmarks: [bm('https://example.com/a', 'From the PC')] }), 'pc', 200)
    const merged = mergeDocs(a, b, 300)
    expect(Object.keys(merged.bookmarks)).toEqual([bookmarkId('https://example.com/a')])
    expect(Object.values(merged.bookmarks)[0]!.bookmark.title).toBe('From the PC') // the newest change wins
  })

  it('a deleted bookmark stays deleted, and comes back if it is bookmarked again later', () => {
    const id = bookmarkId('https://example.com/a')
    const a = applyLocal(emptyDoc(), changes({ bookmarks: [bm('https://example.com/a')] }), 'mac', 100)
    const gone = applyLocal(a, changes({ deleted: [id] }), 'pc', 500)
    expect(mergeDocs(gone, a, 600).bookmarks[id]).toBeUndefined()
    const again = applyLocal(a, changes({ bookmarks: [bm('https://example.com/a', 'Again')] }), 'mac', 900)
    expect(mergeDocs(gone, again, 1000).bookmarks[id]!.bookmark.title).toBe('Again')
  })

  it('history is merged by address: the newest visit and the highest count', () => {
    const a = applyLocal(emptyDoc(), changes({ history: [{ url: 'https://x.com/', visits: 3, lastVisit: 100 }] }), 'mac', 100)
    const b = applyLocal(emptyDoc(), changes({ history: [{ url: 'https://x.com/', visits: 2, lastVisit: 500 }, { url: 'https://y.com/', visits: 1, lastVisit: 50 }] }), 'pc', 200)
    const merged = mergeDocs(a, b, 300)
    expect(merged.history['https://x.com/']).toEqual({ url: 'https://x.com/', visits: 3, lastVisit: 500 })
    expect(Object.keys(merged.history).sort()).toEqual(['https://x.com/', 'https://y.com/'])
  })

  it('cleared history does not come back from a computer that was off', () => {
    const old = applyLocal(emptyDoc(), changes({ history: [{ url: 'https://old.com/', visits: 1, lastVisit: 100 }] }), 'mac', 100)
    const cleared = applyLocal(old, changes({ historyClearedAt: 1000 }), 'pc', 1000)
    expect(cleared.history).toEqual({})
    const merged = mergeDocs(cleared, old, 2000) // the Mac still has the old visit
    expect(merged.history).toEqual({})
    const later = applyLocal(merged, changes({ history: [{ url: 'https://new.com/', visits: 1, lastVisit: 1500 }] }), 'mac', 1500)
    expect(Object.keys(later.history)).toEqual(['https://new.com/']) // new visits after the clear are kept
  })

  it('keeps only the newest 500 history items', () => {
    const items = Array.from({ length: 700 }, (_, i) => ({ url: `https://site${i}.com/`, visits: 1, lastVisit: 1000 + i }))
    const merged = mergeDocs(applyLocal(emptyDoc(), changes({ history: items }), 'mac', 5000), emptyDoc(), 6000)
    expect(Object.keys(merged.history)).toHaveLength(500)
    expect(merged.history['https://site699.com/']).toBeDefined()
    expect(merged.history['https://site0.com/']).toBeUndefined()
  })

  it('each computer writes only its own open pages; turning it off removes them; a computer not seen for 60 days is forgotten', () => {
    const tabs = [{ url: 'https://example.com/x', title: 'X', kind: 'window' as const }]
    const withMac = applyLocal(emptyDoc(), changes({ deviceInfo: { name: 'Work Mac', tabs } }), 'mac', 1000)
    const withBoth = applyLocal(withMac, changes({ deviceInfo: { name: 'Home PC', tabs: [] } }), 'pc', 2000)
    expect(Object.keys(withBoth.devices).sort()).toEqual(['mac', 'pc'])
    expect(applyLocal(withBoth, changes({ deviceInfo: null }), 'mac', 3000).devices.mac).toBeUndefined()
    expect(applyLocal(withBoth, changes({}), 'mac', 3000).devices.mac).toBeDefined() // not touched when the field is left out
    const DAY = 86_400_000
    expect(mergeDocs(withMac, emptyDoc(), 1000 + 61 * DAY).devices).toEqual({})
  })

  it('a document with bad bookmarks, history or devices is cleaned when read', () => {
    const doc = parseDoc({
      version: 1, pins: {}, prefs: {}, tombstones: {},
      bookmarks: { wrong: { updatedAt: 1, device: 'x', bookmark: { id: 'other', url: 'https://a.com/' } }, ok: { updatedAt: 1, device: 'x', bookmark: { id: 'ok', url: 'javascript:alert(1)' } } },
      history: { 'file:///etc/passwd': { url: 'file:///etc/passwd', visits: 1, lastVisit: 1 }, 'https://fine.com/': { url: 'https://fine.com/', visits: 2, lastVisit: 9 } },
      devices: { d1: { updatedAt: 1, name: 'PC', tabs: [{ url: 'https://ok.com/', title: 'ok', kind: 'pin' }, { url: 'javascript:1', title: 'bad', kind: 'window' }] } }
    })
    expect(doc.bookmarks).toEqual({})
    expect(Object.keys(doc.history)).toEqual(['https://fine.com/'])
    expect(doc.devices.d1!.tabs).toEqual([{ url: 'https://ok.com/', title: 'ok', kind: 'pin' }])
  })

  it('the plan says what to add, update and remove for bookmarks, and lists the other computers', () => {
    const id = bookmarkId('https://example.com/a')
    const doc = applyLocal(emptyDoc(), changes({ bookmarks: [bm('https://example.com/a', 'Renamed')], deviceInfo: { name: 'PC', tabs: [] } }), 'pc', 100)
    const local: Bookmark[] = [{ id, url: 'https://example.com/a', title: 'Old title', createdAt: 1 }]
    const plan = planApply(doc, [], 'mac', local)
    expect(plan.bookmarks.update.map((b) => b.title)).toEqual(['Renamed'])
    expect(plan.devices.map((d) => d.name)).toEqual(['PC'])
    expect(planApply(doc, [], 'mac', []).bookmarks.add.map((b) => b.id)).toEqual([id])
    const deleted = applyLocal(doc, changes({ deleted: [id] }), 'pc', 500)
    expect(planApply(deleted, [], 'mac', local).bookmarks.remove).toEqual([id])
    expect(planApply(doc, [], 'pc').devices).toEqual([]) // a computer does not list itself
  })
})
