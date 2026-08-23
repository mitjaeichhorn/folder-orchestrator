// Locale is configuration, never a constant. Documented fallback: 'en'.
export const config = {
  locale: import.meta.env.VITE_LOCALE ?? 'en',
  apiBase: import.meta.env.VITE_API_BASE ?? '',
  bufferLimit: 2000
} as const
