import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    clearMocks: true,
    restoreMocks: true,
    environmentOptions: {
      happyDOM: {
        // Fixtures may contain CAPTCHA iframes; never fetch them.
        settings: {
          disableIframePageLoading: true,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
        },
      },
    },
  },
});
