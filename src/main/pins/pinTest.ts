import { screen } from 'electron'
import { generateGradient } from '../../shared/pins/gradient'
import { createPin } from '../../shared/pins/model'
import { PinWindow, type PinOut } from './pinWindows'

/**
 * Test hook (INSTANT_TEST_PIN=1): shows one pin with fixed data so a smoke test can drive it.
 * The real pins are made by the pin manager; this only exists until a test can collapse a window.
 */
export function installTestPin(diameter: () => number): void {
  const area = screen.getPrimaryDisplay().workArea
  const centre = { x: area.x + 300, y: area.y + 300 }
  const events: PinOut[] = []
  const record = createPin(
    { url: 'https://example.com/docs', title: 'Example Docs', window: { x: 100, y: 100, width: 480, height: 640 }, pin: centre, following: false, gradient: generateGradient([], 7) },
    'test-pin-0001', Date.now()
  )
  const pin = new PinWindow(record, centre, {
    diameter,
    armMs: () => Number(process.env.INSTANT_TEST_ARM_MS ?? 2000),
    workAreaFor: (p) => screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea,
    onEvent: (_id, event) => { events.push(event) }
  })
  pin.show()
  ;(globalThis as Record<string, unknown>).__testPin = { pin, events }
}
