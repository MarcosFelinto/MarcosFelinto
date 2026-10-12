# Kélita Produção

Sistema de gestão de produção, custos, estoque e eficiência, com banco de dados na nuvem (Postgres Neon na Vercel) e sincronização em tempo real entre usuários.

## Estrutura

| Pasta / arquivo | Conteúdo |
| --- | --- |
| `public/index.html` | Aplicação (telas, cálculos, relatórios) — evolução do SISTEMA_PRODUÇÃO_EVOLUIDO_V15 |
| `public/assets/nuvem.js` | Login no servidor, carga do banco, fila de gravação (guardada no navegador até o banco confirmar), aviso em tempo real das alterações dos outros usuários, controle de conflito, restauração de backup e janelas de aviso (SweetAlert2) |
| `public/assets/impressao.js` | Impressão e PDF do relatório aberto |
| `public/assets/app.css` | Tailwind compilado + folha de impressão (`@media print`) |
| `public/assets/lib`, `fontawesome` | Bibliotecas locais (Chart.js, SheetJS, jsPDF, AutoTable, SweetAlert2, Ably, Font Awesome) |
| `api/auth.js` | `POST /api/auth` login e troca de senha · `GET /api/auth` renova a sessão |
| `api/db.js` | `GET /api/db` carga por tabela, mudanças desde o cursor, status, token de tempo real · `POST /api/db` inclusões, alterações e exclusões; `acao: 'restaurar'` restaura um backup (só ADMIN, atômico) |
| `api/_lib/db.js` | Esquema do banco, concorrência otimista por versão, exclusão permanente com marca para os outros navegadores, restauração de backup |
| `api/_lib/tempoReal.js` | Aviso de mudança em tempo real (Ably): publica `{ seq }` depois de cada gravação e assina o token dos navegadores |
| `api/_lib/seguranca.js` | Hash de senha (mesmo algoritmo do sistema) e token de sessão assinado |
| `api/_lib/seed.js` | Base inicial (backup de 29/09/2026), carregada só se o banco estiver vazio |
| `estilo/` | Fonte do CSS (Tailwind) — não é publicada |
| `_desenvolvimento/` | Servidor local, testes e ferramentas — não é publicada |

## Banco de dados

Tabelas criadas automaticamente na primeira chamada:

- `kp_registros (tabela, id, dados jsonb, versao, seq, criado_em, atualizado_em, atualizado_por)` — um registro por cadastro, produção, movimentação, custo, usuário, configuração e log.
- `kp_exclusoes (tabela, id, seq, excluido_em, excluido_por)` — marca das exclusões para avisar os outros navegadores.
- `kp_seq` — sequência global; cada gravação recebe um número, que é o cursor da sincronização.

A conexão vem da variável `DATABASE_URL` criada pela integração Neon no projeto `kelita-producao`.

## Sincronização entre usuários

- Cada alteração é enviada ao banco logo em seguida (as edições feitas em sequência vão num envio só). Até o banco confirmar, ela fica guardada no navegador (`localStorage`, chave `kp_pendentes:<usuário>`); se a aba fechar ou a internet cair, é reenviada no próximo acesso. Os dados em si não ficam guardados no navegador.
- Depois de cada gravação o servidor publica um aviso no Ably e os outros navegadores buscam **uma vez** só o que mudou. Sem aviso, nenhuma requisição é feita (há só uma conferência de segurança a cada 5 min).
- Para ligar o tempo real, crie uma conta grátis em https://ably.com, crie uma chave de API e cadastre-a na Vercel como variável de ambiente `ABLY_API_KEY` (Settings → Environment Variables), depois publique de novo. Sem a variável, os navegadores buscam mudanças a cada 30 s.
- O botão **Nuvem · hh:mm:ss** no cabeçalho envia o que estiver pendente, busca as mudanças e mostra o resultado real (gravadas, recebidas, recusadas ou erro).

## Publicar

Windows: dê dois cliques em `publicar.bat`. Linux/macOS: `./publicar.sh`.
Requer Node.js; na primeira vez a Vercel pede login pelo navegador. Endereço: https://kelita-producao.vercel.app

## Rodar no computador (sem tocar no banco da produção)

```
npm install
npm run local            # http://localhost:8787 · todos os usuários com a senha Teste@123
npm run local -- --zerar # apaga o banco local e recarrega o backup
```

O servidor local usa um Postgres embutido (PGlite) em `_desenvolvimento/local/.dados`. Cada pasta de banco só pode ser aberta por um servidor por vez; para outro servidor ao mesmo tempo use `--dados=<outra pasta>` e outra porta.

Depois de editar qualquer arquivo em `public/assets`, rode `npm run versionar` para atualizar o `?v=` no `index.html` (senão o navegador pode usar a versão antiga por até 1 hora).

## Testes

Com um servidor local em outra porta e outra pasta de banco (`node _desenvolvimento/local/servidor-local.mjs 8799 --zerar --dados=C:/temp/kp-teste`):

```
node _desenvolvimento/test/sincronizacao.e2e.mjs http://localhost:8799   # botão Nuvem, fila offline, restauração de backup
node _desenvolvimento/test/e2e.cjs http://localhost:8799 Teste@123       # CRUD entre dois navegadores, abas, PDF, Excel
node _desenvolvimento/test/operador_test.cjs http://localhost:8799       # perfil Funcionária no celular
SENHA_ADMIN=Teste@123 node _desenvolvimento/test/api_test.mjs http://localhost:8799
```

Os testes de navegador usam o Edge do Windows (`KP_NAVEGADOR` muda o caminho). Zere o banco entre um teste e outro.

## Primeiro acesso

O banco começa com os dados do backup de 29/09/2026, inclusive os usuários e senhas que já existiam no sistema.
Se o banco estiver vazio e sem usuários, é criado `admin@fabrica.com` com senha `123456`, e a troca é obrigatória no primeiro acesso.
