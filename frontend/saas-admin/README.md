# SaaS Admin Global

## Instruções

1. Instale dependências:
   npm install

2. Configure a variável de ambiente:
   - Crie um arquivo `.env` na raiz com:
     VITE_API_BASE_URL=http://localhost:3000

3. Scripts disponíveis:
   - `npm run dev`     # desenvolvimento
   - `npm run build`   # build produção
   - `npm run preview` # preview build

4. Acesse http://localhost:5173

## Estrutura
- Autenticação JWT (localStorage)
- Layout com Sidebar/Topbar
- Páginas: Login, Tenants, Plans, Usuários do Tenant
- API: fetch + helper http.js

Veja código para detalhes de mocks e endpoints reais.
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
