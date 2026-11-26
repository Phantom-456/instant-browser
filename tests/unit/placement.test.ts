import { expect, test } from 'vitest'
import { placeNear } from '../../src/shared/placement'

const area = { x: 0, y: 25, width: 1440, height: 875 }
const size = { width: 480, height: 640 }

test('window is centred under the cursor when there is room', () => {
  expect(placeNear({ x: 700, y: 200 }, size, area)).toEqual({ x: 460, y: 160, width: 480, height: 640 })
})
test('window is pushed back inside the screen', () => {
  expect(placeNear({ x: 1430, y: 880 }, size, area)).toEqual({ x: 960, y: 260, width: 480, height: 640 })
  expect(placeNear({ x: 5, y: 26 }, size, area)).toEqual({ x: 0, y: 25, width: 480, height: 640 })
})
test('window is made smaller on a small screen', () => {
  const small = { x: 0, y: 0, width: 400, height: 300 }
  expect(placeNear({ x: 100, y: 100 }, size, small)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
})
test('second display with an offset origin', () => {
  const second = { x: 1440, y: 0, width: 1920, height: 1080 }
  expect(placeNear({ x: 1450, y: 500 }, size, second)).toEqual({ x: 1440, y: 440, width: 480, height: 640 })
})
