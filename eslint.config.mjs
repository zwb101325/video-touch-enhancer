import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
    {
        files: ["**/*.{js,mjs,cjs}"],
        plugins: { js },
        extends: ["js/recommended"],
        languageOptions: {
            globals: {
                ...globals.browser,

                GM_getValue: "readonly",
                GM_setValue: "readonly",
                GM_registerMenuCommand: "readonly",
                unsafeWindow: "readonly",
                trustedTypes: "readonly",
            },
        },
        rules: {
            "no-empty": "off",
            "semi": ["error", "always"],
            "no-extra-semi": "error",
        },
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            sourceType: "script",
        },
    },
]);