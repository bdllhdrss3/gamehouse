import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createGame, localPlayers } from '../../shared/game';

declare global {
  interface Window { __testAudio?: { contexts: AudioContext[]; voices: number } }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('little-table-settings-v1')) localStorage.setItem('little-table-settings-v1', JSON.stringify({ name: 'Maple Bunny', avatar: 'bunny', piece: 'king', theme: 'system', muted: false, volume: .45, reduced: false, haptics: false, boardTheme: 'meadow' }));
  });
});

test('new players choose their name before local play or joining a room', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: /THE FRIENDLY RIVALRY/ }).click();
    const nickname = page.getByRole('textbox', { name: 'Your nickname', exact: true });
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
    await expect(nickname).toHaveValue('');
    await expect(nickname).toBeFocused();
    await expect(page.getByRole('button', { name: 'Let’s play' })).toBeDisabled();
    await nickname.fill('   ');
    await expect(page.getByRole('button', { name: 'Let’s play' })).toBeDisabled();
    await nickname.fill('Sam');
    await page.getByRole('button', { name: 'Let’s play' }).click();
    await expect(page.locator('.match-player.current')).toContainText('Sam');
    await expect(page.locator('.roll-dice')).toHaveClass(/mine/);
    await expect(page.locator('.turn-banner, .turn-splash')).toHaveCount(0);
    const guest = await context.newPage();
    await guest.goto('/?room=ABCD23');
    await expect(guest.getByRole('textbox', { name: 'Your nickname', exact: true })).toHaveValue('Sam');
    await guest.getByRole('textbox', { name: 'Your nickname', exact: true }).fill('');
    await expect(guest.getByRole('button', { name: 'Join the table' })).toBeDisabled();
    await guest.getByRole('button', { name: 'Suggest a new nickname' }).click();
    await expect(guest.getByRole('button', { name: 'Join the table' })).toBeEnabled();
  } finally { await context.close(); }
});

for (const motion of ['reduce', 'no-preference'] as const) {
test(`Ludo celebrates the named winner without blocking the board and supports rematch (${motion})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: motion });
  const players = localPlayers(2, false, 'Maple Bunny');
  players[1].name = 'AlexandertheChampion';
  const game = createGame('ludo', players, 'winning-ludo-test');
  game.turn = 1;
  game.phase = 'move';
  game.dice = 1;
  game.positions[1] = [56, 56, 56, 55];
  await page.addInitScript(snapshot => localStorage.setItem('little-table-match-v1', JSON.stringify(snapshot)), game);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: /Pick up your Ludo game/ }).click();
  await expect(page.locator('.board-callout')).toContainText('Finish it!');
  await expect(page.locator('.roll-dice')).toContainText('Finish it!');
  await page.getByRole('button', { name: /Move Token 4/ }).click();
  await expect(page.locator('.board-callout.ko')).toContainText('K.O.!');
  await expect(page.locator('.winner-result')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'AlexandertheChampion wins!' })).toBeVisible();
  await expect(page.locator('.board-callout')).toHaveCount(0);
  await expect(page.locator('.winner-result')).toContainText('All four pieces home. Beautifully played.');
  await expect(page.locator('.game-board')).toBeVisible();
  await expect(page.locator('.turn-splash, .roll-dice')).toHaveCount(0);
  if (motion === 'no-preference') {
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0, { timeout: 10000 });
  } else await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 640 : 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 768) expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: `test-results/ludo-winner-${motion}-${width}.png`, fullPage: true });
  }
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page.locator('.winner-result')).toHaveCount(0);
  await expect(page.locator('.match-player.current')).toContainText('Maple Bunny');
  await expect(page.locator('.roll-dice')).toHaveClass(/mine/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('little-table-match-v1')!));
  expect(saved.id).not.toBe(game.id);
  expect(saved.players[1].name).toBe('AlexandertheChampion');
  const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('little-table-history-v1')!));
  expect(recent[0]).toMatchObject({ id: game.id, preset: 'ludo', winner: 'AlexandertheChampion' });
});
}

test('finish cue waits for the exact roll and mobile matches fit without scrolling', async ({ page }) => {
  const players = localPlayers(4, false, 'Maple Bunny').map((p, i) => i ? { ...p, name: `Longname Player ${i}` } : p);
  const roll = createGame('ludo', players, 'mobile-roll');
  const move = { ...createGame('ludo', players, 'mobile-move'), phase: 'move' as const, dice: 6, positions: [[-1, 10, 20, 30], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] };
  const close = { ...createGame('ludo', players, 'mobile-close'), phase: 'move' as const, dice: 3, positions: [[56, 56, 56, 50], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] };
  await page.goto('/');
  for (const state of [roll, move, close]) {
    await page.evaluate(s => localStorage.setItem('little-table-match-v1', JSON.stringify(s)), state);
    for (const [width, height] of [[320, 568], [360, 640], [375, 667], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.getByRole('button', { name: /Pick up your Ludo game/ }).click();
      await expect(page.locator('.game-board')).toBeVisible();
      if (state === close) await expect(page.locator('.board-callout')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), `${state.id} ${width}x${height}`).toBe(true);
      const fab = (await page.locator('.roll-dice').boundingBox())!;
      expect(fab.x + fab.width).toBeLessThanOrEqual(width - 12);
      expect(fab.y + fab.height).toBeLessThanOrEqual(height - 12);
      for (const box of await Promise.all((await page.locator('.board-wrap .game-board, .match-player, .token-button, .match-log').all()).map(l => l.boundingBox()))) {
        if (!box) continue;
        const overlaps = box.x < fab.x + fab.width && fab.x < box.x + box.width && box.y < fab.y + fab.height && fab.y < box.y + box.height;
        expect(overlaps, `${state.id} ${width}x${height}`).toBe(false);
      }
      expect((await page.locator('.board-wrap .game-board').boundingBox())!.height).toBeGreaterThan(200);
    }
  }
  await page.screenshot({ path: 'test-results/mobile-match-375.png' });
});

test('profile avatar, suggested names, themes and mobile local game resume', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Gather around.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Edit your nickname and avatar' }).click();
  await page.getByRole('textbox', { name: 'Your nickname', exact: true }).fill('Maple Bunny');
  await page.getByRole('button', { name: 'Fox avatar', exact: true }).click();
  await page.getByRole('button', { name: 'Queen piece', exact: true }).click();
  await page.getByRole('button', { name: /Midnight Manor/ }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('little-table-settings-v1')!).boardTheme)).toBe('midnight');
  await page.getByRole('button', { name: 'dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'All set', exact: true }).click();
  await page.getByRole('button', { name: /THE FRIENDLY RIVALRY/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your nickname', exact: true })).toHaveValue('Maple Bunny');
  await expect(page.getByRole('button', { name: 'Fox avatar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Queen piece', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Same device Pass it around/ }).click();
  await page.getByLabel('Player 2', { exact: true }).fill('Cozy Clover');
  await page.getByLabel('Player 2 avatar').selectOption('frog');
  await page.getByLabel('Player 2 piece').selectOption('knight');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ludo');
  await expect(page.locator('.match-player.current')).toContainText('Maple Bunny');
  await expect(page.getByText('Cozy Clover', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click();
  await expect(page.locator('.match-log')).toContainText(/rolled/);
  const snapshot = await page.evaluate(() => localStorage.getItem('little-table-match-v1'));
  await page.reload();
  await page.getByRole('button', { name: /Pick up your Ludo game/ }).click();
  expect(await page.evaluate(() => localStorage.getItem('little-table-match-v1'))).toBe(snapshot);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('both snake presets finish valid local matches, support board shuffle, and rematch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /A LITTLE LUCK. A LOT OF LAUGHS./ }).click();
  await page.getByRole('button', { name: /Turbo 64 squares/ }).click();
  await expect(page.locator('.board-shuffler')).toContainText('Turbo Sprint');
  await page.getByRole('button', { name: 'Shuffle board' }).click();
  await expect(page.locator('.board-shuffler')).toContainText('Sky Rocket');
  await page.getByRole('button', { name: /Same device Pass it around/ }).click();
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Turbo');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sky Rocket');
  await expect(page.locator('.roll-dice')).toHaveClass(/mine/);
  for (let i = 0; i < 350; i++) {
    if (await page.locator('.winner-result, .board-callout.ko').count()) break;
    await page.getByRole('button', { name: 'Roll dice', exact: true }).click();
  }
  await expect(page.locator('.board-callout.ko')).toContainText('K.O.!');
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('little-table-match-v1')!).id);
  await page.getByRole('button', { name: 'Play again' }).click();
  const second = await page.evaluate(() => JSON.parse(localStorage.getItem('little-table-match-v1')!).id);
  expect(second).not.toBe(first);
  await expect(page.locator('.match-log')).toContainText('Any roll gets you started');
});

test('two friends share avatars, ready, play and reclaim seat after refresh', async ({ browser }) => {
  const hostContext = await browser.newContext({ reducedMotion: 'reduce' });
  const guestContext = await browser.newContext({ reducedMotion: 'reduce' });
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await host.getByRole('button', { name: /A LITTLE LUCK. A LOT OF LAUGHS./ }).click();
    await host.getByRole('textbox', { name: 'Your nickname', exact: true }).fill('Honey Fox');
    await host.getByRole('button', { name: 'Fox avatar', exact: true }).click();
    await host.getByRole('button', { name: /Friends Share a private link/ }).click();
    await host.getByRole('button', { name: 'Create a room' }).click();
    await expect(host.locator('.room-code')).toBeVisible();
    const invite = await host.locator('#invite-url').inputValue();
    await guest.goto(invite);
    await guest.getByRole('textbox', { name: 'Your nickname', exact: true }).fill('Honey Fox');
    await guest.getByRole('button', { name: 'Frog avatar', exact: true }).click();
    await guest.getByRole('button', { name: 'Join the table' }).click();
    await expect(host.locator('.lobby-seat')).toHaveCount(2);
    await expect(guest.locator('.lobby-seat').filter({ hasText: 'you' })).toContainText('Honey Fox 2');
    await expect(guest.locator('.lobby-seat').filter({ hasText: 'you' }).getByRole('img', { name: 'Frog' })).toBeVisible();
    await host.getByRole('button', { name: 'I’m ready' }).click();
    await guest.getByRole('button', { name: 'I’m ready' }).click();
    await host.getByRole('button', { name: 'Start the fun' }).click();
    await host.getByRole('button', { name: 'Roll dice', exact: true }).click();
    await expect(guest.locator('.match-log')).toContainText('rolled');
    await guest.reload();
    await guest.getByRole('button', { name: 'Join the table' }).click();
    await expect(guest.locator('.match-player')).toHaveCount(2);
    await expect(guest.locator('.match-player').nth(1)).toContainText('Honey Fox 2');
    await expect(guest.getByRole('button', { name: 'Roll dice', exact: true })).toBeEnabled();
  } finally { await hostContext.close(); await guestContext.close(); }
});

test('cached local play works offline and narrow layouts never overflow', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Solo & local ready offline')).toBeVisible({ timeout: 20000 });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Gather around.');
  await page.getByRole('button', { name: /THE FRIENDLY RIVALRY/ }).click();
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ludo');
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click();
  await expect(page.locator('.match-log')).toContainText('rolled');
});

test('light and dark chooser, settings, setup and active match have no WCAG AA violations', async ({ page }) => {
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    const settings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(settings.violations).toEqual([]);
    await page.getByRole('button', { name: 'All set', exact: true }).click();
    const home = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(home.violations).toEqual([]);
  }
  await page.getByRole('button', { name: /THE FRIENDLY RIVALRY/ }).click();
  const setup = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(setup.violations).toEqual([]);
  await page.getByRole('button', { name: 'Let’s play' }).click();
  const match = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(match.violations).toEqual([]);
});

test('keyboard dialog focus returns, local board cycles stabilize memory and input responds promptly', async ({ page }) => {
  await page.goto('/');
  const settings = page.getByRole('button', { name: 'Open settings' });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const memory = async () => {
    await session.send('HeapProfiler.collectGarbage');
    const metrics = await session.send('Performance.getMetrics');
    return metrics.metrics.find((m: { name: string }) => m.name === 'JSHeapUsedSize')!.value;
  };
  const before = await memory();
  const durations: number[] = [];
  for (let i = 0; i < 15; i++) {
    await page.getByRole('button', { name: /THE FRIENDLY RIVALRY/ }).click();
    await page.getByRole('button', { name: 'Let’s play' }).click();
    if (i > 0) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const started = performance.now();
    await page.getByRole('button', { name: 'Roll dice', exact: true }).click();
    await expect(page.locator('.match-log')).toContainText('rolled');
    durations.push(performance.now() - started);
    await page.getByRole('button', { name: 'All games', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Gather around.');
  }
  const after = await memory();
  const increaseMiB = (after - before) / 1024 / 1024;
  console.info(JSON.stringify({ cycles: 15, retainedHeapIncreaseMiB: increaseMiB, maxClickAndAssertionMs: Math.max(...durations), note: 'Local Chromium automation latency, not field INP.' }));
  expect(increaseMiB).toBeLessThan(5);
  const stateAfterLeaving = await page.evaluate(() => localStorage.getItem('little-table-match-v1'));
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => localStorage.getItem('little-table-match-v1'))).toBe(stateAfterLeaving);
  await session.detach();
});

test('sound unlocks on a gesture, reuses one context, drains voices and respects mute', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    window.__testAudio = { contexts: [], voices: 0 };
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.__testAudio!.contexts.push(this);
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        window.__testAudio!.voices++;
        oscillator.addEventListener('ended', () => { window.__testAudio!.voices--; }, { once: true });
        return oscillator;
      }
    };
  });

  await page.goto('/');
  expect(await page.evaluate(() => window.__testAudio!.contexts.length)).toBe(0);
  await page.getByRole('button', { name: /THE FRIENDLY RIVALRY/ }).click();
  await page.getByRole('button', { name: /Same device Pass it around/ }).click();
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__testAudio!.contexts[0]?.state)).toBe('running');
  expect(await page.evaluate(() => window.__testAudio!.contexts.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__testAudio!.voices)).toBe(0);
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__testAudio!.contexts[0].state)).toBe('suspended');
  await page.getByRole('button', { name: 'Turn sound on', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__testAudio!.contexts[0].state)).toBe('running');
  expect(await page.evaluate(() => window.__testAudio!.contexts.length)).toBe(1);
});

test('local games work when the browser does not expose secure-context randomUUID', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  await page.goto('/');
  await page.getByRole('button', { name: /THE FRIENDLY RIVALRY/ }).click();
  await page.getByRole('button', { name: 'Let’s play' }).click();
  const id: string = await page.evaluate(() => JSON.parse(localStorage.getItem('little-table-match-v1')!).id);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click();
  await expect(page.locator('.match-log')).toContainText('rolled');
});
