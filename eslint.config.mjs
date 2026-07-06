import js from "@eslint/js"
import * as effectEslint from "@effect/eslint-plugin"
import tseslint from "typescript-eslint"

export default [
  {
    ignores: [
      "**/dist",
      "**/build",
      "**/docs",
      "**/*.md",
      "**/node_modules"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...effectEslint.configs.dprint,
  {
    rules: {
      "@effect/dprint": [
        "error",
        {
          config: {
            indentWidth: 2,
            lineWidth: 120,
            semiColons: "asi",
            quoteStyle: "alwaysDouble",
            trailingCommas: "never",
            operatorPosition: "maintain",
            "arrowFunction.useParentheses": "force"
          }
        }
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/array-type": [
        "warn",
        { default: "generic", readonly: "generic" }
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-namespace": "off",

      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='push'] > SpreadElement.arguments",
          message: "Do not use spread arguments in Array.push"
        }
      ]
    }
  },
  {
    files: ["packages/*/src/**/*", "packages/*/test/**/*"],
    rules: {
      "no-console": "error",
      "no-fallthrough": "off"
    }
  },
  {
    files: ["packages/*/src/**/*"],
    rules: {
      "@effect/no-import-from-barrel-package": [
        "error",
        {
          packageNames: ["effect", "@effect/platform"]
        }
      ]
    }
  }
]
