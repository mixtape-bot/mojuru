/*
 * Mojuru Gateway - typescript gateway for discord
 * Copyright (C) 2021 Mixtape Bot
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

module.exports = {
    env: {
        es6: true,
        node: true,
    },
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        project: "tsconfig.json",
        ecmaVersion: 2021,
        sourceType: "module",
    },
    rules: {
        indent: [
            "error",
            4,
            {
                SwitchCase: 1,
            },
        ],
        "linebreak-style": ["error", "unix"],
        quotes: ["error", "double"],
        semi: ["error", "always"],
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/prefer-nullish-coalescing": 2,
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        complexity: "warn",
        "accessor-pairs": "warn",
        camelcase: "warn",
        "max-len": ["error", 200, 2],
        yoda: 2,
        "eol-last": 2,
        "@typescript-eslint/no-namespace": "off",
    }
};
``
