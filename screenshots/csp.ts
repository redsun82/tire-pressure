import type { Page } from '@playwright/test';

export interface CspWatch {
  /** `securitypolicyviolation` events, as "directive blocked-uri". */
  violations: string[];
  /** Console errors, which include Chrome's "Refused to …" CSP messages. */
  consoleErrors: string[];
}

/** Records CSP violations and console errors on every document the page loads. */
export async function watchCsp(page: Page): Promise<CspWatch> {
  const watch: CspWatch = { violations: [], consoleErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') watch.consoleErrors.push(message.text());
  });
  await page.exposeFunction('__cspViolation', (violation: string) => watch.violations.push(violation));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation(
        `${event.effectiveDirective} ${event.blockedURI}`,
      );
    });
  });
  return watch;
}

export function cspMessages(watch: CspWatch): string[] {
  return [...watch.violations, ...watch.consoleErrors.filter((e) => /Content Security Policy/i.test(e))];
}
