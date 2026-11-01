import { test, expect } from '@playwright/test'

test('landing renders brand and queue honesty', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: /WrittenBoard/i }).first()).toBeVisible()
  await expect(page.getByText('NOW SHOWING')).toBeVisible()
  await expect(page.getByText('UP NEXT')).toBeVisible()
  await expect(page.getByRole('link', { name: /Submit yours/i })).toBeVisible()
})

test('auth page is reachable without crashing', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('heading', { name: /Sign in|Create account/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible()
})

test('legal stubs render', async ({ page }) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: /Terms of Service/i })).toBeVisible()
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible()
})
