import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.js', '**/*.mjs'],
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Node.js 18+ globals
        fetch: 'readonly',
        // Web/Node.js shared globals
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Event: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        // Testing globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        // Runtime-specific globals
        Bun: 'readonly',
        Deno: 'readonly',
        globalThis: 'readonly',
        // Browser globals (used in evaluate functions)
        document: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',

      // Code quality rules
      // Note: Using 'warn' instead of 'error' for unused-vars since this codebase
      // has intentionally unused parameters in abstract base classes and mocks
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-console': 'off', // Allow console in this project
      'no-debugger': 'error',

      // Best practices
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'no-duplicate-imports': 'error',

      // ES6+ features
      'arrow-body-style': ['error', 'as-needed'],
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',

      // Async/await
      'no-async-promise-executor': 'error',
      'require-await': 'warn',

      // Comments and documentation
      'spaced-comment': ['error', 'always', { markers: ['/'] }],

      // Complexity rules - tuned for browser-automation orchestration code
      complexity: ['warn', 30], // Cyclomatic complexity guardrail for unusually branchy functions
      'max-depth': ['warn', 5], // Maximum nesting depth - slightly more lenient than strict 4
      'max-lines-per-function': [
        'warn',
        {
          max: 300, // Allows orchestration functions while still catching very large functions
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-params': ['warn', 6], // Maximum function parameters - slightly more lenient than strict 5
      'max-statements': ['warn', 60], // Maximum statements per function - reasonable limit for orchestration functions
      'max-lines': ['error', 1500], // Maximum lines per file - counts all lines including blank lines and comments
    },
  },
  {
    // Test files have different requirements
    files: ['tests/**/*.js', '**/*.test.js'],
    rules: {
      'require-await': 'off', // Async functions without await are common in tests
      'no-unused-vars': 'off', // Mock functions often have unused parameters for API compatibility
      'max-lines-per-function': 'off', // Tests can be long
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'docs-api/**',
      '*.min.js',
      '.eslintcache',
    ],
  },
];
