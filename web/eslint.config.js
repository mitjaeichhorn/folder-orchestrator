import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  { ignores: ['dist', 'src/components/ui/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off'
    }
  },
  {
    // No hardcoded user-facing strings. Scoped to the surfaces that are already
    // clean, so it passes today and stops regression. Widen the glob as areas are
    // cleaned — an unenforced convention decays.
    files: ['src/features/**/*.tsx', 'src/App.tsx'],
    plugins: { react },
    rules: {
      'react/jsx-no-literals': ['error', {
        noStrings: true,
        allowedStrings: ['·', '←', '/', '+', '-', ': ', ' '],
        ignoreProps: true
      }]
    }
  }
])
