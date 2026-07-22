import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { argosScreenshot } from '@argos-ci/playwright'
import { test } from '@playwright/test'

import type { Page } from '@playwright/test'

type StoryIndex = {
  entries: Record<string, { id: string; title: string; name: string; type: string }>
}

// The `chromatic` parameters the stories in this repository actually set.
type ChromaticParameters = {
  disable?: boolean
  disableSnapshot?: boolean
  delay?: number
}

const indexPath = fileURLToPath(new URL('../apps/docs/out/storybook/index.json', import.meta.url))
const index: StoryIndex = JSON.parse(readFileSync(indexPath, 'utf-8'))

// `ARGOS_ONLY=core-button--primary,...` narrows a local run to the stories
// being investigated instead of the whole surface.
const only = process.env.ARGOS_ONLY?.split(',').map((id) => id.trim())

const stories = Object.values(index.entries).filter(
  (entry) => entry.type === 'story' && (!only || only.includes(entry.id))
)

// Chromatic renders every snapshot 1200px wide unless a story asks otherwise,
// and no story here sets `chromatic.viewports`.
const WIDTH = 1200
const PROBE_HEIGHT = 800

type StoryRender = {
  id?: string
  phase?: string
  story?: { parameters?: { chromatic?: ChromaticParameters } }
}

type StorybookPreview = {
  currentRender?: StoryRender
  storyRenders?: StoryRender[]
}

declare global {
  interface Window {
    __STORYBOOK_PREVIEW__?: StorybookPreview
  }
}

// Storybook 8 exposes the active render as `currentRender`; 10 replaced it with
// a `storyRenders` array. Reading both keeps this working across an upgrade,
// and matching on the id matters because a previous render can still be
// unmounting alongside the current one.
const waitForRender = (page: Page, storyId: string) =>
  page.waitForFunction((id) => {
    const preview = window.__STORYBOOK_PREVIEW__
    const renders = preview?.storyRenders ?? (preview?.currentRender ? [preview.currentRender] : [])
    const { phase } = renders.find((entry) => entry.id === id) ?? renders[renders.length - 1] ?? {}

    return phase === 'completed' || phase === 'finished'
  }, storyId)

const readChromaticParameters = (page: Page, storyId: string) =>
  page.evaluate((id) => {
    const preview = window.__STORYBOOK_PREVIEW__
    const renders = preview?.storyRenders ?? (preview?.currentRender ? [preview.currentRender] : [])
    const render = renders.find((entry) => entry.id === id) ?? renders[renders.length - 1]

    return render?.story?.parameters?.chromatic ?? null
  }, storyId)

const settle = async (page: Page) => {
  // A rendered phase is not a rendered picture: the story root can still be
  // empty while React commits. An empty DOM is perfectly stable, so the settle
  // loop below would happily agree with itself on a blank page.
  await page.waitForFunction(() => {
    const root = document.querySelector('#storybook-root')

    return !!root && root.getBoundingClientRect().height > 0
  })

  // Montserrat comes from Google Fonts, and text metrics decide the width of
  // buttons, chips and tabs.
  await page.evaluate(() => document.fonts.ready)

  // Fonts change the width of text, not the width of the root, so a
  // ResizeObserver watching the root never fires. Nudge the viewport by a pixel
  // so everything measures once more on the final metrics.
  const viewport = page.viewportSize()

  if (viewport) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height + 1 })
    await page.setViewportSize(viewport)
  }

  // Hold until the markup stops changing. Four identical samples rather than
  // two: a story that mounts a dozen components on a shared CI runner can pause
  // long enough between commits to look settled after one. Inline `transform`
  // values are stripped from the sample because Motion rewrites them on every
  // frame, and a permanently spinning element would otherwise keep this loop
  // going until its cap; movement is handled by the two waits below instead.
  let previousMarkup = ''
  let stableSamples = 0

  for (let i = 0; i < 120 && stableSamples < 4; i += 1) {
    const markup = await page.evaluate(() => document.body.innerHTML.replace(/transform: *[^;"]*/g, ''))

    stableSamples = markup === previousMarkup ? stableSamples + 1 : 0
    previousMarkup = markup
    if (stableSamples < 4) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(250)
    }
  }

  // Settled markup is not a settled picture: an accordion that opens, a drawer
  // that slides, a shimmer that sweeps all move pixels through CSS without ever
  // touching `innerHTML`. Let every animation that has an end reach it, and
  // leave the endless ones alone, since Argos freezes those at capture time.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const { endTime } = animation.effect?.getComputedTiming() ?? {}

      return animation.playState === 'running' && typeof endTime === 'number' && Number.isFinite(endTime)
    })

    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => {
        setTimeout(resolve, 2000)
      }),
    ])
  })

  // The spinners rotate through Motion, which writes an inline `transform` on
  // every frame instead of using the Web Animations API: `getAnimations()`
  // returns nothing for them, they never end, and each capture caught them at a
  // different angle. Elements whose inline transform is still moving after the
  // waits above are pinned to their untransformed state through a stylesheet
  // rule, which Motion's inline writes cannot override.
  await page.evaluate(async () => {
    const sample = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[style*="transform"]')).map(
        (element) => [element, element.style.transform] as const
      )

    let moving = sample()

    for (let pass = 0; pass < 2 && moving.length > 0; pass += 1) {
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 200))
      moving = moving.filter(([element, transform]) => element.style.transform !== transform)
    }

    if (moving.length === 0) return

    moving.forEach(([element]) => element.setAttribute('data-argos-pinned', ''))
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style>[data-argos-pinned]{transform:none !important}</style>'
    )
  })

  // A smooth scroll is not a web animation and never shows up in
  // `getAnimations()`, and it does not touch the markup either. The carousel
  // scrolls itself to its first slide on mount, so hold until every scroll
  // offset has stopped moving. This only observes the offsets, since forcing
  // them would invent a state the story never asked for.
  let previousOffsets = ''
  let stableOffsets = 0

  for (let i = 0; i < 20 && stableOffsets < 2; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const offsets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((element) => element.scrollLeft || element.scrollTop)
        .map((element) => `${element.scrollLeft},${element.scrollTop}`)
        .join('|')
    )

    stableOffsets = offsets === previousOffsets ? stableOffsets + 1 : 0
    previousOffsets = offsets
    if (stableOffsets < 2) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(150)
    }
  }
}

// Crop to the story rather than to a fixed canvas: a row of badges is 90px
// tall, and the tighter frame is both what a reviewer looks at and a fairer
// denominator for the diff. Tooltips, popovers and dialogs render through a
// portal and can sit below the body box, so the height is the furthest bottom
// edge on the page; a story that fills the viewport with a fixed overlay keeps
// the full height instead.
const fitViewportToStory = async (page: Page) => {
  for (let pass = 0; pass < 2; pass += 1) {
    // eslint-disable-next-line no-await-in-loop
    const height = await page.evaluate(() => {
      const elements = Array.from(document.body.querySelectorAll('*'))
      const hasOverlay = elements.some((element) => {
        const box = element.getBoundingClientRect()

        return getComputedStyle(element).position === 'fixed' && box.width > 100 && box.height > 100
      })

      if (hasOverlay) return null

      return elements.reduce((bottom, element) => {
        const box = element.getBoundingClientRect()

        return box.width > 0 && box.height > 0 ? Math.max(bottom, box.bottom) : bottom
      }, document.body.getBoundingClientRect().height)
    })

    if (height === null) return

    const clamped = Math.min(Math.max(Math.ceil(height), 120), 3000)
    const current = page.viewportSize()

    if (current && current.height === clamped) return

    // eslint-disable-next-line no-await-in-loop
    await page.setViewportSize({ width: WIDTH, height: clamped })
    // Re-measure once: a shorter viewport can reflow the story taller.
  }
}

for (const story of stories) {
  test(`${story.title} - ${story.name}`, async ({ page }) => {
    await page.setViewportSize({ width: WIDTH, height: PROBE_HEIGHT })
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`)
    await waitForRender(page, story.id)

    const parameters = (await readChromaticParameters(page, story.id)) as ChromaticParameters | null

    // Both spellings of the opt-out are in circulation; a story that is not
    // snapshotted today is not snapshotted here either.
    test.skip(
      parameters?.disable === true || parameters?.disableSnapshot === true,
      'story opts out of snapshots (chromatic parameter)'
    )

    await settle(page)

    // `CloseButton` asks Chromatic for extra time before it captures. Honour
    // the same delay, after the generic settling rather than instead of it.
    if (parameters?.delay) {
      await page.waitForTimeout(Math.min(parameters.delay, 15_000))
      await settle(page)
    }

    await fitViewportToStory(page)

    // Some stories are a loading state on purpose and stay `aria-busy` for as
    // long as they are mounted. Read that off the DOM instead of guessing from
    // the story name; the markup has already held still above, so anything
    // still busy is the state the story wants.
    const staysBusy = await page.evaluate(() => document.querySelector('[aria-busy="true"]') !== null)

    await argosScreenshot(page, `${story.title} - ${story.name}`, {
      stabilize: { waitForAriaBusy: !staysBusy },
    })
  })
}
