import { chromium } from '/home/james/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { createStaticServer } from './server.js';
import fs from 'node:fs';
import path from 'node:path';

async function runConnectionTest() {
  console.log('--- Starting LPTTS Compressed Connection & Copy-Toast Test ---');
  
  const outputDir = path.resolve('test-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const staticServer = await createStaticServer();
  const baseUrl = staticServer.url;
  console.log(`[1] Static test server listening on ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  console.log('[2] Playwright Chromium browser launched');

  try {
    console.log('[3] Setting up Client 1 (Host)...');
    const hostContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write']
    });
    const hostPage = await hostContext.newPage();
    
    hostPage.on('pageerror', err => console.error('[Host Page Error]:', err));
    hostPage.on('console', msg => console.log(`[Host Console ${msg.type()}]:`, msg.text()));
    await hostPage.goto(baseUrl);

    // Save TURN settings in UI
    await hostPage.click('#lobby-settings');
    await hostPage.waitForSelector('#settings-dialog[open]');
    await hostPage.fill('#setting-turn-host', 'global.relay.metered.ca');
    await hostPage.fill('#setting-turn-user', 'test-metered-user');
    await hostPage.fill('#setting-turn-cred', 'test-metered-pass');
    await hostPage.click('#settings-form button[type="submit"]');
    await hostPage.waitForFunction(() => !document.querySelector('#settings-dialog')?.open);

    // Host opens room
    await hostPage.fill('#name', 'Alice (Host)');
    await hostPage.click('#host-button');
    await hostPage.waitForSelector('#game:not([hidden])', { timeout: 10000 });

    // Host clicks table connections badge to create offer
    console.log('[4] Host creating compressed offer code...');
    await hostPage.click('#connections');
    await hostPage.waitForSelector('#connect-dialog[open]', { timeout: 15000 });
    
    await hostPage.waitForFunction(() => {
      const val = document.querySelector('#offer-code')?.value;
      return val && val.length > 30;
    }, { timeout: 10000 });

    const offerCode = await hostPage.$eval('#offer-code', el => el.value);
    console.log(`    - Host generated compressed offer code: ${offerCode.length} characters (previously ~1280 chars)`);

    // Test copy button and toast on Host
    console.log('    - Testing Host Copy Button and Toast...');
    await hostPage.click('#copy-offer');
    await hostPage.waitForSelector('.toast.show', { timeout: 3000 });
    const hostToastText = await hostPage.$eval('.toast', el => el.textContent);
    console.log(`    - Host toast displayed: "${hostToastText}"`);

    // Setup Client 2 (Guest)
    console.log('[5] Setting up Client 2 (Guest)...');
    const guestContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write']
    });
    const guestPage = await guestContext.newPage();
    guestPage.on('pageerror', err => console.error('[Guest Page Error]:', err));
    guestPage.on('console', msg => console.log(`[Guest Console ${msg.type()}]:`, msg.text()));

    await guestPage.goto(baseUrl);
    await guestPage.fill('#name', 'Bob (Guest)');
    await guestPage.click('#join-button');
    await guestPage.waitForSelector('#connect-dialog[open]', { timeout: 10000 });

    // Guest pastes compressed offer code
    console.log('[6] Guest pasting compressed offer and generating answer...');
    await guestPage.fill('#join-offer', offerCode);
    await guestPage.click('#make-answer');

    await guestPage.waitForSelector('#answer-result:not([hidden])', { timeout: 15000 });
    await guestPage.waitForFunction(() => {
      const val = document.querySelector('#guest-answer')?.value;
      return val && val.length > 30;
    }, { timeout: 15000 });

    const answerCode = await guestPage.$eval('#guest-answer', el => el.value);
    console.log(`    - Guest generated compressed answer code: ${answerCode.length} characters (previously ~990 chars)`);

    // Test copy button and toast on Guest
    console.log('    - Testing Guest Copy Button and Toast...');
    await guestPage.click('#copy-answer');
    await guestPage.waitForSelector('.toast.show', { timeout: 3000 });
    const guestToastText = await guestPage.$eval('.toast', el => el.textContent);
    console.log(`    - Guest toast displayed: "${guestToastText}"`);

    // Host receives answer and completes connection
    console.log('[7] Host completing connection...');
    await hostPage.fill('#answer-code', answerCode);
    await hostPage.click('#accept-answer');

    // Verification of connection
    console.log('[8] Awaiting WebRTC connection establishment...');
    
    // Check status in case of error
    const hostStatus = await hostPage.$eval('#connect-status', el => el.textContent);
    const guestStatus = await guestPage.$eval('#connect-status', el => el.textContent);
    console.log(`    - Host connect-status: "${hostStatus}"`);
    console.log(`    - Guest connect-status: "${guestStatus}"`);

    await guestPage.waitForFunction(() => !document.querySelector('#connect-dialog')?.open, { timeout: 15000 });
    await guestPage.waitForSelector('#game:not([hidden])', { timeout: 15000 });
    await guestPage.waitForFunction(() => {
      const text = document.querySelector('#connection')?.textContent;
      return text && text.includes('Connected to host');
    }, { timeout: 15000 });

    await hostPage.waitForFunction(() => !document.querySelector('#connect-dialog')?.open, { timeout: 15000 });
    await hostPage.waitForFunction(() => document.querySelector('#player-count')?.textContent === '2', { timeout: 15000 });
    await guestPage.waitForFunction(() => document.querySelector('#player-count')?.textContent === '2', { timeout: 15000 });

    const hostScreenshot = path.join(outputDir, 'client1-host-connected.png');
    const guestScreenshot = path.join(outputDir, 'client2-guest-connected.png');
    await hostPage.screenshot({ path: hostScreenshot, fullPage: true });
    await guestPage.screenshot({ path: guestScreenshot, fullPage: true });

    console.log('\n>>> SUCCESS: Compressed codes + Copy buttons + Toasts verified successfully! <<<');

    await hostContext.close();
    await guestContext.close();
  } finally {
    await browser.close();
    await staticServer.close();
    console.log('--- Test Run Completed ---\n');
  }
}

runConnectionTest().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
