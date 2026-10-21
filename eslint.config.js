import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Lint volontairement réduit aux règles que le typecheck ne peut pas couvrir.
 *
 * Le compilateur ne voit rien d'un hook appelé après un retour anticipé : c'est une
 * erreur d'exécution qui n'apparaît que dans le navigateur, sous forme d'un message
 * React minifié. Ces deux règles la transforment en échec de build.
 *
 * À la racine et non dans `apps/web` : le catalogue est du React lui aussi, et une config
 * par paquet aurait divergé. ESLint remonte l'arborescence pour la trouver, donc
 * `eslint src` lancé depuis l'un ou l'autre marche sans rien déclarer.
 */
export default [
  // Ignores globaux : un objet à part, sinon ils ne valent que pour le bloc qui les
  // porte et le lint part dans les artefacts de build.
  { ignores: ['**/dist/**', '**/storybook-static/**', '**/node_modules/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
