import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Portal del cliente: anon solo lee columnas autorizadas (supabase/functions/_shared/shareColumns.ts).
  // Un select('*') falla entero con "permission denied" y el portal se queda sin datos.
  {
    files: ['src/pages/SharePage.tsx', 'src/components/BackupMetricsModal.tsx'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name='select'][arguments.0.value='*']",
        message: "En el portal no se puede usar select('*'): usá shareSelect('<tabla>') o las columnas de shareColumns.ts.",
      }],
    },
  }
);
