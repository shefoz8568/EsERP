/**
 * Vitest 3 moved `Assertion` into `@vitest/expect` and `vitest` only
 * re-exports it, so `@testing-library/jest-dom`'s `declare module 'vitest'`
 * augmentation never merges. Vitest 3's intended extension point is the
 * empty `Matchers<T>` interface that `Assertion` extends — augment that.
 * The empty interface and `any` generics are required by that API shape,
 * so the two lint rules below are disabled for this file only.
 */
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module '@vitest/expect' {
  interface Matchers<T = any> extends TestingLibraryMatchers<any, T> {}
}
