# Bazares — Frontend Vanilla (HTML + CSS + JavaScript puro)

Frontend **sem build step**, pensado para abrir directamente no Chrome e testar contra o backend real. Nenhuma dependência de Node, npm, ou bundlers — apenas ficheiros estáticos.

---

## 🚀 Como abrir

### 1. Arrancar o backend primeiro

```bash
cd bazares
npm install
cp .env.example .env   # configure DATABASE_URL, JWT secrets, etc.
npm run db:push
npm run db:seed
npm run dev              # corre em http://localhost:3001
```

### 2. Configurar o endereço do backend (se necessário)

Abra `js/config.js` — por defeito já aponta para `http://localhost:3001`:

```js
window.BAZARES_API_BASE = 'http://localhost:3001';
```

Se o seu backend correr noutra porta ou endereço, altere aqui. É o **único sítio** que precisa de editar.

### 3. Abrir no Chrome

Há duas formas:

**A) Servidor estático local (recomendado — evita problemas de CORS/cookies):**
```bash
cd bazares-web
python3 -m http.server 8080
# ou: npx serve .
```
Depois abra `http://localhost:8080/index.html` no Chrome.

**B) Abrir o ficheiro directamente (`file://`):**
Pode funcionar para navegação simples, mas **os cookies de sessão (refresh token) não funcionam de forma fiável em `file://`** — o navegador trata cada ficheiro local como uma origem distinta. Para testar login/sessão persistente, use sempre a opção A.

> ⚠️ O backend já tem CORS configurado para aceitar qualquer origem quando `FRONTEND_URL` não está definida (modo de desenvolvimento permissivo). Para testes locais isto já funciona sem configuração adicional.

---

## 📄 Páginas incluídas (34 ficheiros HTML)

| Categoria | Páginas |
|---|---|
| **Autenticação** | `index.html`, `login.html`, `register.html`, `verify-email.html`, `forgot-password.html` |
| **Núcleo** | `dashboard.html`, `bazars.html`, `bazar.html`, `products.html`, `product.html`, `checkout.html`, `cart.html`, `favorites.html`, `my-orders.html` |
| **Vendedor** | `my-bazar.html`, `my-products.html`, `finance.html` |
| **Revendedor** | `my-sellers.html`, `rev-finance.html` |
| **Partilhadas** | `referrals.html`, `profile.html`, `settings.html`, `support.html`, `chat.html` |
| **Admin** | `admin.html`, `admin-users.html`, `admin-products.html`, `admin-orders.html`, `admin-finance.html`, `admin-invites.html`, `admin-broadcast.html`, `admin-reports.html`, `admin-logs.html`, `admin-denuncias.html` |

Todas ligam aos endpoints reais do backend — **nenhum dado simulado**.

---

## 🔍 Como depurar bugs no Chrome

Esta é a vantagem desta abordagem sobre um build React: cada página é um ficheiro HTML simples.

1. Abra qualquer página → **F12** (DevTools) → aba **Console**
2. Erros de JavaScript aparecem imediatamente com o número da linha exacto no ficheiro `.html`
3. Aba **Network** → veja cada chamada `fetch` ao backend, o payload enviado, e a resposta recebida (útil para confirmar que o contrato da API está correcto)
4. Aba **Application → Cookies** → confirme que `refreshToken` está a ser definido após o login

---

## 🧩 Arquitectura dos ficheiros

```
bazares-web/
├── css/style.css       # Design system único, partilhado por todas as páginas
├── js/
│   ├── config.js         # Único ficheiro a editar: endereço do backend
│   ├── api.js              # Cliente fetch puro: tokens, refresh automático, helpers
│   └── app.js               # Sessão, topbar, sidebar, toasts, modais, helpers de UI
└── *.html                # Uma página por rota — cada uma com o seu próprio <script> inline
```

Cada página HTML:
1. Carrega `config.js` → `api.js` → `app.js` (sempre por esta ordem)
2. Chama `initPage({...})` que faz bootstrap da sessão, constrói a topbar/sidebar, e aplica guardas de autenticação/role
3. Tem o seu próprio `<script>` com a lógica específica daquela página

Sem build, sem transpilação — o que vê no ficheiro é exactamente o que corre no browser.

---

## ✅ Testar o fluxo completo

1. `register.html` como Vendedor → verificar email (código aparece nos logs do backend se SMTP não estiver configurado)
2. `my-bazar.html` → criar loja
3. `my-products.html` → adicionar produto com upload real de imagens
4. Noutra janela anónima, registar como Comprador → `products.html` → comprar
5. `chat.html` em ambas as janelas → testar mensagens em tempo real (Socket.IO via CDN)
6. Fluxo de encomenda completo: aceitar → preparar → entregar → confirmar → avaliar
7. `admin.html` com `ayronbanze0@gmail.com` / `C@m@le@o` → testar gestão completa

---

## ⚠️ Limitações conhecidas

- Sem gateway de pagamento real (M-Pesa/e-Mola) — ver nota no backend
- `file://` não preserva sessão entre páginas de forma fiável; use um servidor estático
- O upload de imagens depende de Cloudinary estar configurado no backend; sem isso, os produtos são criados sem imagem
