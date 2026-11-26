// Icons are from Phosphor (regular weight). They are bundled into the page, nothing loads from the network.
import arrowLeft from '@phosphor-icons/core/assets/regular/arrow-left.svg?raw'
import arrowRight from '@phosphor-icons/core/assets/regular/arrow-right.svg?raw'
import arrowClockwise from '@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw'
import x from '@phosphor-icons/core/assets/regular/x.svg?raw'
import browsers from '@phosphor-icons/core/assets/regular/browsers.svg?raw'
import arrowSquareOut from '@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw'
import dotsThree from '@phosphor-icons/core/assets/regular/dots-three.svg?raw'
import lockSimple from '@phosphor-icons/core/assets/regular/lock-simple.svg?raw'
import magnifyingGlass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw'
import gearSix from '@phosphor-icons/core/assets/regular/gear-six.svg?raw'
import paintBrush from '@phosphor-icons/core/assets/regular/paint-brush.svg?raw'
import shieldCheck from '@phosphor-icons/core/assets/regular/shield-check.svg?raw'
import downloadSimple from '@phosphor-icons/core/assets/regular/download-simple.svg?raw'
import info from '@phosphor-icons/core/assets/regular/info.svg?raw'
import clockCounterClockwise from '@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw'
import globe from '@phosphor-icons/core/assets/regular/globe.svg?raw'
import circleNotch from '@phosphor-icons/core/assets/regular/circle-notch.svg?raw'
import pushPin from '@phosphor-icons/core/assets/regular/push-pin.svg?raw'
import moon from '@phosphor-icons/core/assets/regular/moon.svg?raw'
import squaresFour from '@phosphor-icons/core/assets/regular/squares-four.svg?raw'

export const ICONS: Record<string, string> = {
  back: arrowLeft,
  forward: arrowRight,
  reload: arrowClockwise,
  stop: x,
  close: x,
  collapse: pushPin,
  follow: browsers,
  send: arrowSquareOut,
  more: dotsThree,
  lock: lockSimple,
  search: magnifyingGlass,
  general: gearSix,
  appearance: paintBrush,
  privacy: shieldCheck,
  downloads: downloadSimple,
  about: info,
  permissions: squaresFour,
  spinner: circleNotch,
  offload: moon,
  manager: squaresFour,
  history: clockCounterClockwise,
  globe
}

/** Put the icon named in each `data-icon` attribute inside that element. */
export function mountIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((element) => {
    element.innerHTML = ICONS[element.dataset.icon ?? ''] ?? ''
  })
}
