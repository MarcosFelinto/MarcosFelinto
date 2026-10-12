# Kélita Produção

Sistema web de **gestão de produção, custos, estoque e eficiência** para confecção/fábrica. Os dados ficam em um banco Postgres na nuvem (Neon, via Vercel) e as alterações aparecem em tempo real para todos os usuários conectados.

🔗 Produção: https://kelita-producao.vercel.app
📄 Manual do usuário: [Kelita_Producao_Manual_do_Usuario.pdf](Kelita_Producao_Manual_do_Usuario.pdf)

---

## Funcionalidades

| Área | O que faz |
| --- | --- |
| **Dashboard** | Visão geral da produção, custos e indicadores, com gráficos |
| **Produções** | Ordens de produção (comandas) por etapa, com início/pausa/conclusão e peças produzidas |
| **Minha Produção** | Tela para a funcionária lançar e acompanhar a própria produção pelo celular |
| **Produtos, Categorias e Fichas técnicas** | Cadastro de produtos e da composição de insumos e etapas de cada um |
| **Insumos e Estoque** | Materiais, entradas, saídas, ajustes de inventário e alerta de estoque mínimo |
| **Funcionários e Equipes** | Cadastro, vínculo (CLT, diarista, facção), salário, encargos e custo/hora |
| **Custos e Preço** | Custos diretos e indiretos (rateados), cálculo de custo do produto e formação de preço (markup) |
| **Eficiência, Metas, Ranking e Perdas** | Acompanhamento de desempenho por pessoa/equipe e controle de perdas |
| **Relatórios** | Relatórios com impressão, exportação em PDF e Excel |
| **Alertas, Logs, Usuários e Configurações** | Avisos do sistema, histórico de ações, controle de acesso e backup/restauração |

### Perfis de acesso

- **Administrador** — acesso total, incluindo usuários, configurações e restauração de backup.
- **Produção** — uso no chão de fábrica.
- **Funcionária(o)** — pelo celular, só lança e acompanha a própria produção; não vê salários dos colegas e não exclui registros. As regras são conferidas também no servidor.

---

## Tecnologias

- **Front-end:** HTML + JavaScript puro, Tailwind CSS (compilado), Chart.js, SheetJS (Excel), jsPDF + AutoTable (PDF), SweetAlert2, Font Awesome — todas as bibliotecas ficam locais em `public/assets/lib`.
- **Back-end:** funções serverless da Vercel em Node.js (≥ 20).
- **Banco de dados:** Postgres (Neon) com `@neondatabase/serverless`; localmente usa PGlite (Postgres embutido).
- **Tempo real:** Ably (opcional).

---

## Como funciona

- **Modelo de dados documental:** cada registro (produção, insumo, custo, usuário etc.) é uma linha na tabela `kp_registros`, com os dados em JSONB. As tabelas são criadas automaticamente na primeira chamada.
- **Sincronização:** toda gravação recebe um número de sequência global (`kp_seq`). Cada navegador guarda o último número que viu e busca só o que mudou depois dele.
- **Tempo real:** depois de cada gravação o servidor publica um aviso no Ably e os outros navegadores buscam as mudanças. Sem Ably, eles consultam a cada 30 s.
- **Sem perda de dados:** as alterações ficam numa fila no navegador até o banco confirmar, e são reenviadas se a internet cair ou a aba fechar.
- **Concorrência otimista:** se duas pessoas editam o mesmo registro, a segunda gravação é recusada e o navegador recebe a versão atual, em vez de sobrescrever em silêncio.
- **Segurança:** senhas com hash SHA-256 + salt e iterações, token de sessão assinado (12 h) e limite de tentativas de login.

---

## Estrutura do projeto

```
├── api/                    # Funções serverless (Vercel)
│   ├── auth.js             # Login, troca de senha e renovação de sessão
│   ├── db.js               # Leitura, gravação, mudanças, status e restauração de backup
│   └── _lib/               # Banco, HTTP, segurança, tempo real e base inicial (seed)
├── public/                 # Tudo o que é publicado
│   ├── index.html          # A aplicação (telas, cálculos e relatórios)
│   └── assets/             # nuvem.js, operador.js, impressao.js, responsivo.js, CSS e bibliotecas
├── estilo/                 # Fonte do CSS (Tailwind) — não é publicada
├── _desenvolvimento/       # Servidor local, testes e ferramentas — não é publicada
├── publicar.bat / .sh      # Publicação na Vercel
├── vercel.json             # Configuração da Vercel (região gru1, cabeçalhos, cache)
└── LEIA-ME.md              # Guia técnico detalhado
```

---

## Rodar localmente

Requer **Node.js 20+**. O servidor local usa um banco próprio e não mexe nos dados da produção.

```bash
npm install
npm run local              # http://localhost:8787 — todos os usuários com a senha Teste@123
npm run local -- --zerar   # apaga o banco local e recarrega a base inicial
```

Depois de editar arquivos em `public/assets`, rode `npm run versionar` para atualizar o `?v=` no `index.html` e evitar que o navegador use a versão em cache.

---

## Publicar

- **Windows:** dê dois cliques em `publicar.bat`
- **Linux/macOS:** `./publicar.sh`

Na primeira vez a Vercel pede login pelo navegador.

### Variáveis de ambiente (Vercel)

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sim | Conexão com o Postgres (criada pela integração Neon) |
| `ABLY_API_KEY` | Não | Liga a sincronização em tempo real |
| `SESSION_SECRET` | Não | Segredo para assinar os tokens de sessão |

---

## Testes

Os testes ficam em `_desenvolvimento/test` (API, sincronização, ponta a ponta entre dois navegadores e perfil Funcionária no celular). Veja como executá-los no [LEIA-ME.md](LEIA-ME.md#testes).

---

## Primeiro acesso

O banco começa com os dados do backup de 29/09/2026, incluindo os usuários existentes. Se o banco estiver vazio, é criado o usuário `admin@fabrica.com` com senha `123456`, e a troca de senha é obrigatória no primeiro acesso.
