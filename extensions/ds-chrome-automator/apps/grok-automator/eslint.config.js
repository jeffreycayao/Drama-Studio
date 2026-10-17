import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: ['.output/**', '.wxt/**', 'coverage/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    rules: {
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.ts', '**/*.vue'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
      },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/only-throw-error': 'error',
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
  },
);
