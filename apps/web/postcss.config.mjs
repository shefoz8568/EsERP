export default {
  plugins: {
    // Must come first: inlines `@import "@eserp/ui/globals.css"` (which holds
    // the `@tailwind` directives + design tokens) into this file's AST before
    // Tailwind processes it.
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
